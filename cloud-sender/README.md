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
Numbers do not need to be saved in anyone's phone. People should have agreed to get messages from you.

1. **Meta Business account and app**
   - Go to https://business.facebook.com and create a business account (or use yours).
   - Go to https://developers.facebook.com > My Apps > Create app > type **Business**, link it to that business.
   - In the app, add the **WhatsApp** product and press **API Setup**.
2. **Sender number**
   - Add the phone number that will send (API Setup > Add phone number). Use a number that is **not**
     on the WhatsApp phone app, such as a new SIM: once registered here it can't be used in the app.
   - Verify it by SMS, set the display name, and note its **Phone number ID** on the API Setup page.
   - In Business settings > Billing, add a payment method. Meta charges per template message.
3. **Permanent access token**
   - Business settings > Users > **System users** > Add (role Admin).
   - Assign assets > your app (full control) and your WhatsApp account (full control).
   - **Generate new token**, pick your app, expiry **Never**, tick `whatsapp_business_messaging` and
     `whatsapp_business_management`. Copy the token; it is shown once.
4. **Message template with an image**
   - In WhatsApp Manager > Message templates > Create template, category **Marketing** (or Utility).
   - Name it, for example `bang_on_time`, language **English**.
   - Header: **Media > Image**, and upload a sample image.
   - Body, for example: `Hello {{1}},` blank line `{{2}}` blank line `Regards, Bang On Time`.
     `{{1}}` gets the row's name (column A) and `{{2}}` its message (column C). WhatsApp does not allow the
     body to start or end with a `{{…}}`, which is why it has text around them. Give sample values and submit.
   - Wait for **Approved** (usually minutes, sometimes a day).
5. **Repo secrets** (repo Settings > Secrets and variables > Actions > **Secrets** > New repository secret):
   - `WHATSAPP_TOKEN`: the token from step 3
   - `WHATSAPP_PHONE_NUMBER_ID`: the ID from step 2
   - `SCHEDULE_CSV` (recommended): the whole schedule CSV, so real phone numbers are never committed.
     When set it replaces `schedule.csv`.
6. **Repo variables** (same page, **Variables** tab):
   - `WHATSAPP_TEMPLATE`: the template name from step 4, such as `bang_on_time`
   - `WHATSAPP_TEMPLATE_LANG`: the language code if not `en` (for "English (US)" use `en_US`)
   - `WHATSAPP_TEMPLATE_FIELDS`: only if your body differs; default `name,message` fills `{{1}}` with the
     name and `{{2}}` with the message. Use `message` for a body with just `{{1}}`.
   - optional: `TIMEZONE` (default `Asia/Kolkata`), `COUNTRY_CODE` (default `91`), `LATE_LIMIT_MINUTES` (default `30`),
     `DRY_RUN` = `true` to pause real sending
7. **Image**: commit it as `cloud-sender/image.jpg` (or `.png`). It goes in the header of every message.
8. **Test**: put one row with your own number a few minutes ahead, then Actions tab >
   **Send scheduled WhatsApp messages > Run workflow**. The run's log says Sent or why it failed.

Line breaks inside a row's message are turned into spaces, because WhatsApp doesn't allow them in template values.

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
