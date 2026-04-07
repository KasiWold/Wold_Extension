// LinkedIn AI Reply - Content Script v1.1
// Watches for LinkedIn message inputs and injects AI reply button

const BUTTON_ID = 'linkedin-ai-reply-btn';
const INDICATOR_CLASS = 'ai-reply-injected';

function getConversationContext() {
  const messages = [];

  // Try to grab messages from the conversation thread
  const messageEls = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-group__meta');
  
  // Grab structured message bubbles
  const bubbles = document.querySelectorAll('.msg-s-event-listitem');
  bubbles.forEach(bubble => {
    const body = bubble.querySelector('.msg-s-event-listitem__body');
    const senderEl = bubble.querySelector('.msg-s-message-group__profile-link, .msg-s-message-group__name');
    if (body) {
      const text = body.innerText.trim();
      const sender = senderEl ? senderEl.innerText.trim() : 'Other';
      if (text) {
        messages.push({ sender, text });
      }
    }
  });

  // Fallback: grab raw text blobs
  if (messages.length === 0) {
    messageEls.forEach(el => {
      const text = el.innerText.trim();
      if (text) messages.push({ sender: 'Unknown', text });
    });
  }

  return messages.slice(-10); // Last 10 messages for context
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
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L13.09 8.26L19 6L15.45 11.13L21 13.27L15.09 14.5L17 20L12 16.77L7 20L8.91 14.5L3 13.27L8.55 11.13L5 6L10.91 8.26L12 2Z" fill="currentColor"/>
    </svg>
    <span>Draft reply</span>
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

async function handleDraftReply(inputBox, btn) {
  // Check for API key first
  const result = await chrome.storage.local.get(['anthropicApiKey']);
  if (!result.anthropicApiKey) {
    showToast('⚠️ Add your API key in the extension settings (click the icon in your toolbar)', 'warning');
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    return;
  }

  const originalContent = btn.innerHTML;
  const spinner = createLoadingSpinner();
  btn.innerHTML = '';
  btn.appendChild(spinner);
  btn.disabled = true;

  try {
    const messages = getConversationContext();
    
    if (messages.length === 0) {
      showToast('Could not read the conversation. Try scrolling up to load messages first.', 'error');
      return;
    }

    const conversationText = messages
      .map(m => `${m.sender}: ${m.text}`)
      .join('\n');

    const response = await chrome.runtime.sendMessage({
      type: 'DRAFT_REPLY',
      payload: {
        conversation: conversationText,
        apiKey: result.anthropicApiKey
      }
    });

    if (response.error) {
      showToast('Error: ' + response.error, 'error');
      return;
    }

    // Insert the drafted reply into LinkedIn's contenteditable input
    const draft = response.draft;
    if (draft) {
      inputBox.focus();
      
      // Clear existing content
      inputBox.innerHTML = '';
      
      // Use execCommand to insert text (works best with LinkedIn's React editor)
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, draft);

      // Trigger input event so LinkedIn's React state updates
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

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
    handleDraftReply(inputBox, btn);
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
