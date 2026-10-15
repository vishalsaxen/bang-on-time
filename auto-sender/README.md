# Bang On Time: automatic WhatsApp sender

Sends each row of your Excel file (name, mobile, message, time, sender) as a WhatsApp
message, with your image, automatically on the date and at the exact time you pick.
It sends from your own WhatsApp, linked once by QR code the same way WhatsApp Web is.

## One-time setup
1. Install Node.js (LTS) from https://nodejs.org.
2. Put this folder anywhere on your computer.
3. Windows: double-click `start.bat`. Mac/Linux: open a terminal here and run `npm install` then `npm start`.
4. The page http://localhost:3000 opens by itself once the app is ready (or open it yourself when the window says "running at").
5. On your phone (the number in column E): WhatsApp > Settings > Linked devices > Link a device, and scan the QR code on the page. You only do this once.

## Each time
1. Upload the image and the Excel file.
2. Pick the date on the calendar and check each row's time.
3. Press **Schedule messages**. Each message goes out by itself at its time.

Keep the app running and the computer awake until the last message is sent. You can close the browser tab.
If the app was off when a message was due (more than 10 minutes), it is marked "Missed" rather than sent late.

## Start fresh
- Press **Clear all entries** on the page. Every entry is removed and WhatsApp stays linked.
- Or by hand: close the black window, delete `data\jobs.json`, and start `start.bat` again.
- To also unlink WhatsApp, delete the whole `data` folder. You will need to scan the QR code again.

## Try it without sending anything
Run `npm run dry-run`. Messages are printed in the terminal instead of sent.

## Good to know
- This uses WhatsApp Web unofficially (the whatsapp-web.js library). WhatsApp can ban numbers that send bulk
  or spammy messages this way, so keep it to people who know you. For large volumes, the official WhatsApp Business API is the safe route.
- 10-digit numbers get the country code from the page (default 91).
- Your WhatsApp login and the schedule are stored in the `data` folder. Delete it to unlink.
