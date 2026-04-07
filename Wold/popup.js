const apiKeyInput = document.getElementById('apiKeyInput');
const saveBtn = document.getElementById('saveBtn');
const savedMsg = document.getElementById('savedMsg');
const toggleBtn = document.getElementById('toggleVisibility');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');

// Load existing key on open
chrome.storage.sync.get(['anthropicApiKey'], (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
    setConnected(true);
  }
});

toggleBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showMessage('Please enter a key first', false);
    return;
  }

  chrome.storage.sync.set({ anthropicApiKey: key }, () => {
    setConnected(true);
    showMessage('Saved!', true);
  });
});

function setConnected(connected) {
  statusBadge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
  statusText.textContent = connected ? 'API key connected' : 'No API key set';
}

function showMessage(msg, success) {
  savedMsg.textContent = msg;
  savedMsg.style.color = success ? '#4ade80' : '#f87171';
  savedMsg.style.opacity = '1';
  setTimeout(() => { savedMsg.style.opacity = '0'; }, 2500);
}
