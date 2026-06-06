/**
 * preload-whatsapp.js
 * Injected into the WhatsApp Web BrowserWindow.
 * Polls the DOM for unread messages from the target contact
 * and sends IPC messages to the main process.
 *
 * NOTE: Runs in Electron's privileged preload context —
 * not affected by WhatsApp's Content Security Policy.
 */
const { ipcRenderer } = require('electron');

// ─── State ──────────────────────────────────────────────────────────────────────
let config = null;
let pollTimer = null;
let lastState = false; // was unread badge visible last tick?
let isReady = false;

// ─── Fetch config from main process ────────────────────────────────────────────
async function init() {
  config = await ipcRenderer.invoke('get-config');
  console.log(`[WA Monitor] Config loaded. Watching: "${config.contactName}"`);
}

// ─── DOM Selectors (multiple fallbacks for WhatsApp Web resilience) ─────────────
/**
 * Returns { found: boolean, name: string|null } for the target contact's chat item.
 */
function findContactUnread() {
  // Strategy 1: data-testid based (most stable)
  const chatItems = document.querySelectorAll('[data-testid="cell-frame-container"]');

  for (const item of chatItems) {
    // Get display name — try several possible elements
    const nameEl =
      item.querySelector('[data-testid="cell-frame-title"] span[title]') ||
      item.querySelector('[data-testid="cell-frame-title"] span') ||
      item.querySelector('span[title]');

    if (!nameEl) continue;

    const name = (nameEl.getAttribute('title') || nameEl.textContent || '').trim();
    if (!name) continue;

    // Case-insensitive partial match (handles "Mom 😊" matching "Mom")
    if (name.toLowerCase().includes(config.contactName.toLowerCase())) {
      // Check for unread badge
      const badge =
        item.querySelector('[data-testid="icon-unread-count"]') ||
        item.querySelector('[aria-label*="unread" i]') ||
        item.querySelector('span[data-icon="unread-count"]');

      return { found: !!badge, name };
    }
  }

  // Strategy 2: scan all spans with titles if strategy 1 found nothing
  // (fallback for when WhatsApp updates its testids)
  const allTitles = document.querySelectorAll('span[title]');
  for (const el of allTitles) {
    const name = (el.getAttribute('title') || '').trim();
    if (!name.toLowerCase().includes(config.contactName.toLowerCase())) continue;

    // Walk up to find the list item and look for badge
    let parent = el.parentElement;
    for (let i = 0; i < 8 && parent; i++) {
      const badge =
        parent.querySelector('[data-testid="icon-unread-count"]') ||
        parent.querySelector('[aria-label*="unread" i]');
      if (badge) return { found: true, name };
      parent = parent.parentElement;
    }
    return { found: false, name };
  }

  return { found: false, name: null };
}

// ─── Poll Loop ─────────────────────────────────────────────────────────────────
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(() => {
    if (!config || !isReady) return;

    const { found, name } = findContactUnread();

    if (found && !lastState) {
      // Transition: no unread → unread
      console.log(`[WA Monitor] 🔴 Unread message from "${name}"`);
      ipcRenderer.send('new-message', name || config.contactName);
    } else if (!found && lastState) {
      // Transition: unread → read (user opened the chat)
      console.log(`[WA Monitor] ✅ Message read / no longer unread`);
      ipcRenderer.send('message-read');
    }

    lastState = found;
  }, config.checkIntervalMs || 2500);

  console.log(`[WA Monitor] Polling every ${config.checkIntervalMs || 2500}ms`);
}

// ─── Wait for WhatsApp Web to Load ─────────────────────────────────────────────
function waitForChatList() {
  return new Promise((resolve) => {
    // WhatsApp renders a side pane once fully loaded and logged in
    const check = setInterval(() => {
      const ready =
        document.querySelector('#side') ||
        document.querySelector('[data-testid="chat-list"]') ||
        document.querySelector('[aria-label="Chat list"]');

      if (ready) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });
}

// ─── Handle Contact Updates from Main ──────────────────────────────────────────
ipcRenderer.on('update-contact', (_event, newContact) => {
  if (config) {
    config.contactName = newContact;
    lastState = false;
    console.log(`[WA Monitor] Contact updated to: "${newContact}"`);
  }
});

// User dismissed the dot — reset so the next unread can re-trigger
ipcRenderer.on('reset-state', () => {
  lastState = false;
  console.log('[WA Monitor] State reset — ready for next message');
});

// ─── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  await init();

  console.log('[WA Monitor] Waiting for WhatsApp Web to load…');
  await waitForChatList();

  isReady = true;
  console.log('[WA Monitor] ✅ Chat list found. Starting monitor.');
  startPolling();
});

// Safety: if page navigates/refreshes, restart
window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer);
  isReady = false;
  lastState = false;
});
