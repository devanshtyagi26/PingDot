const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");

// ─── Force writable userData path (fixes cache errors in packaged/portable exe) ─
// Must be called before app is ready, before any windows or sessions are created.
app.setPath("userData", path.join(app.getPath("appData"), "PingDot"));

// ─── Config ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, "config.json");

function getIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.ico")
    : path.join(__dirname, "assets", "icon.ico");
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {
      contactName: "Mom",
      checkIntervalMs: 2500,
      dotSize: 22,
      dotX: 16,
      dotY: 16,
      dotColor: "#25D366",
      showDotWhenIdle: true,
    };
  }
}

function saveConfig(newConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), "utf8");
}

let config = loadConfig();

// ─── App State ─────────────────────────────────────────────────────────────────
let overlayWindow = null;
let whatsappWindow = null;
let tray = null;
let isBlinking = false;
let isQuitting = false;

// ─── Helper: SVG → nativeImage ──────────────────────────────────────────────────
function svgToNativeImage(svg, size = 16) {
  const b64 = Buffer.from(svg).toString("base64");
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${b64}`);
  return img.resize({ width: size, height: size });
}

app.setAppUserModelId("com.Devansh.PingDot");

// ─── Overlay Window ────────────────────────────────────────────────────────────
function createOverlayWindow() {
  const { dotSize, dotSide, dotY } = config;
  const padding = 8; // extra space for glow shadow
  const margin = 16;
  const tooltipWidth = 200; // room for the tooltip text
  const dotH = dotSize + padding * 2;
  // Window is wide enough to show tooltip; dot sits at one edge
  const dotW = dotSize + padding * 2 + tooltipWidth;
  const screenWidth = screen.getPrimaryDisplay().workAreaSize.width;

  const dotX =
    dotSide === "right"
      ? screenWidth - dotW - margin // right-aligned: right edge near screen edge
      : margin - padding; // left-aligned: left edge near screen edge

  overlayWindow = new BrowserWindow({
    width: dotW,
    height: dotH,
    x: dotX,
    y: dotY - padding,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: false, // never steal focus
    // icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile("overlay.html", {
    query: { side: dotSide || "left" },
  });

  // Keep above EVERYTHING including fullscreen apps
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Fully click-through by default — toggled off when mouse is over the dot
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

// ─── WhatsApp Window ───────────────────────────────────────────────────────────
function createWhatsAppWindow() {
  const CHROME_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

  // Declare BEFORE using in webPreferences
  const { session } = require("electron");
  const waSession = session.fromPartition("persist:whatsapp");
  waSession.setUserAgent(CHROME_UA);

  whatsappWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: "WhatsApp — Vigil",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-whatsapp.js"),
      contextIsolation: true,
      nodeIntegration: false,
      session: waSession,
    },
  });

  whatsappWindow.loadURL("https://web.whatsapp.com");

  whatsappWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      whatsappWindow.hide();
    }
  });

  whatsappWindow.on("closed", () => {
    whatsappWindow = null;
  });
}

// ─── Tray ──────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: `👀  Watching: "${config.contactName}"`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "💬  Open WhatsApp Web",
      click: () => {
        if (whatsappWindow) {
          whatsappWindow.show();
          whatsappWindow.focus();
        }
      },
    },
    {
      label: "✏️  Change Contact…",
      click: () => promptChangeContact(),
    },
    {
      label: "⚙️  Open config.json",
      click: () => shell.openPath(CONFIG_PATH),
    },
    { type: "separator" },
    {
      label: `${isBlinking ? "🔴  Stop blinking" : "⚪  Not blinking"}`,
      enabled: isBlinking,
      click: () => stopBlinking(),
    },
    { type: "separator" },
    {
      label: "❌  Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  }

  if (!trayIcon || trayIcon.isEmpty()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
      <circle cx="8" cy="8" r="7" fill="${config.dotColor}"/>
    </svg>`;
    trayIcon = svgToNativeImage(svg, 16);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("PingDot");
  tray.setContextMenu(buildTrayMenu());

  tray.on("double-click", () => {
    if (whatsappWindow) {
      whatsappWindow.show();
      whatsappWindow.focus();
    }
  });
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ─── Contact Change Dialog ─────────────────────────────────────────────────────
function promptChangeContact() {
  // Electron doesn't have an input dialog natively —
  // we open a tiny BrowserWindow with an input form.
  const inputWin = new BrowserWindow({
    width: 380,
    height: 180,
    resizable: false,
    alwaysOnTop: true,
    frame: true,
    title: "Change Contact",
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `
  <!DOCTYPE html><html><head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; padding: 24px; background: #fff; }
    label { font-size: 13px; color: #555; display: block; margin-bottom: 6px; }
    input {
      width: 100%; padding: 8px 12px; border: 1px solid #ddd;
      border-radius: 6px; font-size: 14px; outline: none;
    }
    input:focus { border-color: #25D366; }
    .row { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
    button {
      padding: 7px 20px; border: none; border-radius: 6px;
      font-size: 13px; cursor: pointer;
    }
    .save { background: #25D366; color: #fff; }
    .cancel { background: #eee; color: #333; }
  </style>
  </head><body>
  <label>Enter the contact name exactly as shown in WhatsApp:</label>
  <input id="inp" type="text" value="${config.contactName}" autofocus />
  <div class="row">
    <button class="cancel" onclick="window.close()">Cancel</button>
    <button class="save" onclick="save()">Save</button>
  </div>
  <script>
    function save() {
      const v = document.getElementById('inp').value.trim();
      if (v) { window.electronAPI && window.electronAPI.dismiss(); }
      fetch('about:blank'); // can't use IPC directly, use title trick
      document.title = 'SAVE:' + v;
      window.close();
    }
    document.getElementById('inp').addEventListener('keydown', e => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') window.close();
    });
  </script>
  </body></html>`;

  inputWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

  inputWin.on("page-title-updated", (e, title) => {
    if (title.startsWith("SAVE:")) {
      const newContact = title.slice(5).trim();
      if (newContact) {
        config.contactName = newContact;
        saveConfig(config);
        refreshTray();
        // Tell the WhatsApp preload about the new contact
        if (whatsappWindow) {
          whatsappWindow.webContents.send("update-contact", newContact);
        }
        dialog.showMessageBox({
          title: "Contact Updated",
          message: `Now watching: "${newContact}"`,
          buttons: ["OK"],
        });
      }
    }
  });
}

// ─── Blinking State ────────────────────────────────────────────────────────────
function startBlinking(contactName) {
  if (isBlinking) return;
  isBlinking = true;
  overlayWindow?.webContents.send("start-blink", contactName);
  refreshTray();
}

function stopBlinking() {
  if (!isBlinking) return;
  isBlinking = false;
  overlayWindow?.webContents.send("stop-blink");
  // Tell the WhatsApp monitor to reset lastState so it can re-trigger
  whatsappWindow?.webContents.send("reset-state");
  refreshTray();
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────
ipcMain.handle("get-config", () => config);

// Toggle click-through on the overlay (called from renderer on mouse enter/leave dot)
ipcMain.on("set-ignore-mouse", (_e, ignore) => {
  overlayWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

// From WhatsApp preload: new unread message detected
ipcMain.on("new-message", (_event, contactName) => {
  startBlinking(contactName);
});

// From WhatsApp preload: the unread badge disappeared (user read the message)
ipcMain.on("message-read", () => {
  stopBlinking();
});

// From overlay: user clicked the dot to dismiss
ipcMain.on("dismiss", () => {
  stopBlinking();
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createOverlayWindow();
  createWhatsAppWindow();
  createTray();
});

app.on("window-all-closed", (e) => {
  // Prevent app from quitting when windows are closed
  if (!isQuitting) e.preventDefault();
});

app.on("before-quit", () => {
  isQuitting = true;
});
