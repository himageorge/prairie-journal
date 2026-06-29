// ── background.js ──────────────────────────────────────────────────────────
// Service worker for PrairieLearn Journal Tracker (Manifest V3)
// Handles side panel lifecycle and screenshot relay between content <-> panel.

// ---------------------------------------------------------------------------
// 1. Open the side panel when the extension icon is clicked
// ---------------------------------------------------------------------------
// Mirrors content.js's title-based practice-question fallback (PRACTICE_RE).
// We use tab.title here (not a message round trip to the content script) so
// the practice check stays synchronous — see note below on sidePanel.open().
const PRACTICE_TITLE_RE = /\bPQ\d|\bP\d|\bFQP\d|\bICA\d/;

chrome.action.onClicked.addListener(async (tab) => {
  const isPL =
    tab.url &&
    (tab.url.includes('prairielearn.com') || tab.url.includes('prairielearn.org'));
  if (!isPL) return; // not a PL page — do nothing

  const isPractice = !!(tab.title && PRACTICE_TITLE_RE.test(tab.title));

  if (!isPractice) {
    chrome.tabs.sendMessage(tab.id, { action: 'showTease' }).catch(() => {});
    return;
  }

  // Open the panel synchronously within the click's user-gesture window.
  // Any awaited work before this call (e.g. messaging the content script)
  // can cause chrome.sidePanel.open() to silently fail — that was the bug,
  // which is why the practice check above uses tab.title instead.
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn('Prairie Journal: could not open side panel', e);
    return;
  }

  // Capture screenshot while activeTab permission is fresh
  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 82 }, dataUrl => {
    if (!chrome.runtime.lastError && dataUrl) {
      chrome.storage.local.set({ pl_temp_screenshot: dataUrl });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The side panel stays enabled globally (via manifest side_panel.default_path)
//    so the toolbar icon is never greyed out — gating to practice questions
//    happens in chrome.action.onClicked below instead of per-tab enable/disable,
//    which didn't reliably re-fire on PrairieLearn's SPA navigation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. Message router — relay messages between content script and side panel
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'OPEN_SIDE_PANEL') {
    const tabId    = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (tabId) {
      chrome.sidePanel.open({ tabId });
      // Capture screenshot now while activeTab is fresh — store for side panel to pick up
      chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 }, dataUrl => {
        if (!chrome.runtime.lastError && dataUrl) {
          chrome.storage.local.set({ pl_temp_screenshot: dataUrl });
        }
      });
    }
    return false;
  }

  // ── Side panel asks for fresh context on open
  if (message.type === 'REQUEST_CONTEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CONTEXT' }, (ctx) => {
        if (chrome.runtime.lastError || !ctx) return;
        chrome.runtime.sendMessage({ type: 'UPDATE_CONTEXT', payload: ctx }).catch(() => {});
      });
    });
    return false; // no sendResponse needed — we broadcast via sendMessage instead
  }

  // ── Page context: content script reports current question metadata
  if (message.type === 'PAGE_CONTEXT') {
    // Broadcast to side panel (side panel listens via chrome.runtime.onMessage)
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONTEXT',
      payload: message.payload,
    }).catch(() => {}); // panel may not be open yet — ignore
    return false;
  }

  // ── New entry notification: side panel saved an entry, ping content script
  if (message.type === 'ENTRY_SAVED') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'ENTRY_SAVED_ACK',
          payload: message.payload,
        }).catch(() => {});
      }
    });
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// 4. go to dashboard
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open Dashboard",
    title: "Go to Dashboard",
    contexts: ["action"]
  });
});

chrome.contextMenus.onClicked.addListener((info) =>{
  if(info.menuItemId == "open Dashboard"){
    const url = chrome.runtime.getURL("dashboard.html");
    chrome.tabs.create({ url });
  }
})