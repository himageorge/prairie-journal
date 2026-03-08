// ── content.js ──────────────────────────────────────────────────────────────
// Reads PrairieLearn DOM for question data, practice detection, and metadata.
// Sends page context to background service worker.
// Responds to side panel requests for question extraction.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  console.log("Prairie Journal: content script loaded");

  // ========================================================================
  // PRAIRIELEARN DOM HELPERS
  // ========================================================================

  // Get assessment name from active nav link (e.g. "P9", "PQ2", "PA1")
  function getAssessmentName() {
    const link = document.querySelector('.nav-item.active .nav-link');
    return link ? link.innerText.trim() : "";
  }

  // Check if this is a practice question
  // PQ1, PQ2 = practice questions (213) ✓
  // P9, P10  = practice (221) ✓
  // PA1      = programming assignment (213) ✗
  function isPracticeQuestion() {
    const name = getAssessmentName();
    return /^PQ\d/.test(name) || /^P\d/.test(name);
  }

  // Get course name from navbar (e.g. "CPSC 221")
  function getCourse() {
    const el = document.querySelector('.navbar-text');
    if (!el) return "";
    const match = el.innerText.match(/CPSC \d+|MATH \d+/i);
    return match ? match[0].toUpperCase() : "";
  }

  // Get submission score from badge (0-100) or null if not graded
  function getScore() {
    const badge = document.querySelector('[data-testid="submission-status"] .badge');
    if (!badge) return null;
    return parseInt(badge.innerText.trim());
  }

  // Get question title from the question block header
  function getQuestionTitle() {
    const block = document.querySelector('.question-block');
    const header = block ? block.querySelector('.card-header') : null;
    return header ? header.innerText.trim() : "Unknown Question";
  }

  // Check if student got a wrong answer on a practice question
  function isWrongPracticeAnswer() {
    const gradingBlock = document.querySelector('.grading-block');
    if (!gradingBlock || gradingBlock.classList.contains('d-none')) return false;
    const score = getScore();
    if (score === null || score === 100) return false;
    return isPracticeQuestion();
  }

  // ========================================================================
  // TEXT EXTRACTION with MathJax support
  // ========================================================================

  // Returns readable text from an element, converting MathJax SVGs
  // to their speech-text equivalent
  function getReadableText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll('mjx-container').forEach(mjx => {
      const speech = mjx.getAttribute('data-semantic-speech-none') ||
                     mjx.getAttribute('data-semantic-speech') || "";
      mjx.replaceWith(document.createTextNode(speech));
    });
    return clone.innerText.trim();
  }

  // ========================================================================
  // EXTRACT FULL QUESTION DATA (called by side panel)
  // ========================================================================

  function extractQuestionData() {
    const questionBody = document.querySelector('.question-body');
    const questionText = getReadableText(questionBody);

    // Answer options — handles both radio buttons and checkboxes
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

    // Correct answer from grading block
    const answerBody = document.querySelector('.grading-block .answer-body');
    const correctAnswer = getReadableText(answerBody);

    // Submitted (wrong) answer
    const submissionBody = document.querySelector('.submission-body');
    const myAnswerText = submissionBody ? submissionBody.innerText.trim() : "";
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
      isPractice: isPracticeQuestion(),
      isWrongAnswer: isWrongPracticeAnswer(),
      url: window.location.href
    };
  }

  // ========================================================================
  // PAGE CONTEXT (sent to background -> forwarded to side panel)
  // ========================================================================

  function buildPageContext() {
    const url = window.location.href;
    return {
      course: getCourse(),
      module: getAssessmentName(),
      question: getQuestionTitle(),
      variant: '',
      url: url,
      title: document.title || '',
      isPractice: isPracticeQuestion(),
      isWrongAnswer: isWrongPracticeAnswer(),
      score: getScore()
    };
  }

  function sendContext() {
    const ctx = buildPageContext();
    chrome.runtime.sendMessage({ type: 'PAGE_CONTEXT', payload: ctx })
      .catch(() => {}); // background may not be ready
  }

  // Send context on load
  sendContext();

  // ========================================================================
  // MESSAGE HANDLER — side panel and background talk to content script
  // ========================================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Side panel asks: is this a wrong practice answer?
    if (msg.type === 'CHECK_PAGE' || msg.action === 'checkPage') {
      sendResponse({
        isWrongAnswer: isWrongPracticeAnswer(),
        isPractice: isPracticeQuestion(),
        isQuestionPage: !!document.querySelector('.question-body')
      });
    }

    // Side panel asks: give me all the question data
    if (msg.type === 'EXTRACT_QUESTION' || msg.action === 'extractQuestion') {
      sendResponse(extractQuestionData());
    }

    // Background confirms an entry was saved — show toast
    if (msg.type === 'ENTRY_SAVED_ACK') {
      showPageToast('📓 Journal entry saved!');
    }

    return true; // keep channel open for async responses
  });

  // ========================================================================
  // FLOATING "JOURNAL THIS MISTAKE" BUTTON
  // ========================================================================

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
        z-index: 2147483647;
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

  // ========================================================================
  // IN-PAGE TOAST NOTIFICATION
  // ========================================================================

  function showPageToast(text) {
    const existing = document.getElementById('pl-journal-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pl-journal-toast';
    toast.textContent = text;
    Object.assign(toast.style, {
      position:      'fixed',
      bottom:        '20px',
      right:         '20px',
      background:    '#1e2328',
      color:         '#aee6b8',
      fontFamily:    'monospace',
      fontSize:      '12px',
      padding:       '8px 14px',
      borderRadius:  '7px',
      border:        '1px solid #2f353d',
      boxShadow:     '0 4px 20px rgba(0,0,0,0.3)',
      zIndex:        '2147483647',
      opacity:       '0',
      transition:    'opacity 0.2s ease',
      pointerEvents: 'none',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ========================================================================
  // RUN ON PAGE LOAD + WATCH FOR NAVIGATION
  // ========================================================================

  // Wait for PrairieLearn to finish rendering
  setTimeout(() => {
    injectJournalButton();
  }, 1000);

  // Watch for URL changes (SPA navigation) and DOM updates
  let _lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        sendContext();
        injectJournalButton();
      }, 600);
    } else {
      setTimeout(() => {
        injectJournalButton();
      }, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();