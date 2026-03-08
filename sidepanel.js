// ── sidepanel.js ───────────────────────────────────────────────────────────
// All interactivity for the PrairieLearn Journal side panel.
// Communicates with background.js via chrome.runtime.sendMessage.
// Persists data with chrome.storage.local.
// ---------------------------------------------------------------------------
'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ════════════════════════════════════════════════════════════════════════════
const STORAGE_KEY_JOURNALS = 'pl_journals';
const STORAGE_KEY_CONTEXT  = 'pl_last_context';

let _pageContext   = {};   // injected by content script via background
let _screenshot    = null; // current base64 PNG

// ════════════════════════════════════════════════════════════════════════════
// STORAGE HELPERS  (chrome.storage.local)
// ════════════════════════════════════════════════════════════════════════════

function loadJournals() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY_JOURNALS], result => {
      resolve(result[STORAGE_KEY_JOURNALS] || []);
    });
  });
}

function saveJournals(entries) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY_JOURNALS]: entries }, resolve);
  });
}


function journalKey(course, module, question, variant) {
  return [course, module, question, variant].filter(Boolean).join('||');
}

async function insertEntry(entry) {
  const entries = await loadJournals();
  entries.unshift(entry);
  await saveJournals(entries);
  console.log('Saved entries:', entries);
}

// ════════════════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════════════════

let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE CONTEXT
// ════════════════════════════════════════════════════════════════════════════

function applyContext(ctx) {
  if (!ctx) return;
  _pageContext = ctx;

  function setChip(id, value, prefix) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value) {
      el.textContent = value;
      el.classList.add('filled');
    } else {
      el.textContent = prefix + ' —';
      el.classList.remove('filled');
    }
  }

  setChip('ctxCourse',   ctx.course,   'Course');
  setChip('ctxModule',   ctx.module,   'Module');
  setChip('ctxQuestion', ctx.question, 'Question');
  setChip('ctxVariant',  ctx.variant,  'Variant');

}


function getContextValues() {
  const course   = _pageContext.course   || 'Unknown';
  const module   = _pageContext.module   || 'Unknown';
  const question = _pageContext.question || 'Unknown';
  const variant  = _pageContext.variant  || 'Unknown';
  return { course, module, question, variant };
}

// ════════════════════════════════════════════════════════════════════════════
// SCREENSHOT
// ════════════════════════════════════════════════════════════════════════════

function captureScreenshot() {
  showToast('Capturing screenshot…');
  chrome.runtime.sendMessage({ type: 'REQUEST_SCREENSHOT' }, response => {
    if (chrome.runtime.lastError || response?.error) {
      showToast('⚠️ Could not capture screenshot');
      console.error(chrome.runtime.lastError || response.error);
      return;
    }
    _screenshot = response.dataUrl;
    const img = document.getElementById('screenshotPreview');
    img.src = _screenshot;
    img.classList.add('visible');
    document.getElementById('clearSsBtn').style.display = '';
    showToast('Screenshot captured ✓');
  });
}

function clearScreenshot() {
  _screenshot = null;
  const img = document.getElementById('screenshotPreview');
  img.src = '';
  img.classList.remove('visible');
  document.getElementById('clearSsBtn').style.display = 'none';
}

// ════════════════════════════════════════════════════════════════════════════
// SAVE ENTRY
// ════════════════════════════════════════════════════════════════════════════

async function saveEntry() {
  const reflection = document.getElementById('inputReflection').value.trim();
  const quickNote  = document.getElementById('inputNote').value.trim();

  if (!reflection) {
    showToast('⚠️ Please write a reflection first.');
    document.getElementById('inputReflection').focus();
    return;
  }

  const { course, module, question, variant } = getContextValues();
  const key = journalKey(course, module, question, variant);
  const timestamp = new Date().toLocaleString();

  const entry = {
    key, course, module, question, variant,
    reflection, quickNote,
    screenshot: _screenshot,
    timestamp,
  };

  await insertEntry(entry);

  // Notify background so content script can show in-page confirmation
  chrome.runtime.sendMessage({ type: 'ENTRY_SAVED', payload: entry }).catch(() => {});

  showToast('✓ Journal entry saved!');
  clearForm();
}

// ════════════════════════════════════════════════════════════════════════════
// CLEAR FORM
// ════════════════════════════════════════════════════════════════════════════

function clearForm() {
  document.getElementById('inputReflection').value = '';
  document.getElementById('inputNote').value = '';
  clearScreenshot();
}

// ════════════════════════════════════════════════════════════════════════════
// MESSAGE LISTENER — receives context from background (relayed from content)
// ════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'UPDATE_CONTEXT') {
    applyContext(message.payload);
    // Cache it
    chrome.storage.local.set({ [STORAGE_KEY_CONTEXT]: message.payload });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // Restore last known context (from storage, in case panel was closed/reopened)
  chrome.storage.local.get([STORAGE_KEY_CONTEXT], result => {
    if (result[STORAGE_KEY_CONTEXT]) {
      applyContext(result[STORAGE_KEY_CONTEXT]);
    }
  });

  // Actively request fresh context from the active tab's content script
  chrome.runtime.sendMessage({ type: 'REQUEST_CONTEXT' });

  document.getElementById('saveBtn').addEventListener('click', saveEntry);
  
  document.getElementById('dashBtn').addEventListener('click', () => {
    const url = chrome.runtime.getURL("dashboard.html");
    chrome.tabs.create({ url });
  });
});

