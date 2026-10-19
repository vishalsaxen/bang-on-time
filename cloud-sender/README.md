# Cloud sender (GitHub Actions)

Sends your scheduled WhatsApp messages from GitHub, so your computer can be off.
The workflow `.github/workflows/send-scheduled.yml` runs every 5 minutes, sends every row of
the schedule that has come due, and records it in `sent-log.json` so nothing goes twice.

Until the two secrets below are added it runs in **dry-run mode**: the run's log shows what it
would send (numbers masked) and nothing is sent.

## Why not WhatsApp Web here?
The local `auto-sender` signs in by scanning a QR code with your phone. GitHub's machines are new
and short-lived on every run, so that login can't be kept there reliably. The cloud sender uses
Meta's official WhatsApp Cloud API instead, which signs in with a token.

## Timing
GitHub starts scheduled runs every 5 minutes at best, and often a few minutes late when it is busy.
Expect messages within roughly 5 to 15 minutes of their time, not to the second. A row more than
30 minutes overdue (change with the `LATE_LIMIT_MINUTES` variable) is logged as missed, not sent late.
For to-the-second timing, keep using `auto-sender`.

## Setup
1. **WhatsApp Cloud API**: at https://developers.facebook.com create an app of type Business, add the
   WhatsApp product, and add a phone number. That number becomes the sender (column E is ignored here).
   Note the **Phone number ID** and create a **permanent access token** (System User token in Business settings).
2. **Message template**: WhatsApp only lets a business message people who haven't written to it in the last
   24 hours using an approved template. In WhatsApp Manager create a template whose body is just `{{1}}`
   (the row's message goes there) and, if you want the image, an **Image** header. Wait for approval.
3. **Repo secrets** (Settings > Secrets and variables > Actions > Secrets):
   - `WHATSAPP_TOKEN`: the access token
   - `WHATSAPP_PHONE_NUMBER_ID`: the phone number ID
   - `SCHEDULE_CSV` (recommended): paste the whole schedule CSV here so real phone numbers are never committed.
     When set it replaces `schedule.csv`.
4. **Repo variables** (same page, Variables tab):
   - `WHATSAPP_TEMPLATE`: the template name from step 2 (and `WHATSAPP_TEMPLATE_LANG` if not `en`)
   - optional: `TIMEZONE` (default `Asia/Kolkata`), `COUNTRY_CODE` (default `91`), `LATE_LIMIT_MINUTES` (default `30`),
     `DRY_RUN` = `true` to pause real sending
5. **Image** (optional): commit it as `cloud-sender/image.jpg` (or `.png`). It is sent with every message.

Test any time from the Actions tab: **Send scheduled WhatsApp messages > Run workflow**, with "dry run" ticked.

## Schedule format
`schedule.csv` (or the `SCHEDULE_CSV` secret) has the same columns as the Excel file plus a date:

```
name,mobile,message,time,sender,date
Asha,98765xxxxx,"Happy Diwali!",7:30 PM,,2026-10-20
```

- In Excel: add the date in column F, then File > Save As > CSV UTF-8.
- Time: `14:30`, `14:30:00` or `2:30 PM`. Date: `2026-10-20` or `20/10/2026`.
- 10-digit mobiles get the country code added.
- The committed `schedule.csv` holds placeholder numbers only.

## Sending again
`sent-log.json` keeps a short fingerprint of each row it handled (no numbers or messages). A row is sent
once; changing its number, message, date or time makes it a new row. A failed send is logged too: delete
its entry (or set `{}` to start fresh) to try again.
