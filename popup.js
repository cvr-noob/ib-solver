const $ = id => document.getElementById(id);

chrome.storage.sync.get(['apiKey', 'model', 'fallbackModel', 'autoSubmit'], data => {
  if (data.apiKey) $('apiKey').value = data.apiKey;
  if (data.model) $('model').value = data.model;
  if (data.fallbackModel) $('fallbackModel').value = data.fallbackModel;
  $('autoSubmit').checked = data.autoSubmit || false;
});

$('saveBtn').addEventListener('click', () => {
  const apiKey = $('apiKey').value.trim();
  const model = $('model').value;
  const fallbackModel = $('fallbackModel').value;
  const autoSubmit = $('autoSubmit').checked;

  if (!apiKey) {
    showStatus('API key is required', 'err');
    return;
  }

  chrome.storage.sync.set({ apiKey, model, fallbackModel, autoSubmit }, () => {
    showStatus('Settings saved!', 'ok');
  });
});

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${type}`;
  setTimeout(() => { el.className = 'status'; }, 2500);
}
