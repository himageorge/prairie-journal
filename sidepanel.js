
// ── sidepanel.js ───────────────────────────────────────────────────────────
// All interactivity for the PrairieLearn Journal side panel.
// Communicates with background.js via chrome.runtime.sendMessage.
// Persists data with chrome.storage.local.
// ---------------------------------------------------------------------------
import { getSocraticExplanation, sendChatMessage } from './popup.js';

// TODO: flashcard generation does not render latex, prolly download mathjax? and it should
// render when exported to anki
// how many flashcards to generate?

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ════════════════════════════════════════════════════════════════════════════
const STORAGE_KEY_JOURNALS = 'pl_journals';
const STORAGE_KEY_CONTEXT  = 'pl_last_context';

let _pageContext   = {};   // injected by content script via background
let _screenshot    = null; // auto-captured screenshot (used by AI only, not stored)
let _aiFeedback    = null; // cached AI response for current reasoning
let _questionData  = {};   // Q&A from content script, cached for saveEntry
let _chatHistory      = [];   // conversation history for follow-up messages
let _initialReflection = ''; // first reflection text (textarea is cleared after send)

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

  // Sblit out triple-backtick code blocks first
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
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    const ulMatch = line.match(/^[-*]\s+(.*)/);

    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
    } else if (olMatch) {
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
  const existingIdx = entries.findIndex(e => e.key === entry.key);
  if (existingIdx !== -1) {
    // Update in place rather than duplicating, and bubble it to the front
    // since it's now the most recently touched entry.
    const prev = entries[existingIdx];
    entries.splice(existingIdx, 1);
    entries.unshift({ ...prev, ...entry });
  } else {
    entries.unshift(entry);
  }
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

  restoreSavedConversation(ctx);
}

// Tracks which variant key we've already restored so double context-fires don't duplicate messages.
let _restoredForKey = null;

async function restoreSavedConversation(ctx) {
  const key = journalKey(
    ctx.course   || '',
    ctx.module   || '',
    ctx.question || '',
    ctx.variant  || ''
  );

  if (key === _restoredForKey) return; // same variant already handled
  _restoredForKey = key;

  // Clear chat state for the new context
  const chatMessages = document.getElementById('chatMessages');
  const aiBox        = document.getElementById('aiResponseBox');
  if (chatMessages) chatMessages.innerHTML = '';
  if (aiBox)        aiBox.style.display = 'none';
  _chatHistory       = [];
  _aiFeedback        = null;
  _initialReflection = '';

  // Clear any leftover quick note from a previous variant
  const noteTa = document.getElementById('inputNote');
  if (noteTa) { noteTa.value = ''; autoResize(noteTa); }
  const noteRender = document.getElementById('renderNote');
  if (noteRender) noteRender.innerHTML = '';

  if (!key) return;

  const journals = await loadJournals();
  const entry = journals.find(e => e.key === key);
  if (!entry) return;

  // Restore the previous quick note so re-adding to it updates rather than overwrites
  if (entry.quickNote && noteTa) {
    noteTa.value = entry.quickNote;
    autoResize(noteTa);
    if (noteRender) noteRender.innerHTML = markdownToHtml(entry.quickNote);
  }

  // Restore session state so follow-up messages use the saved history
  _initialReflection = entry.reflection || '';
  _aiFeedback        = entry.aiFeedback || null;
  if (entry.reflection && entry.aiFeedback) {
    _chatHistory = [
      { role: 'user',      content: entry.reflection },
      { role: 'assistant', content: entry.aiFeedback }
    ];
  }

  // Render previous conversation in the chat UI
  const divider = document.createElement('div');
  divider.className   = 'session-divider';
  divider.textContent = `continuing from ${entry.timestamp || 'previous session'}`;
  chatMessages.appendChild(divider);

  if (entry.reflection) appendChatMessage('user',      entry.reflection);
  if (entry.aiFeedback) appendChatMessage('assistant', entry.aiFeedback);

  if (aiBox) aiBox.style.display = 'flex';
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

function appendChatMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const aiBox = document.getElementById('aiResponseBox');

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  const label = document.createElement('div');
  label.className = 'chat-msg-label';
  label.textContent = role === 'user' ? 'You' : 'TA';

  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  body.innerHTML = markdownToHtml(text);

  msg.appendChild(label);
  msg.appendChild(body);
  container.appendChild(msg);

  aiBox.style.display = 'flex';
  aiBox.scrollTop = aiBox.scrollHeight;
}

async function runAI() {
  const ta = document.getElementById('inputReflection');
  const reflection = ta.value.trim();
  if (!reflection) return;

  const { course, question } = getContextValues();
  const isFirstMessage = _chatHistory.length === 0;

  if (isFirstMessage) {
    _questionData = {};
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        _questionData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_QUESTION' });
      }
    } catch (e) { console.warn(e); }
  }

  // Show user message and clear input
  appendChatMessage('user', reflection);
  ta.value = ''; autoResize(ta);
  document.getElementById('renderReflection').innerHTML = '';

  showToast('TA is thinking...');

  if (isFirstMessage) _initialReflection = reflection;

  let response;
  if (isFirstMessage) {
    const initialApiMsg = `Course: ${course || "General"}
Topic: ${question || "Unknown Question"}
Question: ${_questionData?.questionText || "No question text found"}
Student Answer: ${_questionData?.myAnswerText || "No answer provided"}
Correct Answer: ${_questionData?.correctAnswer || "Not available"}
Student Logic: "${reflection}"

Identify the gaps in the student's understanding and explain how to find the correct answer using the Socratic method.`;

    response = await getSocraticExplanation({
      course: course || "General",
      questionTitle: question || "Unknown Question",
      questionText: _questionData?.questionText || "No question text found",
      myAnswer: _questionData?.myAnswerText || "No answer provided",
      correctAnswer: _questionData?.correctAnswer || "Not available",
      myReasoning: reflection,
      screenshot: _screenshot || null
    });

    _chatHistory.push({ role: 'user', content: initialApiMsg });
    _chatHistory.push({ role: 'assistant', content: response });
  } else {
    response = await sendChatMessage(_chatHistory, reflection);
    _chatHistory.push({ role: 'user', content: reflection });
    _chatHistory.push({ role: 'assistant', content: response });
  }

  appendChatMessage('assistant', response);
  _aiFeedback = response;
  showToast('TA responded!');
}

async function saveEntry() {
  const pendingReflection = document.getElementById('inputReflection').value.trim();
  const quickNote = document.getElementById('inputNote').value.trim();

  // Saving requires an explanation already obtained via Enter — never trigger the AI here.
  if (!_chatHistory.length) {
    showToast(pendingReflection ? 'Enter to get the explanation before saving.': 'Please write a reflection first.');
    return;
  }

  const { course, module, question, variant } = getContextValues();

  const entry = {
    key: journalKey(course, module, question, variant),
    course, module, question, variant,
    reflection: _initialReflection, quickNote, aiFeedback: _aiFeedback,
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
  _aiFeedback        = null;
  _screenshot        = null;
  _questionData      = {};
  _chatHistory       = [];
  _initialReflection = '';
  _restoredForKey    = null; // allow re-restoration if user navigates away and back
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
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