'use strict';

const STORAGE_KEY = 'pl_journals';
let _allEntries = [];
let _grouped    = {};

// ─── UTILITIES ───
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch(e) { return ts; }
}

function groupEntries(entries) {
  const g = {};
  for (const entry of entries) {
    const c = entry.course   || 'Unknown';
    const m = entry.module   || 'Unknown';
    const q = entry.question || 'Unknown';
    if (!g[c])       g[c]     = {};
    if (!g[c][m])    g[c][m]  = {};
    if (!g[c][m][q]) g[c][m][q] = [];
    g[c][m][q].push(entry);
  }
  return g;
}

// ─── LOAD & RENDER ───
function loadAndRender() {
  chrome.storage.local.get([STORAGE_KEY], result => {
    _allEntries = (result[STORAGE_KEY] || []).slice();
    _grouped    = groupEntries(_allEntries);

    renderStats(_allEntries, _grouped);
    renderCoursesPanel(_grouped);
    renderStarredPanel(_allEntries);
    renderJournalPanel(_allEntries);

    const n = _allEntries.length;
    document.getElementById('syncStatus').textContent =
      n === 0 ? 'No entries yet' : `${n} entr${n !== 1 ? 'ies' : 'y'} loaded`;
  });
}

// ─── STATS ───
function renderStats(entries, grouped) {
  document.getElementById('stat-wrong').textContent   = entries.length;
  document.getElementById('stat-courses').textContent = Object.keys(grouped).length;
  document.getElementById('stat-starred').textContent = entries.filter(e => e.starred).length;
  document.getElementById('stat-journal').textContent = entries.length;
  const n = entries.length, c = Object.keys(grouped).length;
  document.getElementById('courses-panel-sub').textContent =
    `${c} course${c !== 1 ? 's' : ''} · ${n} journal entr${n !== 1 ? 'ies' : 'y'} tracked`;
}

// ─── COURSES PANEL ───
function renderCoursesPanel(grouped) {
  const container = document.getElementById('courses-list');
  if (!container) return;
  if (Object.keys(grouped).length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">No entries yet</div>
      <div class="empty-sub">Open the extension on a PrairieLearn question and record your wrong answers.</div>
    </div>`;
    return;
  }
  let html = '';
  for (const [course, modules] of Object.entries(grouped)) {
    const totalWrong = Object.values(modules).flatMap(qs => Object.values(qs)).flat().length;
    html += buildCourseCard(course, modules, totalWrong);
  }
  container.innerHTML = html;
}

function buildCourseCard(course, modules, totalWrong) {
  let modulesHtml = '';
  for (const [mod, questions] of Object.entries(modules)) {
    const modWrong = Object.values(questions).flat().length;
    let questionsHtml = '';
    for (const [q, entries] of Object.entries(questions)) {
      questionsHtml += buildQuestionBlock(q, entries);
    }
    modulesHtml += `
      <div class="module-row" data-action="togglePQ">
        <div class="tree-arrow">▶</div>
        <span class="module-icon">📄</span>
        <span class="module-name">${escHtml(mod)}</span>
        <div class="module-stats"><span class="mod-stat-wrong">✗ ${modWrong}</span></div>
      </div>
      <div class="module-children">${questionsHtml}</div>`;
  }
  return `
  <div class="course-overview-card">
    <div class="coc-header" data-action="toggleCourse">
      <div class="coc-arrow">▶</div>
      <span class="coc-folder-icon" style="font-size:20px">📁</span>
      <div class="coc-info">
        <div class="coc-name">${escHtml(course)}</div>
        <div class="coc-meta">
          <span class="coc-wrong">✗ ${totalWrong} wrong</span>
        </div>
      </div>
    </div>
    <div class="coc-body">
      <div class="module-table">${modulesHtml}</div>
    </div>
  </div>`;
}

function buildQuestionBlock(q, entries) {
  let variantRowsHtml = '';
  for (const entry of entries) {
    const idx     = _allEntries.indexOf(entry);
    const date    = formatDate(entry.timestamp);
    const variant = entry.variant || 'Unknown Variant';
    const chip    = variant.replace(/[^a-zA-Z0-9]/g,'').substring(0,4) || 'V?';
    variantRowsHtml += `
      <div class="variant-row" data-action="openEntry" data-idx="${idx}">
        <div class="v-chip">${escHtml(chip)}</div>
        <div class="v-name">${escHtml(variant)}</div>
        <div class="v-date">${escHtml(date)}</div>
        <div class="v-journal-btn">📝 View entry</div>
      </div>`;
  }
  return `
    <div class="q-main-row" data-action="toggleQ">
      <div class="q-arrow">▶</div>
      <span class="q-main-label">${escHtml(q)}</span>
      <span class="q-wrong-pill">✗ ${entries.length} wrong</span>
    </div>
    <div class="q-detail">
      <div class="q-detail-inner">
        <div class="q-detail-header">
          <div class="q-detail-title">📊 ${escHtml(q)}</div>
          <div class="q-detail-summary">
            <div class="qd-stat">Wrong attempts: <strong>${entries.length}</strong></div>
          </div>
        </div>
        <div class="variants-label">Wrong Variants</div>
        <div class="variant-rows">${variantRowsHtml}</div>
      </div>
    </div>`;
}

// ─── STARRED PANEL ───
function renderStarredPanel(entries) {
  const container = document.getElementById('starred-list');
  if (!container) return;
  const starred = entries.filter(e => e.starred);
  document.getElementById('starred-panel-sub').textContent =
    starred.length
      ? `${starred.length} question${starred.length !== 1 ? 's' : ''} marked for review`
      : 'No starred entries';
  if (starred.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">⭐</div>
      <div class="empty-title">No starred entries</div>
      <div class="empty-sub">Star questions from the Courses view to track them here.</div>
    </div>`;
    return;
  }
  let html = '';
  for (const entry of starred) {
    const idx  = _allEntries.indexOf(entry);
    const date = formatDate(entry.timestamp);
    html += `
      <div class="starred-card" data-action="openEntry" data-idx="${idx}">
        <div class="sc-icon">⭐</div>
        <div class="sc-info">
          <div class="sc-path">${escHtml(entry.course)} › ${escHtml(entry.module)} › ${escHtml(entry.question)}</div>
          <div class="sc-label">${escHtml(entry.question)}</div>
          <div class="sc-meta">Recorded: ${escHtml(date)}</div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

// ─── JOURNAL LIST PANEL ───
function renderJournalPanel(entries) {
  const container = document.getElementById('journal-list');
  if (!container) return;
  const n = entries.length;
  document.getElementById('journal-panel-sub').textContent =
    `${n} entr${n !== 1 ? 'ies' : 'y'} · sorted by most recent`;
  if (n === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📔</div>
      <div class="empty-title">No journal entries yet</div>
      <div class="empty-sub">Record your wrong answers using the extension.</div>
    </div>`;
    return;
  }
  let html = '';
  for (let i = 0; i < entries.length; i++) {
    const entry   = entries[i];
    const date    = formatDate(entry.timestamp);
    const text    = entry.reflection || '';
    const preview = text.substring(0, 120);
    html += `
      <div class="journal-entry-card" data-action="openEntry" data-idx="${i}">
        <div class="jec-path">${escHtml(entry.course)} › ${escHtml(entry.module)} › ${escHtml(entry.question)} › ${escHtml(entry.variant || '')}</div>
        <div class="jec-preview">${escHtml(preview)}${preview.length < text.length ? '...' : ''}</div>
        <div class="jec-footer">
          <div class="jec-date">${escHtml(date)}</div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

// ─── OPEN JOURNAL ENTRY ───
function openJournalEntry(triggerEl, idx) {
  const entry = _allEntries[idx];
  if (!entry) return;

  document.querySelectorAll('.variant-row.active').forEach(r => r.classList.remove('active'));
  if (triggerEl && triggerEl.classList.contains('variant-row')) {
    triggerEl.classList.add('active');
  }

  document.getElementById('jpTitle').textContent =
    (entry.variant || 'Entry') + ' — ' + (entry.question || '');
  document.getElementById('jpMeta').textContent = entry.timestamp || '';

  const pathEl = document.getElementById('jpPath');
  pathEl.innerHTML = [entry.course, entry.module, entry.question, entry.variant]
    .filter(Boolean)
    .map(p => `<span class="jp-path-chip">${escHtml(p)}</span>`)
    .join('<span class="jp-path-sep">›</span>');

  document.getElementById('jpBody').textContent  = entry.reflection || '';
  document.getElementById('jpNotes').textContent = entry.quickNote  || '';
  document.getElementById('jpTags').innerHTML    = '';

  const qdSection = document.getElementById('jpQuestionData');
  if (entry.questionData || entry.myAnswerText || entry.correctAnswer) {
    qdSection.style.display = 'block';
    document.getElementById('jpQuestionText').textContent  = entry.questionData  || '—';
    document.getElementById('jpMyAnswer').textContent      = entry.myAnswerText  || '—';
    document.getElementById('jpCorrectAnswer').textContent = entry.correctAnswer || '—';
  } else {
    qdSection.style.display = 'none';
  }

  const ssWrap = document.getElementById('jpScreenshotWrap');
  const ssEl   = document.getElementById('jpScreenshot');
  if (entry.screenshot) {
    ssEl.src = entry.screenshot;
    ssWrap.style.display = 'block';
  } else {
    ssWrap.style.display = 'none';
  }

  document.getElementById('journalPanel').style.display = 'block';
  document.querySelector('.main-content').style.marginRight = '380px';
  setBreadcrumb([entry.course, entry.module, entry.question, entry.variant].filter(Boolean));
}

function closeJournal() {
  document.getElementById('journalPanel').style.display = 'none';
  document.querySelector('.main-content').style.marginRight = '0';
  document.querySelectorAll('.variant-row.active').forEach(r => r.classList.remove('active'));
}

// ─── TOGGLE HELPERS ───
function toggleCourse(header) {
  const body   = header.nextElementSibling;
  const arrow  = header.querySelector('.coc-arrow');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
  const icon = header.querySelector('.coc-folder-icon');
  if (icon) icon.textContent = isOpen ? '📁' : '📂';
}

function togglePQ(row) {
  row.nextElementSibling.classList.toggle('open');
  row.querySelector('.tree-arrow').classList.toggle('open');
  row.classList.toggle('active');
}

function toggleQ(row) {
  const arrow  = row.querySelector('.q-arrow');
  const isOpen = arrow.classList.contains('open');
  const detail = row.nextElementSibling;
  if (!detail || !detail.classList.contains('q-detail')) return;
  arrow.classList.toggle('open');
  detail.classList.toggle('open');
  row.classList.toggle('expanded');
}

// ─── BREADCRUMB ───
function setBreadcrumb(parts) {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = parts.map((p, i) => {
    const cls = i === parts.length - 1 ? 'bc-item active' : 'bc-item';
    return `<span class="${cls}">${escHtml(p)}</span>`;
  }).join('<span class="bc-sep"> › </span>');
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();

  // Re-render when sidepanel saves a new entry
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      loadAndRender();
    }
  });

  // Reload when this tab regains focus (catches any missed storage events)
  window.addEventListener('focus', loadAndRender);

  // ── TAB SWITCHING ──
  document.querySelector('.titlebar-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.t-tab');
    if (!tab) return;
    document.querySelectorAll('.t-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.getElementById('panel-' + name).classList.add('visible');
    setBreadcrumb([name.charAt(0).toUpperCase() + name.slice(1)]);
  });

  // ── SYNC BUTTON ──
  document.getElementById('syncBtn').addEventListener('click', () => {
    document.getElementById('syncStatus').textContent = 'Syncing...';
    loadAndRender();
  });

  // ── CLOSE JOURNAL ──
  document.getElementById('jpClose').addEventListener('click', closeJournal);

  // ── EVENT DELEGATION for dynamically rendered content ──
  document.getElementById('contentArea').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'toggleCourse')     toggleCourse(el);
    else if (action === 'togglePQ')    togglePQ(el);
    else if (action === 'toggleQ')     toggleQ(el);
    else if (action === 'openEntry')   openJournalEntry(el, parseInt(el.dataset.idx, 10));
  });
});
