'use strict';
import { CONFIG } from './config.js';

const STORAGE_KEY = 'pl_journals';
const COURSE_META_KEY = 'pl_course_meta';
const TERM_OPTIONS = ['Winter T1', 'Winter T2', 'Summer T1', 'Summer T2'];
let _allEntries = [];
let _grouped    = {};
let _courseMeta = {};

// Flashcard state
let _fcCards   = [];
let _fcIndex   = 0;
let _fcCourse  = '';
let _fcFlipped = false;

// ─── UTILITIES ───
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── MARKDOWN RENDERER ───
function markdownToHtml(text) {
  if (!text) return '';
  const segments = text.split(/(```[\s\S]*?```)/g);
  return segments.map((seg, i) => {
    if (i % 2 === 1) {
      const code = seg.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
      return `<pre><code>${escHtml(code)}</code></pre>`;
    }
    return renderMdLines(seg);
  }).join('');
}

function renderMdLines(text) {
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
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    const ol = line.match(/^(\d+)\.\s+(.*)/);
    const ul = line.match(/^[-*]\s+(.*)/);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ol[2])}</li>`);
    } else if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
    } else if (line === '') {
      flush(); out.push('<br>');
    } else {
      flush(); out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join('');
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
// Course metadata (active/past, term, year) is loaded once at startup via
// loadCourseMetaThenRender(). After that the dashboard is the sole writer of
// it, so routine reloads (sync button, window focus, storage sync from the
// side panel) only refetch journal entries — re-fetching course meta here
// would race against in-flight setCourseMeta() writes and could clobber a
// just-made term/year/status edit with stale data before it saves.
function loadAndRender() {
  chrome.storage.local.get([STORAGE_KEY], result => {
    _allEntries = (result[STORAGE_KEY] || []).slice();
    _grouped    = groupEntries(_allEntries);

    renderCoursesPanel(_grouped);
    renderStarredPanel(_allEntries);
    renderJournalPanel(_allEntries);
  });
}

function loadCourseMetaThenRender() {
  chrome.storage.local.get([COURSE_META_KEY], result => {
    _courseMeta = result[COURSE_META_KEY] || {};
    loadAndRender();
  });
}

// ─── COURSE META (active/past status + term/year) ───
function getCourseMeta(course) {
  const meta = _courseMeta[course] || {};
  return { status: meta.status || 'active', term: meta.term || '', year: meta.year || '' };
}

function setCourseMeta(course, patch) {
  _courseMeta[course] = { ...getCourseMeta(course), ...patch };
  chrome.storage.local.set({ [COURSE_META_KEY]: _courseMeta });
}

// ─── COURSES PANEL ───
function renderCoursesPanel(grouped) {
  const activeContainer = document.getElementById('courses-list-active');
  const pastContainer   = document.getElementById('courses-list-past');
  if (!activeContainer || !pastContainer) return;

  if (Object.keys(grouped).length === 0) {
    activeContainer.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">No entries yet</div>
      <div class="empty-sub">Open the extension on a PrairieLearn question and record your wrong answers.</div>
    </div>`;
    pastContainer.innerHTML = `<div class="empty-state-mini">No past courses yet.</div>`;
    return;
  }

  const activeCourses = [];
  const pastCourses = [];
  for (const [course, modules] of Object.entries(grouped)) {
    const meta = getCourseMeta(course);
    (meta.status === 'past' ? pastCourses : activeCourses).push([course, modules]);
  }

  activeContainer.innerHTML = activeCourses.length
    ? activeCourses.map(([course, modules]) => buildCourseCard(course, modules)).join('')
    : `<div class="empty-state-mini">No active courses — mark a course active below, or add a new entry.</div>`;

  pastContainer.innerHTML = pastCourses.length
    ? pastCourses.map(([course, modules]) => buildCourseCard(course, modules)).join('')
    : `<div class="empty-state-mini">No past courses yet.</div>`;
}

function buildCourseCard(course, modules) {
  const totalWrong = Object.values(modules).flatMap(qs => Object.values(qs)).flat().length;
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
        <span class="module-name">${escHtml(mod)}</span>
        <div class="module-stats"><span class="mod-stat-wrong">✗ ${modWrong}</span></div>
      </div>
      <div class="module-children">${questionsHtml}</div>`;
  }

  // Count questions that are serious struggles (3+ attempts)
  const struggleCount = Object.values(modules)
    .flatMap(qs => Object.values(qs))
    .filter(entries => entries.length >= 3).length;

  const meta = getCourseMeta(course);
  const termOptions = ['', ...TERM_OPTIONS].map(t =>
    `<option value="${escHtml(t)}" ${meta.term === t ? 'selected' : ''}>${t || 'Term'}</option>`
  ).join('');
  const isPast = meta.status === 'past';

  return `
  <div class="course-overview-card">
    <div class="coc-header" data-action="toggleCourse">
      <div class="coc-arrow">▶</div>
      <div class="coc-info">
        <div class="coc-name">${escHtml(course)}</div>
        <div class="coc-meta">
          <span class="coc-wrong">${totalWrong} entries</span>
          ${struggleCount > 0 ? `<span class="coc-struggle">${struggleCount} struggle topic${struggleCount !== 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      <div class="coc-term-controls">
        <select class="coc-term-select" data-action="setTerm" data-course="${escHtml(course)}">${termOptions}</select>
        <input type="number" class="coc-year-input" data-action="setYear" data-course="${escHtml(course)}" placeholder="Year" value="${escHtml(meta.year)}" min="2000" max="2100">
        <button class="coc-status-btn ${isPast ? '' : 'past-btn'}" data-action="setStatus" data-course="${escHtml(course)}" data-status="${isPast ? 'active' : 'past'}">
          ${isPast ? 'Mark Active' : 'Mark Past'}
        </button>
      </div>
      <button class="fc-gen-btn" data-action="generateFlashcards" data-course="${escHtml(course)}" title="Quiz me on your struggle topics">
        ⚡ Quiz me
      </button>
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
    const isStarred = entry.starred ? 'starred' : '';
    variantRowsHtml += `
      <div class="variant-row" data-action="openEntry" data-idx="${idx}">
        <div class="v-name">${escHtml(variant)}</div>
        <button class="v-star ${isStarred}" data-action="starEntry" data-idx="${idx}" title="Star this variant">★</button>
        <div class="v-date">${escHtml(date)}</div>
        <button class="v-delete-btn" data-action="deleteEntry" data-idx="${idx}" title="Delete this entry">🗑</button>
      </div>`;
  }
  const count = entries.length;
  const pill = count >= 5
    ? `<span class="q-wrong-pill urgent">go to office hours</span>`
    : count >= 3
      ? `<span class="q-wrong-pill warn">review concepts?</span>`
      : '';
  return `
    <div class="q-main-row" data-action="toggleQ">
      <div class="q-arrow">▶</div>
      <span class="q-main-label">${escHtml(q)}</span>
      ${pill}
    </div>
    <div class="q-detail">
      <div class="q-detail-inner">
        <div class="q-detail-header">
          <div class="q-detail-title">${escHtml(q)}</div>
          <div class="q-detail-summary">
            <div class="qd-stat">Wrong attempts: <strong>${entries.length}</strong></div>
          </div>
        </div>
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

  document.getElementById('jpBody').innerHTML  = markdownToHtml(entry.reflection) || '';
  document.getElementById('jpNotes').innerHTML = markdownToHtml(entry.quickNote)  || '';
  document.getElementById('jpTags').innerHTML  = '';

  const linkWrap   = document.getElementById('jpVariantLink');
  const linkAnchor = document.getElementById('jpVariantAnchor');
  if (entry.url) {
    linkAnchor.href = entry.url;
    linkWrap.style.display = 'block';
  } else {
    linkWrap.style.display = 'none';
  }

  const aiSection = document.getElementById('jpAiSection');
  if (entry.aiFeedback) {
    aiSection.style.display = 'block';
    document.getElementById('jpAiFeedback').innerHTML = markdownToHtml(entry.aiFeedback);
  } else {
    aiSection.style.display = 'none';
  }

  const jpPanel = document.getElementById('journalPanel');
  jpPanel.style.display = 'block';
  document.querySelector('.main-content').style.marginRight = jpPanel.offsetWidth + 'px';
  setBreadcrumb([entry.course, entry.module, entry.question, entry.variant].filter(Boolean));
}

function closeJournal() {
  document.getElementById('journalPanel').style.display = 'none';
  document.querySelector('.main-content').style.marginRight = '0';
  document.querySelectorAll('.variant-row.active').forEach(r => r.classList.remove('active'));
}

// ─── STAR ───
function toggleStar(idx, btnEl) {
  const entry = _allEntries[idx];
  if (!entry) return;
  entry.starred = !entry.starred;

  if (btnEl) btnEl.classList.toggle('starred', entry.starred);

  chrome.storage.local.set({ [STORAGE_KEY]: _allEntries });
}

// ─── DELETE ───
function deleteEntry(idx) {
  const entry = _allEntries[idx];
  if (!entry) return;
  const label = entry.variant || entry.question || 'this entry';
  if (!confirm(`Delete the journal entry for ${label}? This cannot be undone.`)) return;

  _allEntries.splice(idx, 1);
  chrome.storage.local.set({ [STORAGE_KEY]: _allEntries });
  closeJournal();
}

// ─── TOGGLE HELPERS ───
function toggleCourse(header) {
  const body  = header.nextElementSibling;
  const arrow = header.querySelector('.coc-arrow');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

function togglePQ(row) {
  row.nextElementSibling.classList.toggle('open');
  row.querySelector('.tree-arrow').classList.toggle('open');
  row.classList.toggle('active');
}

function toggleQ(row) {
  const arrow  = row.querySelector('.q-arrow');
  const detail = row.nextElementSibling;
  if (!detail || !detail.classList.contains('q-detail')) return;
  arrow.classList.toggle('open');
  detail.classList.toggle('open');
  row.classList.toggle('expanded');
}

// ─── BREADCRUMB ───
function setBreadcrumb(parts) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  bc.innerHTML = parts.map((p, i) => {
    const cls = i === parts.length - 1 ? 'bc-item active' : 'bc-item';
    return `<span class="${cls}">${escHtml(p)}</span>`;
  }).join('<span class="bc-sep"> › </span>');
}

// ═══════════════════════════════════════════════════════
// ─── FLASHCARD GENERATION ───
// ═══════════════════════════════════════════════════════

async function generateFlashcardsForCourse(course) {
  const modules = _grouped[course];
  if (!modules) return;

  // Collect struggle topics with context
  const topics = [];
  for (const [mod, questions] of Object.entries(modules)) {
    for (const [q, entries] of Object.entries(questions)) {
      const count = entries.length;
      // Grab up to 2 short reflections/notes as context
      const notes = entries
        .map(e => (e.quickNote || e.reflection || '').substring(0, 120).trim())
        .filter(Boolean)
        .slice(0, 2);
      topics.push({ module: mod, question: q, attempts: count, notes });
    }
  }

  // Sort by most attempts first (hardest struggles at the top)
  topics.sort((a, b) => b.attempts - a.attempts);

  const topicsStr = topics.map(t => {
    const noteStr = t.notes.length ? `\n   Student note: "${t.notes[0]}"` : '';
    return `- [${t.module}] "${t.question}" — ${t.attempts} wrong attempt${t.attempts !== 1 ? 's' : ''}${noteStr}`;
  }).join('\n');

  const prompt = `You are creating study flashcards for a university student in the course "${course}".

TOPICS THE STUDENT IS STRUGGLING WITH (sorted by most attempts):
${topicsStr}

Generate 8–12 concise flashcards covering the core concepts behind these struggle topics.

FLASHCARD RULES:
- Focus on underlying concepts, not just the specific questions listed
- Progress from foundational to more complex
- Use proper LaTeX notation for all math (e.g. $T(n) = 2T(n/2) + n$, $O(\\log n)$, $\\Theta(n^2)$)
- Include short backtick code examples where helpful
- If you naturally reference an external resource in an answer (e.g. "See CLRS Ch. 6" or "Refer to MIT 6.006 Lecture 4"), that is fine — but do not force resource mentions
- Keep fronts as clear, answerable questions; backs as complete but concise answers

Return ONLY a JSON array with this exact format — no other text before or after:
[
  { "front": "Question text", "back": "Answer text" }
]`;

  // Show loading state
  openFlashcardModal(course, null, true);

  try {
    const response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Unexpected response format from AI');
    const cards = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(cards) || cards.length === 0) throw new Error('No quiz questions were generated');

    openFlashcardModal(course, cards, false);
  } catch (err) {
    setFlashcardError('Generation failed: ' + err.message);
  }
}

// ─── FLASHCARD MODAL ───

function openFlashcardModal(course, cards, loading) {
  _fcCourse  = course;
  _fcCards   = cards || [];
  _fcIndex   = 0;
  _fcFlipped = false;

  document.getElementById('fcCourseName').textContent = course;
  document.getElementById('flashcardModal').style.display = 'flex';

  const loadEl = document.getElementById('fcLoading');
  const viewEl = document.getElementById('fcViewer');
  const errEl  = document.getElementById('fcError');

  if (loading) {
    loadEl.style.display = 'block';
    viewEl.style.display = 'none';
    errEl.style.display  = 'none';
    document.getElementById('fcSub').textContent = 'Generating your quiz with AI...';
    return;
  }

  loadEl.style.display = 'none';
  errEl.style.display  = 'none';
  viewEl.style.display = 'block';
  document.getElementById('fcSub').textContent = `${cards.length} card${cards.length !== 1 ? 's' : ''} generated`;

  renderFlashcard();
}

function setFlashcardError(msg) {
  document.getElementById('fcLoading').style.display = 'none';
  document.getElementById('fcViewer').style.display  = 'none';
  const errEl = document.getElementById('fcError');
  errEl.style.display   = 'block';
  errEl.textContent     = msg;
  document.getElementById('fcSub').textContent = 'Error';
}

function closeFlashcardModal() {
  document.getElementById('flashcardModal').style.display = 'none';
}

function renderFlashcard() {
  const card = _fcCards[_fcIndex];
  if (!card) return;

  _fcFlipped = false;
  const cardEl = document.getElementById('fcCard');
  cardEl.classList.remove('flipped');

  document.getElementById('fcFront').innerHTML = markdownToHtml(card.front);
  document.getElementById('fcBack').innerHTML  = markdownToHtml(card.back);
  document.getElementById('fcCounter').textContent = `${_fcIndex + 1} / ${_fcCards.length}`;
  document.getElementById('fcHint').textContent = 'Click card to reveal answer';

  document.getElementById('fcPrev').disabled = (_fcIndex === 0);
  document.getElementById('fcNext').disabled = (_fcIndex === _fcCards.length - 1);

  // Re-typeset MathJax after DOM update — use setTimeout to ensure innerHTML has settled
  if (window.MathJax?.typesetPromise) {
    // Clear previous typesetting on these nodes first so MathJax re-processes them
    window.MathJax.typesetClear([document.getElementById('fcFront'), document.getElementById('fcBack')]);
    setTimeout(() => {
      window.MathJax.typesetPromise([document.getElementById('fcFront'), document.getElementById('fcBack')]);
    }, 0);
  }
}

function flipCard() {
  _fcFlipped = !_fcFlipped;
  document.getElementById('fcCard').classList.toggle('flipped', _fcFlipped);
  document.getElementById('fcHint').textContent = _fcFlipped ? 'Click to see question' : 'Click card to reveal answer';
}

function exportToAnki() {
  if (!_fcCards.length) return;
  const tag   = _fcCourse.replace(/[\s/\\]/g, '_');
  const lines = ['#separator:tab', '#html:true', '#tags column:3'];
  for (const c of _fcCards) {
    const front = c.front.replace(/\t/g, ' ').replace(/\n/g, '<br>');
    const back  = c.back.replace(/\t/g, ' ').replace(/\n/g, '<br>');
    lines.push(`${front}\t${back}\t${tag}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${tag}_flashcards.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── BACKUP: EXPORT / IMPORT ───
function exportBackup() {
  const payload = {
    format: 'prairie-journal-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: _allEntries
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `prairie_journal_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    alert('Import failed: not valid JSON');
    return;
  }

  const incoming = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(incoming)) {
    alert('Import failed: unrecognized backup file');
    return;
  }

  const existingKeys = new Set(_allEntries.map(e => e.key));
  const merged = _allEntries.concat(incoming.filter(e => !existingKeys.has(e.key)));
  const added  = merged.length - _allEntries.length;

  chrome.storage.local.set({ [STORAGE_KEY]: merged }, () => {
    loadAndRender();
    alert(`Imported ${added} new entr${added !== 1 ? 'ies' : 'y'}`);
  });
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
  loadCourseMetaThenRender();

  // Re-render when sidepanel saves a new entry
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      loadAndRender();
    }
  });

  // Reload when this tab regains focus
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

  // ── EXPORT / IMPORT BACKUP ──
  document.getElementById('exportBtn').addEventListener('click', exportBackup);

  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (file) importBackup(file);
    importFile.value = '';
  });

  // ── CLOSE JOURNAL ──
  document.getElementById('jpClose').addEventListener('click', closeJournal);

  // Close journal when clicking outside the panel
  document.addEventListener('click', e => {
    const panel = document.getElementById('journalPanel');
    if (panel.style.display === 'none') return;
    if (!panel.contains(e.target)) closeJournal();
  });

  // ── DRAG HANDLE — resize the journal panel ──
  const jpPanel  = document.getElementById('journalPanel');
  const jpHandle = document.getElementById('jpDragHandle');

  jpHandle.addEventListener('mouseover', () => { jpHandle.style.background = 'rgba(74,124,89,0.25)'; });
  jpHandle.addEventListener('mouseout',  () => { jpHandle.style.background = 'transparent'; });

  jpHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX      = e.clientX;
    const startWidth  = jpPanel.offsetWidth;
    const mainContent = document.querySelector('.main-content');
    mainContent.style.transition = 'none';

    function onMove(e) {
      const newWidth = Math.max(320, Math.min(window.innerWidth * 0.8, startWidth + (startX - e.clientX)));
      jpPanel.style.width = newWidth + 'px';
      mainContent.style.marginRight = newWidth + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      jpHandle.style.background = 'transparent';
      mainContent.style.transition = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── FLASHCARD MODAL CONTROLS ──
  document.getElementById('fcClose').addEventListener('click', closeFlashcardModal);

  document.getElementById('fcCard').addEventListener('click', flipCard);

  document.getElementById('fcPrev').addEventListener('click', () => {
    if (_fcIndex > 0) { _fcIndex--; renderFlashcard(); }
  });
  document.getElementById('fcNext').addEventListener('click', () => {
    if (_fcIndex < _fcCards.length - 1) { _fcIndex++; renderFlashcard(); }
  });
  document.getElementById('fcExport').addEventListener('click', exportToAnki);

  // Close flashcard modal on overlay click
  document.getElementById('flashcardModal').addEventListener('click', e => {
    if (e.target === document.getElementById('flashcardModal')) closeFlashcardModal();
  });

  // Keyboard navigation for flashcards
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('flashcardModal');
    if (modal.style.display === 'none') return;
    if (e.key === 'ArrowRight' && _fcIndex < _fcCards.length - 1) { _fcIndex++; renderFlashcard(); }
    if (e.key === 'ArrowLeft'  && _fcIndex > 0)                    { _fcIndex--; renderFlashcard(); }
    if (e.key === ' ' || e.key === 'Enter')                        { e.preventDefault(); flipCard(); }
    if (e.key === 'Escape')                                        { closeFlashcardModal(); }
  });

  // ── EVENT DELEGATION for dynamically rendered content ──
  document.getElementById('contentArea').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'toggleCourse')       toggleCourse(el);
    else if (action === 'togglePQ')      togglePQ(el);
    else if (action === 'toggleQ')       toggleQ(el);
    else if (action === 'starEntry') {
      e.stopPropagation();
      toggleStar(parseInt(el.dataset.idx, 10), el);
    }
    else if (action === 'deleteEntry') {
      e.stopPropagation();
      deleteEntry(parseInt(el.dataset.idx, 10));
    }
    else if (action === 'openEntry') {
      e.stopPropagation();
      openJournalEntry(el, parseInt(el.dataset.idx, 10));
    }
    else if (action === 'generateFlashcards') {
      e.stopPropagation();
      generateFlashcardsForCourse(el.dataset.course);
    }
    else if (action === 'setStatus') {
      e.stopPropagation();
      setCourseMeta(el.dataset.course, { status: el.dataset.status });
      renderCoursesPanel(_grouped);
    }
  });

  // ── COURSE TERM / YEAR SELECTORS ──
  document.getElementById('contentArea').addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'setTerm') {
      setCourseMeta(el.dataset.course, { term: el.value });
    } else if (el.dataset.action === 'setYear') {
      setCourseMeta(el.dataset.course, { year: el.value });
    }
  });
});
