
// ── sidepanel.js ───────────────────────────────────────────────────────────
// All interactivity for the PrairieLearn Journal side panel.
// Communicates with background.js via chrome.runtime.sendMessage.
// Persists data with chrome.storage.local.
// ---------------------------------------------------------------------------
import { getSocraticExplanation } from './popup.js';


// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ════════════════════════════════════════════════════════════════════════════
const STORAGE_KEY_JOURNALS = 'pl_journals';
const STORAGE_KEY_CONTEXT  = 'pl_last_context';

let _pageContext   = {};   // injected by content script via background
let _screenshot    = null; // auto-captured screenshot (used by AI only, not stored)
let _aiFeedback    = null; // cached AI response for current reasoning
let _questionData  = {};   // Q&A from content script, cached for saveEntry

// ════════════════════════════════════════════════════════════════════════════
// MARKDOWN → HTML
// ════════════════════════════════════════════════════════════════════════════

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markdownToHtml(text) {
  if (!text) return '';

  // Split out triple-backtick code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);
  return segments.map((seg, i) => {
    if (i % 2 === 1) {
      // code block — strip the backtick fences and optional language tag
      const code = seg.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
      return `<pre><code>${escHtml(code)}</code></pre>`;
    }
    return renderMarkdownLines(seg);
  }).join('');
}

function renderMarkdownLines(text) {
  const lines = text.split('\n');
  const out = [];
  let inOl = false, inUl = false;

  const flush = () => {
    if (inOl) { out.push('</ol>'); inOl = false; }
    if (inUl) { out.push('</ul>'); inUl = false; }
  };

  const inline = s => {
    let t = escHtml(s);
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g,     '<em>$1</em>');
    t = t.replace(/`([^`]+)`/g,     '<code>$1</code>');
    return t;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    const ulMatch = line.match(/^[-*]\s+(.*)/);

    if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(olMatch[2])}</li>`);
    } else if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(ulMatch[1])}</li>`);
    } else if (line === '') {
      flush();
      out.push('<br>');
    } else {
      flush();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join('');
}

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
// SCREENSHOT  (auto-captured when panel opens, invisible to user)
// ════════════════════════════════════════════════════════════════════════════

function loadCapturedScreenshot() {
  chrome.storage.local.get(['pl_temp_screenshot'], result => {
    if (result.pl_temp_screenshot) {
      _screenshot = result.pl_temp_screenshot;
      // remove from storage so it doesn't linger
      chrome.storage.local.remove(['pl_temp_screenshot']);
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SAVE ENTRY
// ════════════════════════════════════════════════════════════════════════════

async function runAI() {
  const reflection = document.getElementById('inputReflection').value.trim();
  if (!reflection) return;

  showToast(' TA is thinking...');

  const { course, question } = getContextValues();

  _questionData = {};
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      _questionData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_QUESTION' });
    }
  } catch (e) { console.warn(e); }

  _aiFeedback = await getSocraticExplanation({
    course: course || "General",
    questionTitle: question || "Unknown Question",
    questionText: _questionData?.questionText || "No question text found",
    myAnswer: _questionData?.myAnswerText || "No answer provided",
    correctAnswer: _questionData?.correctAnswer || "Not available",
    myReasoning: reflection,
    screenshot: _screenshot || null
  });

  const aiDisplay = document.getElementById('aiText');
  const aiBox = document.getElementById('aiResponseBox');
  if (aiDisplay && aiBox) {
    aiDisplay.innerHTML = markdownToHtml(_aiFeedback);
    aiBox.style.display = 'block';
  }

  showToast('AI feedback ready!');
}

async function saveEntry() {
  const reflection = document.getElementById('inputReflection').value.trim();
  const quickNote  = document.getElementById('inputNote').value.trim();

  if (!reflection) {
    showToast('⚠️ Please write a reflection first.');
    return;
  }

  // Run AI now if the user skipped Enter
  if (!_aiFeedback) await runAI();

  const { course, module, question, variant } = getContextValues();

  const entry = {
    key: journalKey(course, module, question, variant),
    course, module, question, variant,
    reflection, quickNote, aiFeedback: _aiFeedback,
    url: _pageContext.url || _questionData?.url || '',
    timestamp: new Date().toLocaleString()
  };

  await insertEntry(entry);
  showToast('✓ Saved!');
  clearForm();
}

// ════════════════════════════════════════════════════════════════════════════
// CLEAR FORM
// ════════════════════════════════════════════════════════════════════════════

function clearForm() {
  const taR = document.getElementById('inputReflection');
  const taN = document.getElementById('inputNote');
  taR.value = ''; autoResize(taR);
  taN.value = ''; autoResize(taN);
  document.getElementById('renderReflection').innerHTML = '';
  document.getElementById('renderNote').innerHTML = '';
  _aiFeedback = null;
  _screenshot = null;
  _questionData = {};
  const aiBox = document.getElementById('aiResponseBox');
  if (aiBox) aiBox.style.display = 'none';
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


// ════════════════════════════════════════════════════════════════════════════
// LIVE FIELD  — transparent textarea + rendered div underneath
// ════════════════════════════════════════════════════════════════════════════

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function setupLiveField(textareaId, renderId) {
  const ta  = document.getElementById(textareaId);
  const div = document.getElementById(renderId);
  if (!ta || !div) return;

  const update = () => {
    div.innerHTML = markdownToHtml(ta.value);
    autoResize(ta);
  };

  ta.addEventListener('input', update);
  if (ta.value) update();
}

document.addEventListener('DOMContentLoaded', async () => {
  // Restore last known context
  chrome.storage.local.get([STORAGE_KEY_CONTEXT], result => {
    if (result[STORAGE_KEY_CONTEXT]) {
      applyContext(result[STORAGE_KEY_CONTEXT]);
    }
  });

  // Actively request fresh context from the active tab
  chrome.runtime.sendMessage({ type: 'REQUEST_CONTEXT' });

  // Load the auto-captured screenshot (grabbed when the panel was opened)
  loadCapturedScreenshot();

  // --- Event Listeners (CSP Compliant) ---

  // Trigger AI on Enter in reasoning textarea (Shift+Enter still adds a newline)
  document.getElementById('inputReflection').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runAI();
    }
  });

  // Save Button
  document.getElementById('saveBtn').addEventListener('click', saveEntry);

  // Dashboard Button
  document.getElementById('dashBtn').addEventListener('click', () => {
    const url = chrome.runtime.getURL("dashboard.html");
    chrome.tabs.create({ url });
  });

  // General Form Clear Button
  document.getElementById('clearFormBtn').addEventListener('click', clearForm);

  // Live field setup — transparent textarea over a rendered markdown div
  setupLiveField('inputReflection', 'renderReflection');
  setupLiveField('inputNote',       'renderNote');
});