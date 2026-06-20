// ── background.js ──────────────────────────────────────────────────────────
// Service worker for PrairieLearn Journal Tracker (Manifest V3)
// Handles side panel lifecycle and screenshot relay between content <-> panel.

// ---------------------------------------------------------------------------
// 1. Open the side panel when the extension icon is clicked
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener(async (tab) => {
  // Ask the content script whether this is a practice module.
  // If the content script isn't running (non-PL page) the sendMessage rejects — bail silently.
  let isPractice = false;
  try {
    const check = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_PAGE' });
    isPractice = check?.isPractice || false;
  } catch (e) {
    return; // not a PL page — do nothing
  }

  if (!isPractice) {
    // Tell the content script to show the "practice questions only" tease
    chrome.tabs.sendMessage(tab.id, { action: 'showTease' }).catch(() => {});
    return;
  }

  // It's a practice page — open the panel
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn('Prairie Journal: could not open side panel', e);
  }

  // Capture screenshot while activeTab permission is fresh
  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 82 }, dataUrl => {
    if (!chrome.runtime.lastError && dataUrl) {
      chrome.storage.local.set({ pl_temp_screenshot: dataUrl });
    }
  });
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