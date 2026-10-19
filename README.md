# Bang On Time

Send a personalised WhatsApp message (with an image) to each person in a list, at the date and time you choose.

| Folder | What it is | Needs your computer on? |
|---|---|---|
| `index.html` | The scheduling page on its own: load the Excel file, pick a date, see each send time. | Yes (browser) |
| `auto-sender/` | Local app that links your own WhatsApp by QR code and sends each row on time. See its README. | Yes |
| `cloud-sender/` + `.github/workflows/send-scheduled.yml` | Runs on GitHub every 5 minutes and sends due messages through the official WhatsApp Cloud API. See its README. | No |

Excel/CSV columns: **A** name, **B** mobile, **C** message, **D** time, **E** sender. The cloud sender also needs **F** date (YYYY-MM-DD).
