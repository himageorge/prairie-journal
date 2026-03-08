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