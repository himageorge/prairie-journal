// ── sidepanel.js ───────────────────────────────────────────────────────────
// All interactivity for the PrairieLearn Journal side panel.
// Communicates with background.js via chrome.runtime.sendMessage.
// Persists data with chrome.storage.local.
// ---------------------------------------------------------------------------
console.log('🔍 sidepanel.js starting to load...');
'use strict';
import { getSocraticExplanation } from './popup.js';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ════════════════════════════════════════════════════════════════════════════
const STORAGE_KEY_JOURNALS = 'pl_journals';
const STORAGE_KEY_STARS    = 'pl_stars';
const STORAGE_KEY_CONTEXT  = 'pl_last_context';

let _pageContext   = {};   // injected by content script via background
let _screenshot    = null; // current base64 PNG
let _detailEntryKey = null; // key of entry shown in detail view

// ════════════════════════════════════════════════════════════════════════════
// STORAGE HELPERS  (chrome.storage.local)
// ════════════════════════════════════════════════════════════════════════════

// Replace loadJournals() with this:
async function loadJournals() {
  const result = await chrome.storage.local.get('entries');
  const entries = result.entries || {};
  // Convert object to array for easier iteration
  return Object.entries(entries).map(([key, entry]) => ({
    key,
    ...entry
  }));
}

// Replace saveJournals() with this:
async function saveJournals(entriesArray) {
  // Convert array back to object
  const entries = {};
  entriesArray.forEach(e => {
    const key = `${e.course}|${e.module}|${e.question}|${e.variant}`;
    entries[key] = e;
  });
  await chrome.storage.local.set({ entries });
}


function loadStars() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY_STARS], result => {
      resolve(result[STORAGE_KEY_STARS] || []);
    });
  });
}

function saveStars(stars) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY_STARS]: stars }, resolve).then(() => console.log("something worked!"));
  });
}

function journalKey(course, module, question, variant) {
  return [course, module, question, variant].filter(Boolean).join('||');
}

async function upsertEntry(entry) {
  const entries = await loadJournals();
  const idx = entries.findIndex(e => e.key === entry.key);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...entry };
  } else {
    entries.unshift(entry);
  }
  await saveJournals(entries);
  return entries;
}

async function getEntry(key) {
  const entries = await loadJournals();
  return entries.find(e => e.key === key) || null;
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

// ========================================================================
// SWITCH TAB
// ========================================================================
function switchTab(name, el) {
  // Hide all tabs
  document.querySelectorAll('.tab-body').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  
  // Show selected tab
  document.getElementById(`tab-${name}`).classList.add('active');
  el.classList.add('active');
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

  // Pre-select dropdowns if matching option exists
  autoSelect('selCourse',   ctx.course);
  autoSelect('selModule',   ctx.module);
  autoSelect('selQuestion', ctx.question);
  autoSelect('selVariant',  ctx.variant);
}

function autoSelect(selectId, value) {
  if (!value) return;
  const sel = document.getElementById(selectId);
  if (!sel) return;
  for (const opt of sel.options) {
    if (opt.value === value || opt.text === value) {
      sel.value = opt.value;
      return;
    }
  }
}

function getContextValues() {
  const course   = document.getElementById('selCourse').value   || _pageContext.course   || 'Unknown';
  const module   = document.getElementById('selModule').value   || _pageContext.module   || 'Unknown';
  const question = document.getElementById('selQuestion').value || _pageContext.question || 'Unknown';
  const variant  = document.getElementById('selVariant').value  || _pageContext.variant  || 'Unknown';
  return { course, module, question, variant };
}

// ========================================================================
// CLEAR FORM
// ========================================================================
function clearForm() {
  document.getElementById('inputReflection').value = '';
  document.getElementById('inputNote').value = '';
  clearScreenshot();
}

// ========================================================================
// CAPTURE SCREENSHOT
// ========================================================================
async function captureScreenshot() {
  try {
    if (!window.html2canvas) {
      showToast('❌ Screenshot library not loaded');
      return;
    }
    
    const canvas = await html2canvas(document.body);
    _screenshot = canvas.toDataURL('image/png');
    
    const preview = document.getElementById('screenshotPreview');
    if (preview) {
      preview.src = _screenshot;
      preview.style.display = 'block';
      preview.style.marginTop = '8px';
    }
    
    const clearBtn = document.getElementById('clearSsBtn');
    if (clearBtn) clearBtn.style.display = 'block';
    
    showToast('📷 Screenshot captured!');
  } catch (e) {
    console.error('Screenshot error:', e);
    showToast('❌ Screenshot failed: ' + e.message);
  }
}

// ========================================================================
// CLEAR SCREENSHOT
// ========================================================================
function clearScreenshot() {
  document.getElementById('screenshotPreview').classList.remove('visible');
  document.getElementById('clearSsBtn').style.display = 'none';
  _screenshot = null;
}

// ════════════════════════════════════════════════════════════════════════════
// SAVE ENTRY
// ════════════════════════════════════════════════════════════════════════════

async function saveEntry() {
  const course = document.getElementById('selCourse').value || 'Unknown';
  const module = document.getElementById('selModule').value || 'Unknown';
  const question = document.getElementById('selQuestion').value || 'Unknown';
  const variant = document.getElementById('selVariant').value || 'Unknown';
  const reflection = document.getElementById('inputReflection').value;
  const note = document.getElementById('inputNote').value;
  
  if (!reflection.trim()) {
    showToast('⚠️ Write something first!');
    return;
  }
  
  const entry = {
    course,
    module,
    question,
    variant,
    reflection,
    note,
    screenshot: _screenshot,
    timestamp: new Date().toISOString(),
    starred: false
  };
  
  const key = `${course}|${module}|${question}|${variant}`;
  const entries = await chrome.storage.local.get('entries').then(result => result.entries || {});
  entries[key] = entry;
  
  await chrome.storage.local.set({ entries });
  
  showToast('💾 Entry saved!');
  clearForm();
  loadJournals();
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER RECENT LIST
// ════════════════════════════════════════════════════════════════════════════

async function renderRecent() {
  const entries = await loadJournals();
  const container = document.getElementById('recentList');
  const countEl   = document.getElementById('recentCount');
  countEl.textContent = entries.length;

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📓</div>
        <div class="empty-msg">No journal entries yet.<br>Write your first reflection above.</div>
      </div>`;
    return;
  }

  container.innerHTML = ''; // ← Clear first
  entries.forEach(e => {
    const card = buildEntryCard(e, e.key); // ← Pass key
    container.appendChild(card);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER STARRED LIST
// ════════════════════════════════════════════════════════════════════════════

async function renderStarred() {
  const entries = (await loadJournals()).filter(e => e.starred);
  const container = document.getElementById('starredList');
  const countEl   = document.getElementById('starredCount');
  countEl.textContent = entries.length;

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⭐</div>
        <div class="empty-msg">No starred entries yet.<br>Open an entry and star it to review later.</div>
      </div>`;
    return;
  }

  container.innerHTML = entries.map(e => buildEntryCard(e, true)).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRY CARD HTML
// ════════════════════════════════════════════════════════════════════════════

// function buildEntryCard(e, showStar = false) {
//   const preview = (e.reflection || '').substring(0, 90) + ((e.reflection || '').length > 90 ? '…' : '');
//   const escapedKey = esc(e.key);
//   const wrongBadge = e.wrongAttempts > 1
//     ? `<span class="entry-tag" style="background:var(--red-lt);border-color:rgba(192,57,43,0.2);color:var(--red)">✗ ${e.wrongAttempts}</span>`
//     : '';
//   const starBadge = e.starred ? `<span class="entry-tag" style="background:var(--gold-lt);color:var(--gold);border-color:rgba(200,155,60,0.25)">⭐</span>` : '';
//   const ssThumb = e.screenshot
//     ? `<img src="${e.screenshot}" style="width:100%;border-radius:4px;border:1px solid var(--border);margin-top:6px;display:block">`
//     : '';

//   return `
//     <div class="entry-card" onclick="openDetail('${escapedKey}')">
//       <div class="entry-path">${esc(e.course)} › ${esc(e.module)} › ${esc(e.question)} › ${esc(e.variant)}</div>
//       <div class="entry-preview">${esc(preview)}</div>
//       ${ssThumb}
//       <div class="entry-footer">
//         <div class="entry-date">${esc(e.timestamp)}</div>
//         <div class="entry-tags">${wrongBadge}${starBadge}${e.quickNote ? `<span class="entry-tag">💡 note</span>` : ''}</div>
//       </div>
//     </div>`;
// }

function buildEntryCard(entry, key) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-path">${esc(entry.course)} | ${esc(entry.module)} | ${esc(entry.question)}</div>
    <div class="entry-preview">${esc(entry.reflection.substring(0, 80))}...</div>
    <div class="entry-footer">
      <div class="entry-date">${new Date(entry.timestamp).toLocaleDateString()}</div>
      <button class="entry-tag" onclick="toggleStarEntry('${esc(key)}'); event.stopPropagation();">⭐</button>
    </div>
  `;
  // ← ADD THIS onclick handler
  card.onclick = () => openDetail(key);
  return card;
}

// ════════════════════════════════════════════════════════════════════════════
// DETAIL VIEW
// ════════════════════════════════════════════════════════════════════════════

async function openDetail(key) {
  const result = await chrome.storage.local.get('entries');
  const entries = result.entries || {};
  const entry = entries[key];
  
  document.getElementById('mainView').style.display = 'none';
  document.getElementById('detailView').classList.add('active');
  
  document.getElementById('detailTitle').textContent = `${entry.course} | ${entry.module}`;
  document.getElementById('detailDate').textContent = new Date(entry.timestamp).toLocaleDateString();
  
  const body = document.getElementById('detailBody');
  body.innerHTML = `
    <div class="detail-path">
      <span class="detail-chip">${esc(entry.course)}</span>
      <span class="detail-sep">|</span>
      <span class="detail-chip">${esc(entry.module)}</span>
      <span class="detail-sep">|</span>
      <span class="detail-chip">${esc(entry.question)}</span>
    </div>
    
    <div class="detail-section-label">Reflection</div>
    <div class="detail-text-block">${esc(entry.reflection)}</div>
    
    ${entry.note ? `
      <div class="detail-section-label">Key Takeaway</div>
      <div class="detail-note-block">${esc(entry.note)}</div>
    ` : ''}
    
    ${entry.screenshot ? `<img src="${entry.screenshot}" class="detail-screenshot">` : ''}
    
    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button class="edit-btn" onclick="editEntry('${esc(key)}')">✏️ Edit</button>
      <button class="edit-btn" style="background: var(--red-lt); color: var(--red);" onclick="deleteEntry('${esc(key)}')">🗑️ Delete</button>
    </div>
  `;
}

function closeDetail() {
  document.getElementById('detailView').style.display = 'none';
  document.getElementById('detailView').classList.remove('active');
  document.getElementById('mainView').style.display = '';
  _detailEntryKey = null;
}

// ════════════════════════════════════════════════════════════════════════════
// STAR / DELETE / EDIT
// ════════════════════════════════════════════════════════════════════════════

async function toggleStarEntry(key) {
  const entries = await loadJournals();
  const e = entries.find(e => e.key === key);
  if (!e) return;
  e.starred = !e.starred;
  await saveJournals(entries);
  showToast(e.starred ? '⭐ Starred!' : 'Unstarred');
  openDetail(key); // refresh detail
}

async function deleteEntry(key) {
  if (!confirm('Delete this journal entry? This cannot be undone.')) return;
  const entries = (await loadJournals()).filter(e => e.key !== key);
  await saveJournals(entries);
  closeDetail();
  showToast('Entry deleted');
  renderRecent();
}

async function editEntry(key) {
  const entry = await getEntry(key);
  if (!entry) return;

  // Pre-fill write form and switch to write tab
  closeDetail();
  document.getElementById('inputReflection').value = entry.reflection || '';
  document.getElementById('inputNote').value        = entry.quickNote  || '';

  autoSelect('selCourse',   entry.course);
  autoSelect('selModule',   entry.module);
  autoSelect('selQuestion', entry.question);
  autoSelect('selVariant',  entry.variant);

  if (entry.screenshot) {
    _screenshot = entry.screenshot;
    const img = document.getElementById('screenshotPreview');
    img.src = _screenshot;
    img.classList.add('visible');
    document.getElementById('clearSsBtn').style.display = '';
  }

  // Switch to write tab
  const writeTab = document.querySelector('[data-tab="write"]');
  switchTab('write', writeTab);
  showToast('Editing entry — save to update');
}

// ════════════════════════════════════════════════════════════════════════════
// ESCAPE HELPER
// ════════════════════════════════════════════════════════════════════════════

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
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

  // Pre-render recent count on load
  const entries = await loadJournals();
  document.getElementById('recentCount').textContent = entries.length;

  const starred = entries.filter(e => e.starred);
  document.getElementById('starredCount').textContent = starred.length;

  await renderRecent();    // ← Load and display recent entries
  await renderStarred();   // ← Load and display starred entries

  // Also wire up tab switching to re-render:
  document.addEventListener('click', async (e) => {
    if (e.target.matches('[data-tab="recent"]')) {
      await renderRecent();
    }
    if (e.target.matches('[data-tab="starred"]')) {
      await renderStarred();
    }
  });

  // Create the Ask AI button and result area
  const reflectionBox = document.getElementById('inputReflection');
  const writeSection = reflectionBox.closest('.write-section');

  // Create button
  const aiBtn = document.createElement('button');
  aiBtn.textContent = '🤖 Ask AI for a leading question';
  aiBtn.className = 'btn btn-secondary';
  aiBtn.style.marginTop = '8px';

  // Create result area
  const aiResult = document.createElement('div');
  aiResult.id = 'aiResult';
  aiResult.style.marginTop = '8px';
  aiResult.style.padding = '10px';
  aiResult.style.backgroundColor = '#f0f8f4';
  aiResult.style.borderRadius = '4px';
  aiResult.style.border = '1px solid #4a7c59';
  aiResult.style.fontStyle = 'italic';
  aiResult.style.color = '#2d5a3d';
  aiResult.style.minHeight = '30px';
  aiResult.style.whiteSpace = 'pre-wrap';
  aiResult.style.wordWrap = 'break-word';

  console.log('🔘 aiBtn:', aiBtn);
  console.log('📝 aiResult:', aiResult);

  // Insert after reflection textarea
  reflectionBox.parentNode.appendChild(aiBtn);
  reflectionBox.parentNode.appendChild(aiResult);

  aiBtn.addEventListener('click', async () => {
    aiResult.textContent = '🤖 Thinking...';
    aiBtn.disabled = true; // Disable button while processing

    try {
      // Fetch scraped data from content script
      const questionData = await fetchQuestionDataFromContentScript();
      
      // Add user's reflection from the textarea
      questionData.myReasoning = reflectionBox.value;

      console.log('Question data for AI:', questionData);

      // Call the LLM function
      const explanation = await getSocraticExplanation(questionData);
      aiResult.textContent = explanation;
    } catch (e) {
      console.error('Error calling AI:', e);
      aiResult.textContent = '❌ Error contacting AI. Check console for details.';
    } finally {
      aiBtn.disabled = false; // Re-enable button
    }
  });
});

// Fetch function for content script communication
async function fetchQuestionDataFromContentScript() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        console.error('No active tab found');
        resolve({ 
          course: '', 
          questionTitle: '', 
          questionText: '', 
          myAnswer: '', 
          correctAnswer: '',
          myReasoning: ''
        });
        return;
      }
      
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: 'EXTRACT_QUESTION' },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Message error:', chrome.runtime.lastError);
            resolve({ 
              course: '', 
              questionTitle: '', 
              questionText: '', 
              myAnswer: '', 
              correctAnswer: '',
              myReasoning: ''
            });
          } else {
            console.log('Question data received:', response);
            resolve(response || {});
          }
        }
      );
    });
  });
}
