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
const STORAGE_KEY_STARS    = 'pl_stars';
const STORAGE_KEY_CONTEXT  = 'pl_last_context';

let _pageContext   = {};   // injected by content script via background
let _screenshot    = null; // current base64 PNG
let _detailEntryKey = null; // key of entry shown in detail view

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

function loadStars() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY_STARS], result => {
      resolve(result[STORAGE_KEY_STARS] || []);
    });
  });
}

function saveStars(stars) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY_STARS]: stars }, resolve);
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

// ════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════════════════════

function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-body').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');

  if (name === 'recent')  renderRecent();
  if (name === 'starred') renderStarred();
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
    wrongAttempts: 1,
    starred: false,
  };

  // If entry already exists, increment wrongAttempts
  const existing = await getEntry(key);
  if (existing) {
    entry.wrongAttempts = (existing.wrongAttempts || 0) + 1;
    entry.starred = existing.starred || false;
  }

  await upsertEntry(entry);

  // Notify background so content script can show in-page confirmation
  chrome.runtime.sendMessage({ type: 'ENTRY_SAVED', payload: entry }).catch(() => {});

  showToast('✓ Journal entry saved!');
  clearForm();
  renderRecent(); // refresh recent list if visible
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

  container.innerHTML = entries.map(e => buildEntryCard(e)).join('');
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

function buildEntryCard(e, showStar = false) {
  const preview = (e.reflection || '').substring(0, 90) + ((e.reflection || '').length > 90 ? '…' : '');
  const escapedKey = esc(e.key);
  const wrongBadge = e.wrongAttempts > 1
    ? `<span class="entry-tag" style="background:var(--red-lt);border-color:rgba(192,57,43,0.2);color:var(--red)">✗ ${e.wrongAttempts}</span>`
    : '';
  const starBadge = e.starred ? `<span class="entry-tag" style="background:var(--gold-lt);color:var(--gold);border-color:rgba(200,155,60,0.25)">⭐</span>` : '';
  const ssThumb = e.screenshot
    ? `<img src="${e.screenshot}" style="width:100%;border-radius:4px;border:1px solid var(--border);margin-top:6px;display:block">`
    : '';

  return `
    <div class="entry-card" onclick="openDetail('${escapedKey}')">
      <div class="entry-path">${esc(e.course)} › ${esc(e.module)} › ${esc(e.question)} › ${esc(e.variant)}</div>
      <div class="entry-preview">${esc(preview)}</div>
      ${ssThumb}
      <div class="entry-footer">
        <div class="entry-date">${esc(e.timestamp)}</div>
        <div class="entry-tags">${wrongBadge}${starBadge}${e.quickNote ? `<span class="entry-tag">💡 note</span>` : ''}</div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// DETAIL VIEW
// ════════════════════════════════════════════════════════════════════════════

async function openDetail(key) {
  const entry = await getEntry(key);
  if (!entry) { showToast('Entry not found'); return; }

  _detailEntryKey = key;

  document.getElementById('mainView').style.display   = 'none';
  document.getElementById('detailView').style.display = 'flex';
  document.getElementById('detailView').classList.add('active');

  document.getElementById('detailTitle').textContent = `${entry.question} · ${entry.variant}`;
  document.getElementById('detailDate').textContent  = entry.timestamp;

  const pathHtml = [entry.course, entry.module, entry.question, entry.variant]
    .map(p => `<span class="detail-chip">${esc(p)}</span>`)
    .join('<span class="detail-sep">›</span>');

  const ssHtml = entry.screenshot
    ? `<img class="detail-screenshot" src="${entry.screenshot}" alt="Screenshot">`
    : '';

  const noteHtml = entry.quickNote
    ? `<div class="detail-section-label" style="margin-top:12px">⚡ Quick Note</div>
       <div class="detail-note-block">${esc(entry.quickNote)}</div>`
    : '';

  const wrongHtml = entry.wrongAttempts > 1
    ? `<div style="font-size:10px;color:var(--red);font-family:var(--mono);margin-bottom:10px">
         ✗ Wrong <strong>${entry.wrongAttempts}</strong> times
       </div>`
    : '';

  document.getElementById('detailBody').innerHTML = `
    <div class="detail-path">${pathHtml}</div>
    ${wrongHtml}
    <div class="detail-section-label">📝 Reflection</div>
    <div class="detail-text-block">${esc(entry.reflection)}</div>
    ${noteHtml}
    ${ssHtml}
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="edit-btn" onclick="toggleStarEntry('${esc(key)}')">
        ${entry.starred ? '★ Unstar' : '☆ Star for Review'}
      </button>
      <button class="edit-btn" onclick="editEntry('${esc(key)}')" style="color:var(--accent)">
        ✏️ Edit Entry
      </button>
    </div>
    <button class="edit-btn" style="margin-top:6px;color:var(--red)" onclick="deleteEntry('${esc(key)}')">
      🗑 Delete Entry
    </button>
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
});
