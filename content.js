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
    const PRACTICE_RE = /^PQ\d|^P\d|^FQP\d|^ICA\d/;

    // Primary: active nav-link (original selector)
    const navActive = document.querySelector('.nav-item.active .nav-link');
    if (navActive && PRACTICE_RE.test(navActive.innerText.trim())) return true;

    // Fallback 1: any element with aria-current="page" (some PL layouts use this)
    const ariaCurrent = document.querySelector('[aria-current="page"]');
    if (ariaCurrent && PRACTICE_RE.test(ariaCurrent.innerText.trim())) return true;

    // Fallback 2: active list-group item (sidebar variant)
    const listActive = document.querySelector('.list-group-item.active');
    if (listActive && PRACTICE_RE.test(listActive.innerText.trim())) return true;

    // Fallback 3: breadcrumb items
    document.querySelectorAll('.breadcrumb-item').forEach(el => {
      if (PRACTICE_RE.test(el.innerText.trim())) return true; // exits forEach only
    });
    for (const el of document.querySelectorAll('.breadcrumb-item')) {
      if (PRACTICE_RE.test(el.innerText.trim())) return true;
    }

    // Fallback 4: page title  (e.g. "PQ9.5 - CPSC 212")
    if (/\bPQ\d|\bP\d|\bFQP\d|\bICA\d/.test(document.title)) return true;

    return false;
  }

  // Get course name from navbar (e.g. "CPSC 221")
  function getCourse() {
    const el = document.querySelector('.navbar-text');
    if (!el) return "";
    const match = el.innerText.match(/CPSC \d+/i);
    return match ? match[0].toUpperCase() : "";
  }

  // Get submission score from badge (0-100) or null if not graded
  function getScore() {
    const badge = document.querySelector('a.badge.text-bg-info, .badge.text-bg-info, a.badge.bg-info, .badge.bg-info');
    if (!badge) return null;
    const text = badge.innerText;
    const pctMatch = text.match(/(\d+)%/);
    if (pctMatch) return parseInt(pctMatch[1]);
    const numMatch = text.match(/\d+/);
    return numMatch ? parseInt(numMatch[0]) : null;
  }

  // Get question title from the question block header
  function getQuestionTitle() {
    const block = document.querySelector('.question-block');
    const header = block ? block.querySelector('.card-header') : null;
    return header ? header.innerText.trim() : "Unknown Question";
  }

  function getVariantInfo() {
    // Get ALL variant badge links (secondary = all variants, info = current)
    const allBadges = document.querySelectorAll('a.badge.text-bg-secondary, a.badge.text-bg-info');
    if (!allBadges.length) return null;
  
    const variants = Array.from(allBadges).map(badge => {
      const url = new URL(badge.href, window.location.origin);
      return url.searchParams.get('variant_id');
    });
  
    // Current variant is the one with text-bg-info class
    const currentBadge = document.querySelector('a.badge.text-bg-info');
    if (!currentBadge) return null;
    
    const currentUrl = new URL(currentBadge.href, window.location.origin);
    const currentId = currentUrl.searchParams.get('variant_id');
  
    const index = variants.indexOf(currentId); // 0-based
  
    return {
      id: currentId,
      label: `Variant ${index + 1}`,
      url: currentBadge.href
    };
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
  // to their speech-text equivalent, preserving code block formatting.
  function getReadableText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);

    // MathJax
    clone.querySelectorAll('mjx-container').forEach(mjx => {
      const speech = mjx.getAttribute('data-semantic-speech-none') ||
        mjx.getAttribute('data-semantic-speech') || "";
      mjx.replaceWith(document.createTextNode(speech));
    });

    // Multi-line code blocks (<pre> or <pre><code>) — triple backticks
    // Must run before inline code to avoid double-wrapping
    clone.querySelectorAll('pre').forEach(pre => {
      const codeEl = pre.querySelector('code');
      const text = (codeEl || pre).innerText.trimEnd();
      pre.replaceWith(document.createTextNode(`\n\`\`\`\n${text}\n\`\`\`\n`));
    });

    // Inline code
    clone.querySelectorAll('code').forEach(code => {
      code.replaceWith(document.createTextNode(`\`${code.innerText}\``));
    });

    // Images — include alt text if available
    clone.querySelectorAll('img').forEach(img => {
      const label = img.alt ? `[image: ${img.alt}]` : '[image]';
      img.replaceWith(document.createTextNode(label));
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
    const correctAnswer = getReadableText(document.querySelector('.grading-block .answer-body'));


    // Submitted (wrong) answer
    const submissionBody = document.querySelector('.submission-body');
    const myAnswerText = getReadableText(submissionBody);
    
  

    const variantInfo = getVariantInfo();
    return {
      questionTitle: getQuestionTitle(),
      questionText,
      options,
      myAnswerText,
      correctAnswer,
      course: getCourse(),
      assessmentName: getAssessmentName(),
      variant: variantInfo ? variantInfo.label : '',
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
    const variantInfo = getVariantInfo();
    return {
      course: getCourse(),
      module: getAssessmentName(),
      question: getQuestionTitle(),
      variant: variantInfo ? variantInfo.label : '',
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
      return false;
    }

    // Side panel asks: give me the current page context
    if (msg.type === 'GET_CONTEXT') {
      sendResponse(buildPageContext());
      return false;
    }

    // Side panel asks: give me all the question data
    if (msg.type === 'EXTRACT_QUESTION' || msg.action === 'extractQuestion') {
      sendResponse(extractQuestionData());
      return false;
    }

    // Background confirms an entry was saved — show toast
    if (msg.type === 'ENTRY_SAVED_ACK') {
      showPageToast('📓 Journal entry saved!');
      return false;
    }

    // Background asks content script to show the "practice only" tease
    if (msg.action === 'showTease') {
      showTeaseMessage();
      return false;
    }

    return false;
  });

  // ========================================================================
  // FLOATING "JOURNAL THIS MISTAKE" BUTTON
  // ========================================================================

  function hasWrongAnswer() {
    const gradingBlock = document.querySelector('.grading-block');
    if (!gradingBlock || gradingBlock.classList.contains('d-none')) return false;
    const score = getScore();
    return score !== null && score < 100;
  }

  function injectJournalButton() {
    if (document.getElementById('prairie-journal-btn')) return;
    if (!hasWrongAnswer()) return;

    const btn = document.createElement('div');
    btn.id = 'prairie-journal-btn';
    btn.innerHTML = `
      <div style="
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 46px;
        height: 46px;
        background: #4a6cf7;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(74, 108, 247, 0.4);
        z-index: 2147483647;
        font-size: 22px;
        user-select: none;
      " title="Journal this mistake">✏️</div>
    `;

    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });

    document.body.appendChild(btn);

  }
    // ========================================================================
  //  Tease Message
  // ========================================================================

  function showTeaseMessage() {
    // Don't stack duplicates
    if (document.getElementById('pl-tease')) return;
  
    const panel = document.createElement('div');
    panel.id = 'pl-tease';
    panel.innerHTML = `
      <div style="
        position: fixed; bottom: 20px; right: 20px;
        background: #1a1a2e; color: #fff;
        border-radius: 12px; padding: 16px 20px;
        font-family: sans-serif; font-size: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        max-width: 220px; text-align: center; z-index: 99999;
      ">
        <div style="font-size: 24px; margin-bottom: 8px">🚫🤖</div>
        <strong>Nope!</strong><br>
        Only works on practice questions.<br>
        <span style="opacity: 0.6; font-size: 12px">Go struggle a little 😄</span>
      </div>
    `;
    document.body.appendChild(panel);
    setTimeout(() => panel.remove(), 3000);
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
  // VARIANT BADGE HIGHLIGHTING
  // ========================================================================

  function highlightVariantsWithEntries() {
    const allBadges = document.querySelectorAll('a.badge.text-bg-secondary, a.badge.text-bg-info');
    if (!allBadges.length) return;

    const course   = getCourse();
    const module   = getAssessmentName();
    const question = getQuestionTitle();

    chrome.storage.local.get(['pl_journals'], result => {
      const journals = result['pl_journals'] || [];
      const keySet = new Set(journals.map(e => e.key));

      allBadges.forEach((badge, index) => {
        const variantLabel = `Variant ${index + 1}`;
        const key = [course, module, question, variantLabel].filter(Boolean).join('||');

        // Remove any previously injected dot to avoid duplicates on re-runs
        const existing = badge.querySelector('.pl-journal-dot');
        if (existing) existing.remove();

        if (keySet.has(key)) {
          badge.style.setProperty('background-color', '#f5c842', 'important');
          badge.style.setProperty('color',            '#1a1a1a', 'important');
          badge.style.setProperty('font-weight',      '700',     'important');
          badge.title = '📓 You have a journal entry for this variant';
        } else {
          badge.style.removeProperty('background-color');
          badge.style.removeProperty('color');
          badge.style.removeProperty('font-weight');
          badge.title = '';
        }
      });
    });
  }

  // ========================================================================
  // RUN ON PAGE LOAD + WATCH FOR NAVIGATION
  // ========================================================================

  // Wait for PrairieLearn to finish rendering
  setTimeout(() => {
    injectJournalButton();
    highlightVariantsWithEntries();
  }, 1000);

  // Watch for URL changes (SPA navigation) and DOM updates
  let _lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        sendContext();
        injectJournalButton();
        highlightVariantsWithEntries();
      }, 600);
    } else {
      setTimeout(() => {
        injectJournalButton();
        highlightVariantsWithEntries();
      }, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Re-highlight badges after a new entry is saved
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ENTRY_SAVED_ACK') {
      setTimeout(highlightVariantsWithEntries, 200);
    }
  });

})();