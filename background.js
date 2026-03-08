;
// ── background.js ──────────────────────────────────────────────────────────
// Service worker for PrairieLearn Journal Tracker (Manifest V3)
// Handles side panel lifecycle and screenshot relay between content <-> panel.

// ---------------------------------------------------------------------------
// 1. Open the side panel when the extension icon is clicked
// ---------------------------------------------------------------------------
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ---------------------------------------------------------------------------
// 2. Auto-enable the side panel only on PrairieLearn tabs
//    (restricts the action button to PL pages)
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const isPL =
    tab.url &&
    (tab.url.includes('prairielearn.com') || tab.url.includes('prairielearn.org'));

  if (isPL) {
    // Make the side panel available for this specific tab
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true,
    });
  } else {
    // Disable the panel on non-PL pages (optional — remove if you want it everywhere)
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  }
});

// ---------------------------------------------------------------------------
// 3. Message router — relay messages between content script and side panel
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Screenshot request: side panel asks content script to grab a screenshot
  if (message.type === 'REQUEST_SCREENSHOT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ error: 'No active tab' }); return; }

      // Capture the visible area of the active tab
      chrome.tabs.captureVisibleTab(
        tabs[0].windowId,
        { format: 'png', quality: 90 },
        (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ dataUrl });
          }
        }
      );
    });
    return true; // keep channel open for async response
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
