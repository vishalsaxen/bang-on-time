// Bang On Time auto-sender.
// Links to your WhatsApp (scan a QR code once, like WhatsApp Web) and sends each
// scheduled message, with the uploaded image, at its exact date and time.
// Run:  npm install  then  npm start  and open http://localhost:3000
// Test without sending anything:  npm run dry-run

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const DRY_RUN = process.argv.includes('--dry-run');
const DATA_DIR = path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- WhatsApp Web media fix ----------
// whatsapp-web.js 1.34.7 fails to send images on current WhatsApp Web with
// "Data passed to getter must include an id property". The media model's internal
// id leaks into the outgoing message; this removes it (same fix as upstream PR #201923).
function patchWhatsappWebJs() {
  const file = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  if (src.includes('bang-on-time media fix')) return;
  const anchor = "            ...extraOptions,\n        };\n\n        // Bot's won't reply";
  if (!src.includes(anchor)) { console.warn('Could not apply the image-send fix; whatsapp-web.js has changed.'); return; }
  src = src.replace(anchor, "            ...extraOptions,\n        };\n" +
    "        // bang-on-time media fix\n" +
    "        delete message.__x_id;\n" +
    "        message.id = newMsgKey;\n\n        // Bot's won't reply");
  fs.writeFileSync(file, src);
  console.log('Applied the image-send fix to whatsapp-web.js.');
}

// ---------- WhatsApp connection ----------
const wa = { state: 'starting', qr: null, me: null, error: null };
let client = null;

if (DRY_RUN) {
  wa.state = 'ready';
  wa.me = 'dry-run';
  console.log('Dry run: messages are logged here, nothing is sent.');
} else {
  patchWhatsappWebJs();
  startWhatsApp();
}

// Starts (or restarts) the WhatsApp connection. WhatsApp Web sometimes reloads itself
// while starting, which shows up as "Execution context was destroyed"; we just retry.
function startWhatsApp(attempt = 1) {
  const { Client, LocalAuth } = require('whatsapp-web.js');
  wa.state = 'starting'; wa.error = null;
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  });
  client.on('qr', async (qr) => {
    wa.state = 'scan';
    wa.qr = await QRCode.toDataURL(qr);
    console.log('Open http://localhost:' + PORT + ' and scan the QR code with WhatsApp > Linked devices.');
  });
  client.on('ready', () => {
    attempt = 1;
    wa.state = 'ready';
    wa.qr = null; wa.error = null;
    wa.me = client.info && client.info.wid ? client.info.wid.user : null;
    console.log('WhatsApp linked as +' + wa.me);
  });
  client.on('auth_failure', (m) => { wa.state = 'error'; wa.error = 'Login failed: ' + m; });
  client.on('disconnected', (r) => {
    console.log('WhatsApp disconnected (' + r + ').');
    if (r === 'LOGOUT') { wa.state = 'error'; wa.error = 'You logged out this device. Restart the app and scan the QR code again.'; return; }
    retry('Disconnected: ' + r);
  });
  client.initialize().catch((e) => retry(e.message));

  let retrying = false;
  async function retry(reason) {
    reason = String(reason).replace(/\.+$/, '');
    if (retrying) return;
    retrying = true;
    if (attempt >= 5) {
      wa.state = 'error';
      wa.error = reason + ' (gave up after 5 tries)';
      return;
    }
    const wait = 5 * attempt;
    console.log('WhatsApp problem: ' + reason + '. Retrying in ' + wait + 's...');
    wa.state = 'starting'; wa.error = 'Reconnecting after: ' + reason;
    try { await client.destroy(); } catch (_) {}
    setTimeout(() => startWhatsApp(attempt + 1), wait * 1000);
  }
}

// ---------- jobs ----------
// job: { id, name, mobile, message, at (ms), image (file name or null), status, detail }
let jobs = [];
try { jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); } catch (_) {}
const save = () => fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
// Anything that came due while this app was closed for over 10 minutes is not sent late.
for (const j of jobs) {
  if (j.status === 'sending') j.status = 'waiting';
  if (j.status === 'waiting' && j.at < Date.now() - 10 * 60 * 1000) { j.status = 'missed'; j.detail = 'App was not running at that time'; }
}

async function sendJob(job) {
  job.status = 'sending'; job.detail = null; save();
  try {
    if (DRY_RUN) {
      console.log(`[dry run] ${new Date().toLocaleString()} -> +${job.mobile}: ${job.message}` + (job.image ? ' [image]' : ''));
    } else {
      const numberId = await client.getNumberId(job.mobile);
      if (!numberId) throw new Error('This number is not on WhatsApp');
      const chatId = numberId._serialized;
      if (job.image) {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(path.join(DATA_DIR, job.image));
        try {
          await client.sendMessage(chatId, media, { caption: job.message });
        } catch (e) {
          // Still get the message out on time if only the image part fails.
          await client.sendMessage(chatId, job.message);
          job.detail = 'Image failed, text sent: ' + e.message;
        }
      } else {
        await client.sendMessage(chatId, job.message);
      }
    }
    job.status = 'sent'; job.sentAt = Date.now();
  } catch (e) {
    // WhatsApp Web reloaded mid-send: put it back in the queue to go out once reconnected.
    if (/Execution context was destroyed|detached Frame|Target closed|Session closed/i.test(e.message) && (job.retries || 0) < 3) {
      job.retries = (job.retries || 0) + 1;
      job.status = 'waiting'; job.detail = 'Retrying: ' + e.message;
      save();
      return;
    }
    job.status = 'failed'; job.detail = e.message;
    console.error('Failed to send to +' + job.mobile + ': ' + e.message);
  }
  save();
}

// Checks every second; sends anything due, one at a time, a few seconds apart.
let busy = false;
setInterval(async () => {
  if (busy || wa.state !== 'ready') return;
  const due = jobs.filter((j) => j.status === 'waiting' && j.at <= Date.now()).sort((a, b) => a.at - b.at);
  if (!due.length) return;
  busy = true;
  for (const job of due) {
    await sendJob(job);
    if (due.length > 1) await new Promise((r) => setTimeout(r, 3000));
  }
  busy = false;
}, 1000);

// ---------- web ----------
const app = express();
const upload = multer({ dest: DATA_DIR, limits: { fileSize: 16 * 1024 * 1024 } });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'xlsx', 'dist')));

app.get('/api/status', (req, res) => {
  res.json({ whatsapp: wa, dryRun: DRY_RUN, now: Date.now(), jobs });
});

// Body: multipart with optional "image" file and "jobs" JSON [{name, mobile, message, at}]
app.post('/api/schedule', upload.single('image'), (req, res) => {
  let incoming;
  try { incoming = JSON.parse(req.body.jobs || '[]'); } catch (_) { return res.status(400).json({ error: 'Bad jobs list' }); }
  let image = null;
  if (req.file) {
    image = req.file.filename + path.extname(req.file.originalname || '').toLowerCase();
    fs.renameSync(req.file.path, path.join(DATA_DIR, image));
  }
  // A new schedule replaces anything not yet sent.
  jobs = jobs.filter((j) => j.status === 'sent' || j.status === 'failed');
  const now = Date.now();
  for (const [i, j] of incoming.entries()) {
    const at = Number(j.at);
    jobs.push({
      id: now + '-' + i,
      name: String(j.name || ''),
      mobile: String(j.mobile || '').replace(/\D/g, ''),
      message: String(j.message || ''),
      at,
      image,
      status: at > now ? 'waiting' : 'past',
      detail: null,
    });
  }
  save();
  res.json({ ok: true, jobs });
});

app.post('/api/cancel', (req, res) => {
  jobs = jobs.filter((j) => j.status !== 'waiting' && j.status !== 'past');
  save();
  res.json({ ok: true });
});

// Wipes every entry, sent or not, for a fresh start. WhatsApp stays linked.
app.post('/api/clear', (req, res) => {
  jobs = jobs.filter((j) => j.status === 'sending');
  save();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('Bang On Time running at ' + url);
  // Open the page only once the app is ready (start.bat sets OPEN_BROWSER).
  if (process.env.OPEN_BROWSER) {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd);
  }
});
