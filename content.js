// content.js — reads PrairieLearn DOM for metadata and question content

console.log("Prairie Journal: content script loaded");

// ============================================
// HELPERS: Read specific parts of the DOM
// ============================================

function getAssessmentName() {
  const link = document.querySelector('.nav-item.active .nav-link');
  return link ? link.innerText.trim() : "";
}

// PQ1, PQ2 = practice (213) ✓
// P9, P10  = practice (221) ✓
// PA1      = programming assignment (213) ✗
function isPracticeQuestion() {
  const name = getAssessmentName();
  return /^PQ\d/.test(name) || /^P\d/.test(name);
}

function getCourse() {
  const el = document.querySelector('.navbar-text');
  if (!el) return "";
  const match = el.innerText.match(/CPSC \d+|MATH \d+/i);
  return match ? match[0].toUpperCase() : "";
}

function getScore() {
  const badge = document.querySelector('[data-testid="submission-status"] .badge');
  if (!badge) return null;
  return parseInt(badge.innerText.trim());
}

function getQuestionTitle() {
  const block = document.querySelector('.question-block');
  const header = block ? block.querySelector('.card-header') : null;
  return header ? header.innerText.trim() : "Unknown Question";
}

function isWrongPracticeAnswer() {
  const gradingBlock = document.querySelector('.grading-block');
  if (!gradingBlock || gradingBlock.classList.contains('d-none')) return false;
  const score = getScore();
  if (score === null || score === 100) return false;
  return isPracticeQuestion();
}

// ============================================
// TEXT EXTRACTION with MathJax support
// ============================================

// Takes an element and returns readable text,
// replacing MathJax SVGs with their speech-text equivalent
function getReadableText(element) {
  if (!element) return "";

  // Clone so we don't modify the actual page
  const clone = element.cloneNode(true);

  // Replace MathJax containers with their speech text
  clone.querySelectorAll('mjx-container').forEach(mjx => {
    const speech = mjx.getAttribute('data-semantic-speech-none') ||
                   mjx.getAttribute('data-semantic-speech') || "";
    const textNode = document.createTextNode(speech);
    mjx.replaceWith(textNode);
  });

  return clone.innerText.trim();
}

// ============================================
// EXTRACT QUESTION DATA
// ============================================

function extractQuestionData() {
  // --- Question body (readable text with MathJax converted) ---
  const questionBody = document.querySelector('.question-body');
  const questionText = getReadableText(questionBody);

  // --- Answer options (radio buttons OR checkboxes) ---
  const options = [];
  if (questionBody) {
    questionBody.querySelectorAll('.form-check').forEach(formCheck => {
      const label = formCheck.querySelector('label');
      const input = formCheck.querySelector('input[type="radio"], input[type="checkbox"]');
      if (label && input) {
        options.push({
          value: input.value,
          text: getReadableText(label),
          checked: input.checked
        });
      }
    });
  }

  // --- Correct answer (from grading block after submission) ---
  const answerBody = document.querySelector('.grading-block .answer-body');
  const correctAnswer = getReadableText(answerBody);

  // --- Submitted (wrong) answer ---
  const submissionBody = document.querySelector('.submission-body');
  const myAnswerText = submissionBody ? submissionBody.innerText.trim() : "";
  // Extract letter: "(b)" -> "b"
  const letterMatch = myAnswerText.match(/\(([a-e])\)/);
  const myAnswer = letterMatch ? letterMatch[1] : myAnswerText;

  return {
    questionTitle: getQuestionTitle(),
    questionText,
    options,
    myAnswer,
    myAnswerText,
    correctAnswer,
    course: getCourse(),
    assessmentName: getAssessmentName(),
    score: getScore(),
    url: window.location.href
  };
}

// ============================================
// MESSAGE HANDLER — popup asks, content answers
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkPage") {
    sendResponse({
      isWrongAnswer: isWrongPracticeAnswer(),
      isPractice: isPracticeQuestion()
    });
  }

  if (request.action === "extractQuestion") {
    sendResponse(extractQuestionData());
  }

  return true;
});

// ============================================
// FLOATING BUTTON
// ============================================

function injectJournalButton() {
  if (document.getElementById('prairie-journal-btn')) return;
  if (!isWrongPracticeAnswer()) return;

  const btn = document.createElement('div');
  btn.id = 'prairie-journal-btn';
  btn.innerHTML = `
    <div style="
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #4a6cf7;
      color: white;
      padding: 12px 20px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(74, 108, 247, 0.4);
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 8px;
    ">
      <span style="font-size: 18px;">📝</span>
      <span>Journal This Mistake</span>
    </div>
  `;

  btn.addEventListener('click', () => {
    btn.querySelector('div').style.background = '#28a745';
    btn.querySelector('span:last-child').textContent = 'Now click the extension icon ↑';
    setTimeout(() => {
      btn.querySelector('div').style.background = '#4a6cf7';
      btn.querySelector('span:last-child').textContent = 'Journal This Mistake';
    }, 3000);
  });

  document.body.appendChild(btn);
}

setTimeout(() => injectJournalButton(), 1000);

const observer = new MutationObserver(() => {
  setTimeout(() => injectJournalButton(), 500);
});
observer.observe(document.body, { childList: true, subtree: true });

// ── content.js ─────────────────────────────────────────────────────────────

// it to the side panel via the background service worker.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function extractContext() {
    const url   = window.location.href;
    const title = document.title || '';

    // ── Course code  (e.g. "CPSC 213", "PHYS 158")
    let course = '';
    const courseMatch = url.match(/\/course\/([^/]+)/) ||
                        title.match(/([A-Z]{2,5}\s?\d{3}[A-Z]?)/);
    if (courseMatch) course = courseMatch[1].replace(/_/g, ' ');

    // ── Module / assessment  (e.g. "PQ.1", "HW3")
    let module = '';
    const assessMatch = url.match(/\/assessment\/(\d+)/) ||
                        url.match(/\/(PQ[\d.]+|HW[\d]+|quiz[\d]+)/i);
    if (assessMatch) module = assessMatch[1];

    // Try to read it from the page heading
    const heading = document.querySelector('h1, .assessment-title, .navbar-brand');
    if (heading && !module) module = heading.textContent.trim().split('\n')[0].substring(0, 40);

    // ── Question / variant
    let question = '';
    let variant  = '';
    const qMatch = url.match(/\/question\/(\d+)/);
    if (qMatch) question = 'Q' + qMatch[1];

    const vMatch = url.match(/variant[_-]?id=(\d+)/i) ||
                   url.match(/\/variant\/(\d+)/);
    if (vMatch) variant = 'Variant ' + vMatch[1];

    // Fallback: try reading from page elements
    if (!question) {
      const qEl = document.querySelector('.question-title, [data-question-id]');
      if (qEl) question = qEl.textContent.trim().substring(0, 30);
    }

    return { course, module, question, variant, url, title };
  }

  function sendContext() {
    const ctx = extractContext();
    chrome.runtime.sendMessage({ type: 'PAGE_CONTEXT', payload: ctx })
      .catch(() => {}); // background may not be ready
  }

  // ── Send context on load and on URL change (SPA navigation)
  sendContext();

  let _lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(sendContext, 600); // wait for DOM to settle
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Listen for acknowledgements from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ENTRY_SAVED_ACK') {
      // Optional: show a brief in-page toast
      showPageToast('📓 Journal entry saved!');
    }
  });

  function showPageToast(text) {
    const existing = document.getElementById('pl-journal-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pl-journal-toast';
    toast.textContent = text;
    Object.assign(toast.style, {
      position:     'fixed',
      bottom:       '20px',
      right:        '20px',
      background:   '#1e2328',
      color:        '#aee6b8',
      fontFamily:   'monospace',
      fontSize:     '12px',
      padding:      '8px 14px',
      borderRadius: '7px',
      border:       '1px solid #2f353d',
      boxShadow:    '0 4px 20px rgba(0,0,0,0.3)',
      zIndex:       '2147483647',
      opacity:      '0',
      transition:   'opacity 0.2s ease',
      pointerEvents:'none',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
})();
