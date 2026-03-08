// ── background.js ──────────────────────────────────────────────────────────
// Service worker for PrairieLearn Journal Tracker (Manifest V3)
// Handles side panel lifecycle and screenshot relay between content <-> panel.

// ---------------------------------------------------------------------------
// 1. Open the side panel when the extension icon is clicked
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "togglePanel" });
});

// ---------------------------------------------------------------------------
// 2. Auto-enable the side panel only on PrairieLearn tabs
//    (restricts the action button to PL pages) -> not working!!!!!!!!!!!!
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
  if (message.type === 'OPEN_SIDE_PANEL') {
    chrome.sidePanel.open({ tabId: sender.tab.id });
    return false;
  }

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

  // ── Side panel asks for fresh context on open
  if (message.type === 'REQUEST_CONTEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CONTEXT' }, (ctx) => {
        if (chrome.runtime.lastError || !ctx) return;
        chrome.runtime.sendMessage({ type: 'UPDATE_CONTEXT', payload: ctx }).catch(() => {});
      });
    });
    return true;
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
// 3. go to dashboard
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