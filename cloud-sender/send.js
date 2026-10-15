// Bang On Time cloud sender.
// Run by the GitHub Actions workflow every few minutes. Reads the schedule, sends each
// message that has come due through the official WhatsApp Cloud API, and records it in
// sent-log.json so it is never sent twice.
//
// Without WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID (or with DRY_RUN=true) it only
// prints what it would send, with numbers masked.
//
// Run locally:  node cloud-sender/send.js            (dry run unless the secrets are set)
// Times are read in the TZ environment variable's time zone (the workflow sets Asia/Kolkata).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const SCHEDULE_FILE = path.join(DIR, 'schedule.csv');
const LOG_FILE = path.join(DIR, 'sent-log.json');
const API = 'https://graph.facebook.com/v21.0';

const env = (k, d = '') => (process.env[k] || d).trim();
const TOKEN = env('WHATSAPP_TOKEN');
const PHONE_ID = env('WHATSAPP_PHONE_NUMBER_ID');
const TEMPLATE = env('WHATSAPP_TEMPLATE');            // optional: approved template name
const TEMPLATE_LANG = env('WHATSAPP_TEMPLATE_LANG', 'en');
const COUNTRY_CODE = env('COUNTRY_CODE', '91');
// GitHub's scheduled runs can start several minutes late, so anything due within this
// many minutes is still sent. Older unsent rows are logged as missed instead of sent late.
const LATE_LIMIT_MIN = Number(env('LATE_LIMIT_MINUTES', '30'));
const DRY_RUN = /^(1|true|yes)$/i.test(env('DRY_RUN')) || !TOKEN || !PHONE_ID;

// ---------- schedule ----------
// Same columns as the Excel file (A name, B mobile, C message, D time, E sender) plus
// F date (YYYY-MM-DD). The SCHEDULE_CSV secret, when set, replaces schedule.csv so real
// numbers never have to be committed.
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Accepts "14:30", "14:30:15" or "2:30 PM", like the web page.
function parseTime(v) {
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?$/i);
  if (!m) return null;
  let h = +m[1];
  if (m[4]) { const pm = /p/i.test(m[4]); if (h === 12) h = 0; if (pm) h += 12; }
  return { h, m: +m[2], s: +(m[3] || 0) };
}

function parseDate(v) {
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ||
            String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return m[1].length === 4 ? { y: +m[1], mo: +m[2], d: +m[3] } : { y: +m[3], mo: +m[2], d: +m[1] }; // dd/mm/yyyy
}

function normalizeMobile(v) {
  const digits = String(v).replace(/\D/g, '');
  return digits.length === 10 ? COUNTRY_CODE + digits : digits;
}

const mask = (n) => n.length > 4 ? n.slice(0, 2) + '*'.repeat(n.length - 4) + n.slice(-2) : n;

function loadSchedule() {
  const text = process.env.SCHEDULE_CSV || fs.readFileSync(SCHEDULE_FILE, 'utf8');
  return parseCsv(text.replace(/^﻿/, '')).slice(1)
    .filter((r) => r[1] && r[1].trim())
    .map((r, i) => {
      const t = parseTime(r[3] || ''), d = parseDate(r[5] || '');
      const at = t && d ? new Date(d.y, d.mo - 1, d.d, t.h, t.m, t.s).getTime() : null;
      const mobile = normalizeMobile(r[1]);
      const message = String(r[2] || '');
      // The log stores only this hash, so no numbers or messages end up in it.
      const key = crypto.createHash('sha256').update([mobile, message, at].join('|')).digest('hex').slice(0, 16);
      return { line: i + 2, name: (r[0] || '').trim(), mobile, message, at, key };
    });
}

// ---------- WhatsApp Cloud API ----------
async function api(pathname, body) {
  const res = await fetch(`${API}/${PHONE_ID}/${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
  return json;
}

// Uploads cloud-sender/image.(jpg|jpeg|png) once per run, if there is one.
let mediaId;
async function imageId() {
  if (mediaId !== undefined) return mediaId;
  const file = ['image.jpg', 'image.jpeg', 'image.png'].map((f) => path.join(DIR, f)).find(fs.existsSync);
  if (!file) return (mediaId = null);
  const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', type);
  form.append('file', new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  return (mediaId = (await api('media', form)).id);
}

// With WHATSAPP_TEMPLATE set, sends that approved template with the row's message as its
// {{1}} body text and the image as its header; this works for anyone, any time.
// Without it, sends a plain image+caption or text, which WhatsApp only delivers to people
// who messaged your business number in the last 24 hours.
async function send(job) {
  const img = await imageId();
  const base = { messaging_product: 'whatsapp', to: job.mobile };
  if (TEMPLATE) {
    const components = [{ type: 'body', parameters: [{ type: 'text', text: job.message }] }];
    if (img) components.unshift({ type: 'header', parameters: [{ type: 'image', image: { id: img } }] });
    return api('messages', { ...base, type: 'template', template: { name: TEMPLATE, language: { code: TEMPLATE_LANG }, components } });
  }
  if (img) return api('messages', { ...base, type: 'image', image: { id: img, caption: job.message } });
  return api('messages', { ...base, type: 'text', text: { body: job.message } });
}

// ---------- run ----------
async function main() {
  let log = {};
  try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (_) {}
  const now = Date.now();
  const jobs = loadSchedule();
  let changed = false, sent = 0, failed = 0;

  console.log(`${DRY_RUN ? 'DRY RUN (nothing is sent). ' : ''}${jobs.length} rows, now ${new Date(now).toString()}`);
  for (const job of jobs) {
    if (!job.at) { console.log(`Row ${job.line}: skipped, needs a time in D and a date in F.`); continue; }
    if (log[job.key] || job.at > now) continue;
    const who = `row ${job.line} (${job.name || 'no name'}, +${mask(job.mobile)})`;
    if (job.at < now - LATE_LIMIT_MIN * 60 * 1000) {
      if (!DRY_RUN) { log[job.key] = { status: 'missed', due: new Date(job.at).toISOString() }; changed = true; }
      console.log(`Missed ${who}: was due ${new Date(job.at).toString()}.`);
      continue;
    }
    if (DRY_RUN) { console.log(`[dry run] would send ${who}: ${job.message}`); continue; }
    try {
      const res = await send(job);
      log[job.key] = { status: 'sent', due: new Date(job.at).toISOString(), at: new Date().toISOString(), id: res.messages && res.messages[0] && res.messages[0].id };
      sent++;
      console.log(`Sent ${who}.`);
    } catch (e) {
      log[job.key] = { status: 'failed', due: new Date(job.at).toISOString(), at: new Date().toISOString(), error: e.message };
      failed++;
      console.error(`Failed ${who}: ${e.message}`);
    }
    changed = true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (changed) fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n');
  console.log(`Done: ${sent} sent, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
