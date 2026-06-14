/**
 * preload-whatsapp.js
 * Polls WhatsApp Web DOM for unread messages from the target contact.
 * Uses unread COUNT (not just badge presence) so dismiss + new message works correctly.
 */
const { ipcRenderer } = require("electron");

// ─── State ──────────────────────────────────────────────────────────────────────
let config = null;
let pollTimer = null;
let isReady = false;
let lastNotifiedCount = 0; // unread count at the time we last sent 'new-message'
let lastFoundCount = 0; // unread count seen on last tick (for change detection)

// ─── Config ─────────────────────────────────────────────────────────────────────
async function init() {
  config = await ipcRenderer.invoke("get-config");
  console.log(`[WA Monitor] Watching: "${config.contactName}"`);
}

// ─── DOM: find contact and return unread count ───────────────────────────────────
function findContactUnreadCount() {
  // Strategy 1: data-testid (most stable)
  const chatItems = document.querySelectorAll(
    '[data-testid="cell-frame-container"]',
  );

  for (const item of chatItems) {
    const nameEl =
      item.querySelector('[data-testid="cell-frame-title"] span[title]') ||
      item.querySelector('[data-testid="cell-frame-title"] span') ||
      item.querySelector("span[title]");

    if (!nameEl) continue;
    const name = (
      nameEl.getAttribute("title") ||
      nameEl.textContent ||
      ""
    ).trim();
    if (!name.toLowerCase().includes(config.contactName.toLowerCase()))
      continue;

    const badge =
      item.querySelector('[data-testid="icon-unread-count"]') ||
      item.querySelector('[aria-label*="unread" i]') ||
      item.querySelector('span[data-icon="unread-count"]');

    if (!badge) return { count: 0, name };

    // Parse the number; WhatsApp shows "99+" for large counts — treat as 99
    const raw = badge.textContent.trim().replace("+", "");
    const count = parseInt(raw) || 1;
    return { count, name };
  }

  // Strategy 2: fallback span[title] scan
  const allTitles = document.querySelectorAll("span[title]");
  for (const el of allTitles) {
    const name = (el.getAttribute("title") || "").trim();
    if (!name.toLowerCase().includes(config.contactName.toLowerCase()))
      continue;

    let parent = el.parentElement;
    for (let i = 0; i < 8 && parent; i++) {
      const badge =
        parent.querySelector('[data-testid="icon-unread-count"]') ||
        parent.querySelector('[aria-label*="unread" i]');
      if (badge) {
        const raw = badge.textContent.trim().replace("+", "");
        return { count: parseInt(raw) || 1, name };
      }
      parent = parent.parentElement;
    }
    return { count: 0, name };
  }

  return { count: 0, name: null };
}

// ─── Poll Loop ───────────────────────────────────────────────────────────────────
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(() => {
    if (!config || !isReady) return;

    const { count, name } = findContactUnreadCount();

    if (count > 0) {
      // Blink only if unread count is HIGHER than when we last notified.
      // This means: new messages arrived since last blink/dismiss.
      if (count > lastNotifiedCount) {
        console.log(
          `[WA Monitor] 🔴 ${count} unread from "${name}" (was ${lastNotifiedCount})`,
        );
        lastNotifiedCount = count;
        ipcRenderer.send("new-message", name || config.contactName);
      }
    } else {
      // Badge gone — user read the chat
      if (lastFoundCount > 0) {
        console.log(`[WA Monitor] ✅ Read`);
        ipcRenderer.send("message-read");
      }
      lastNotifiedCount = 0; // fully reset so next message triggers fresh
    }

    lastFoundCount = count;
  }, config.checkIntervalMs || 2500);

  console.log(`[WA Monitor] Polling every ${config.checkIntervalMs || 2500}ms`);
}

// ─── IPC from Main ───────────────────────────────────────────────────────────────
ipcRenderer.on("update-contact", (_event, newContact) => {
  if (config) {
    config.contactName = newContact;
    lastNotifiedCount = 0;
    lastFoundCount = 0;
    console.log(`[WA Monitor] Contact → "${newContact}"`);
  }
});

// Dismissed dot without reading in WhatsApp:
// Keep lastNotifiedCount at current count — only re-blink if MORE messages arrive.
ipcRenderer.on("reset-state", () => {
  // lastNotifiedCount stays as-is (= current unread count)
  // lastFoundCount stays as-is
  // Effect: no immediate re-blink; only triggers when count increases beyond current
  console.log(
    `[WA Monitor] Dismissed — watching for new messages (count=${lastNotifiedCount})`,
  );
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────────
window.addEventListener("load", async () => {
  await init();
  console.log("[WA Monitor] Waiting for WhatsApp Web…");

  const waitForChatList = () =>
    new Promise((resolve) => {
      const t = setInterval(() => {
        if (
          document.querySelector("#side") ||
          document.querySelector('[data-testid="chat-list"]') ||
          document.querySelector('[aria-label="Chat list"]')
        ) {
          clearInterval(t);
          resolve();
        }
      }, 1000);
    });

  await waitForChatList();
  isReady = true;
  console.log("[WA Monitor] ✅ Ready");
  startPolling();
});

window.addEventListener("beforeunload", () => {
  if (pollTimer) clearInterval(pollTimer);
  isReady = false;
  lastNotifiedCount = 0;
  lastFoundCount = 0;
});
