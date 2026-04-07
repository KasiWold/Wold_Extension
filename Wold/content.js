// LinkedIn AI Reply - Content Script v1.1
// Watches for LinkedIn message inputs and injects AI reply button

const BUTTON_ID = 'linkedin-ai-reply-btn';
const INDICATOR_CLASS = 'ai-reply-injected';

function getConversationContext() {
  const messages = [];

  const bubbles = document.querySelectorAll('.msg-s-event-listitem');
  bubbles.forEach(bubble => {
    const body = bubble.querySelector('.msg-s-event-listitem__body');
    const senderEl = bubble.querySelector('.msg-s-message-group__profile-link, .msg-s-message-group__name');
    if (body) {
      const text = body.innerText.trim();
      const sender = senderEl ? senderEl.innerText.trim() : 'Other';
      if (text) messages.push({ sender, text });
    }
  });

  // Fallback
  if (messages.length === 0) {
    document.querySelectorAll('.msg-s-event-listitem__body').forEach(el => {
      const text = el.innerText.trim();
      if (text) messages.push({ sender: 'Unknown', text });
    });
  }

  const last10 = messages.slice(-10);

  // Remove the very last message ONLY if it's from me (Isak Wold),
  // so the AI doesn't just rephrase what I already wrote.
  // We check only the last item to avoid accidentally dropping other messages.
  const MY_NAME_PATTERN = /isak\s*wold/i;
  if (last10.length > 0 && MY_NAME_PATTERN.test(last10[last10.length - 1].sender)) {
    last10.pop();
  }

  return last10;
}

function getMyName() {
  // Try to get user's own name from LinkedIn nav
  const nameEl = document.querySelector('.global-nav__me-photo, .feed-identity-module__actor-meta a');
  return nameEl ? nameEl.getAttribute('alt') || nameEl.innerText.trim() : 'me';
}

function createAIButton() {
  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.className = 'ai-reply-btn';
  const logoUrl = chrome.runtime.getURL('logo.png');
  btn.innerHTML = `
    <img src="${logoUrl}" class="ai-btn-logo" alt="" />
    <span>Wold</span>
  `;
  return btn;
}

function createLoadingSpinner() {
  const spinner = document.createElement('div');
  spinner.className = 'ai-reply-spinner';
  spinner.innerHTML = `
    <div class="ai-spinner-dot"></div>
    <div class="ai-spinner-dot"></div>
    <div class="ai-spinner-dot"></div>
  `;
  return spinner;
}

function showContextModal(inputBox, btn) {
  // Remove any existing modal
  const existing = document.getElementById('ai-context-modal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'ai-context-modal';
  modal.className = 'ai-context-modal';
  const logoUrl = chrome.runtime.getURL('logo.png');
  modal.innerHTML = `
    <textarea class="ai-modal-textarea" placeholder="Meeting Thursday 14:00, decline politely, ask about budget..."></textarea>
    <button class="ai-modal-generate-btn">
      <img src="${logoUrl}" class="ai-btn-logo" alt="" />
      Generate
    </button>
  `;

  // Position near the button
  const btnRect = btn.getBoundingClientRect();
  modal.style.position = 'fixed';
  modal.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
  modal.style.left = btnRect.left + 'px';

  document.body.appendChild(modal);
  modal.querySelector('.ai-modal-textarea').focus();

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeModal(e) {
      if (!modal.contains(e.target) && e.target !== btn) {
        modal.remove();
        document.removeEventListener('click', closeModal);
      }
    });
  }, 100);

  modal.querySelector('.ai-modal-generate-btn').addEventListener('click', () => {
    const context = modal.querySelector('.ai-modal-textarea').value.trim();
    modal.remove();
    handleDraftReply(inputBox, btn, context);
  });

  // Also allow Enter+Ctrl to generate
  modal.querySelector('.ai-modal-textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      const context = modal.querySelector('.ai-modal-textarea').value.trim();
      modal.remove();
      handleDraftReply(inputBox, btn, context);
    }
  });
}

function insertTextIntoLinkedIn(inputBox, draft) {
  inputBox.focus();

  // Split on newlines and build paragraph structure for Quill/LinkedIn
  const lines = draft.split('\n').filter(l => l.trim() !== '');

  // Try setting innerHTML with paragraph tags (Quill format)
  const html = lines.map(l => `<p>${l}</p>`).join('');
  
  // Select all and delete first
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  if (lines.length > 1) {
    // Insert line by line with newlines between
    lines.forEach((line, i) => {
      document.execCommand('insertText', false, line);
      if (i < lines.length - 1) {
        document.execCommand('insertParagraph', false, null);
      }
    });
  } else {
    document.execCommand('insertText', false, draft);
  }

  // Fire events so LinkedIn's React picks up the change
  ['input', 'change', 'keyup'].forEach(type => {
    inputBox.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

async function handleDraftReply(inputBox, btn, extraContext = '') {
  const result = await chrome.storage.sync.get(['anthropicApiKey']);
  if (!result.anthropicApiKey) {
    showToast('⚠️ Add your API key in the extension settings', 'warning');
    return;
  }

  const originalContent = btn.innerHTML;
  const spinner = createLoadingSpinner();
  btn.innerHTML = '';
  btn.appendChild(spinner);
  btn.disabled = true;

  try {
    const messages = getConversationContext();
    const conversationText = messages.map(m => `${m.sender}: ${m.text}`).join('\n');

    const response = await chrome.runtime.sendMessage({
      type: 'DRAFT_REPLY',
      payload: {
        conversation: conversationText,
        extraContext,
        apiKey: result.anthropicApiKey
      }
    });

    if (response.error) {
      showToast('Error: ' + response.error, 'error');
      return;
    }

    if (response.draft) {
      insertTextIntoLinkedIn(inputBox, response.draft);
      showToast('✓ Draft ready — review before sending!', 'success');
    }

  } catch (err) {
    showToast('Something went wrong. Check your API key.', 'error');
    console.error('[LinkedIn AI Reply]', err);
  } finally {
    btn.innerHTML = originalContent;
    btn.disabled = false;
  }
}

function showToast(message, type = 'info') {
  const existing = document.getElementById('ai-reply-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'ai-reply-toast';
  toast.className = `ai-reply-toast ai-reply-toast--${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('ai-reply-toast--visible'), 10);
  setTimeout(() => {
    toast.classList.remove('ai-reply-toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function injectButton(inputBox) {
  // Don't inject twice on same element
  if (inputBox.dataset.aiInjected) return;
  inputBox.dataset.aiInjected = 'true';

  const btn = createAIButton();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextModal(inputBox, btn);
  });

  // Strategy 1: find the footer toolbar (row with Send button / GIF / emoji)
  const formEl = inputBox.closest('form, .msg-form, [class*="msg-form"], [data-view-name]');
  if (formEl) {
    // Look for the toolbar row that contains the Send button
    const footer = formEl.querySelector(
      '.msg-form__footer, [class*="msg-form__footer"], [class*="form__footer"]'
    );
    if (footer) {
      footer.insertAdjacentElement('afterbegin', btn);
      return;
    }

    // Fallback: find a row that has a Send button and insert before it
    const sendBtn = formEl.querySelector('button[class*="send"], button[data-control-name="send"]');
    if (sendBtn) {
      const sendParent = sendBtn.closest('[class*="flex"], [class*="actions"], [class*="footer"]') || sendBtn.parentElement;
      if (sendParent) {
        sendParent.insertAdjacentElement('afterbegin', btn);
        return;
      }
    }
  }

  // Strategy 2: inject directly after the input's parent container
  const wrapper = document.createElement('div');
  wrapper.className = 'ai-reply-action-bar';
  wrapper.appendChild(btn);

  const parent = inputBox.closest('[class*="editor"], [class*="compose"], [class*="texteditor"]') || inputBox.parentElement;
  parent.insertAdjacentElement('afterend', wrapper);
}

function findMessageInputs() {
  // Cast a wide net with multiple selector strategies
  const found = new Set();

  // Primary: LinkedIn's known class
  document.querySelectorAll('.msg-form__contenteditable').forEach(el => found.add(el));

  // Any contenteditable inside a messaging form
  document.querySelectorAll('[class*="msg-form"] [contenteditable="true"]').forEach(el => found.add(el));
  document.querySelectorAll('[class*="msg-form"] .ql-editor').forEach(el => found.add(el));

  // Broader: contenteditable with a "Write a message" style placeholder
  document.querySelectorAll('[contenteditable="true"][data-placeholder]').forEach(el => {
    const placeholder = el.getAttribute('data-placeholder') || '';
    if (placeholder.toLowerCase().includes('message') || placeholder.toLowerCase().includes('skriv')) {
      found.add(el);
    }
  });

  // role=textbox inside anything that looks like messaging
  document.querySelectorAll('[role="textbox"]').forEach(el => {
    if (el.closest('[class*="msg"], [class*="message"], [class*="compose"]')) {
      found.add(el);
    }
  });

  return found;
}

function scanForMessageInputs() {
  findMessageInputs().forEach(el => injectButton(el));
}

// MutationObserver for dynamic SPA navigation
let scanTimeout = null;
const observer = new MutationObserver(() => {
  // Debounce to avoid hammering on every tiny DOM change
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanForMessageInputs, 300);
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan + polling fallback (LinkedIn loads lazily)
scanForMessageInputs();
setTimeout(scanForMessageInputs, 1000);
setTimeout(scanForMessageInputs, 3000);

// Poll every 2s as a safety net (stops after 60s to save resources)
let pollCount = 0;
const poller = setInterval(() => {
  scanForMessageInputs();
  if (++pollCount > 30) clearInterval(poller);
}, 2000);
