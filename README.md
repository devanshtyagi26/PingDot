# 🟢 WhatsApp Dot Notifier

A tiny always-on-top green dot in the corner of your screen that **blinks when a specific person messages you on WhatsApp** — regardless of what you're doing on your PC.

---

## How it works

```
WhatsApp Web (hidden window)
  └── preload-whatsapp.js polls the DOM every 2.5s
        └── detects unread badge for your contact
              └── IPC → main.js → tells overlay to blink
```

- Built with **Electron** only (no Puppeteer, no extra Chromium).
- WhatsApp Web runs in a **hidden BrowserWindow** (same session as normal use).
- The overlay is a **frameless, transparent, always-on-top** window that floats over everything.
- Auto-stops blinking when you open WhatsApp and read the message.

---

## Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18 or newer
- Windows 10/11

### 2. Install & run

```bash
# Clone or download this folder, then:
cd whatsapp-dot-notifier
npm install
npm start
```

### 3. Log in to WhatsApp Web
On first launch, a WhatsApp Web window opens. Scan the QR code with your phone.  
After login, you can minimize or hide that window — it stays running in the background.

### 4. Set your contact name

Edit `config.json`:

```json
{
  "contactName": "Mom"
}
```

The name must match **how the contact appears in your WhatsApp chat list** (partial match works, e.g. `"Mom"` matches `"Mom 😊"`).

You can also change it live from the **system tray icon → Change Contact…**

---

## Configuration (`config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `contactName` | `"Mom"` | Name to watch (partial, case-insensitive) |
| `checkIntervalMs` | `2500` | How often to poll (ms). Lower = faster but more CPU |
| `dotSize` | `22` | Dot diameter in pixels |
| `dotX` | `16` | X position from top-left of screen |
| `dotY` | `16` | Y position from top-left of screen |
| `dotColor` | `"#25D366"` | Dot color (WhatsApp green by default) |
| `showDotWhenIdle` | `true` | Show faint dot even when no new messages |

---

## Usage

| Action | Result |
|--------|--------|
| **Dot blinks green** | You have an unread message from your contact |
| **Click the dot** | Dismiss the blink notification |
| **Contact reads back** | Blink stops automatically |
| **Tray icon → Open WhatsApp** | Opens the WhatsApp Web window |
| **Tray icon → Change Contact** | Set a new contact without restarting |
| **Tray icon → Quit** | Exits the app |

---

## Build a `.exe` (optional)

```bash
npm run build
```

Output will be in `dist/` as a portable `.exe` — no installer needed.

---

## Troubleshooting

**Dot not blinking?**
- Make sure the contact name in `config.json` matches exactly what appears in your WhatsApp chat list.
- Open the WhatsApp Web window and verify you're still logged in.
- Ensure there's actually an unread message badge (blue circle with number) next to that chat.

**WhatsApp asks me to log in every time?**
- Electron stores the session in your app's user data folder automatically. Don't clear Electron's user data.

**Dot appears behind full-screen apps?**
- The overlay uses the `screen-saver` level which should float above full-screen windows on Windows 10/11. Some games using exclusive full-screen mode may still cover it.

---

## Limitations

- Requires WhatsApp Web to be loaded in the background (the hidden Electron window).
- Only works while the app is running.
- WhatsApp Web's internal DOM structure occasionally changes with updates — if it breaks, open an issue.
