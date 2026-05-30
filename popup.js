const $ = id => document.getElementById(id);

// ── Provider-specific UI configuration ──────────────────────────────────────
const providerConfig = {
  groq: {
    keyLabel: 'Groq API Key',
    keyPlaceholder: 'gsk_...',
    keyHint: 'Get yours at <a class="hint-link" href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a>',
    modelPlaceholder: 'e.g. openai/gpt-oss-120b',
    modelHint: 'Default: <code style="color:#00e5b0">openai/gpt-oss-120b</code>',
    fallbackPlaceholder: 'e.g. groq/compound',
    fallbackHint: 'Used if primary fails. Default: <code style="color:#00e5b0">groq/compound</code>',
  },
  gemini: {
    keyLabel: 'Gemini API Key',
    keyPlaceholder: 'AIza...',
    keyHint: 'Get yours at <a class="hint-link" href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>',
    modelPlaceholder: 'e.g. gemini-3.5-flash',
    modelHint: 'Default: <code style="color:#00e5b0">gemini-3.5-flash</code>',
    fallbackPlaceholder: 'e.g. gemini-3.1-flash-lite',
    fallbackHint: 'Used if primary fails. Default: <code style="color:#00e5b0">gemini-3.1-flash-lite</code>',
  },
};

function applyProviderUI(provider) {
  const cfg = providerConfig[provider] || providerConfig.groq;
  $('apiKeyLabel').textContent = cfg.keyLabel;
  $('apiKey').placeholder = cfg.keyPlaceholder;
  $('apiKeyHint').innerHTML = cfg.keyHint;
  $('model').placeholder = cfg.modelPlaceholder;
  $('modelHint').innerHTML = cfg.modelHint;
  $('fallbackModel').placeholder = cfg.fallbackPlaceholder;
  $('fallbackHint').innerHTML = cfg.fallbackHint;
}

// ── Load saved settings ─────────────────────────────────────────────────────
chrome.storage.sync.get(['provider', 'apiKey', 'geminiApiKey', 'model', 'fallbackModel', 'autoSubmit'], data => {
  const provider = data.provider || 'groq';
  const providerRadio = document.querySelector(`input[name="provider"][value="${provider}"]`);
  if (providerRadio) providerRadio.checked = true;
  applyProviderUI(provider);

  // Show the correct API key for the selected provider
  if (provider === 'gemini') {
    $('apiKey').value = data.geminiApiKey || '';
  } else {
    $('apiKey').value = data.apiKey || '';
  }

  if (data.model) $('model').value = data.model;
  if (data.fallbackModel) $('fallbackModel').value = data.fallbackModel;
  $('autoSubmit').checked = data.autoSubmit || false;
});

// ── Provider switch ─────────────────────────────────────────────────────────
document.querySelectorAll('input[name="provider"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const newProvider = e.target.value;
    applyProviderUI(newProvider);

    // Save current key, load the other provider's key
    const currentKey = $('apiKey').value.trim();
    chrome.storage.sync.get(['apiKey', 'geminiApiKey'], data => {
      if (newProvider === 'gemini') {
        // Switching to Gemini — save current as groq key, load gemini key
        chrome.storage.sync.set({ apiKey: currentKey });
        $('apiKey').value = data.geminiApiKey || '';
      } else {
        // Switching to Groq — save current as gemini key, load groq key
        chrome.storage.sync.set({ geminiApiKey: currentKey });
        $('apiKey').value = data.apiKey || '';
      }
    });

    // Clear model fields so defaults take effect for the new provider
    $('model').value = '';
    $('fallbackModel').value = '';
  });
});

// ── Save ─────────────────────────────────────────────────────────────────────
$('saveBtn').addEventListener('click', () => {
  const provider = document.querySelector('input[name="provider"]:checked').value;
  const key = $('apiKey').value.trim();
  const model = $('model').value;
  const fallbackModel = $('fallbackModel').value;
  const autoSubmit = $('autoSubmit').checked;

  if (!key) {
    showStatus('API key is required', 'err');
    return;
  }

  const payload = { provider, model, fallbackModel, autoSubmit };

  // Store the key under the correct field
  if (provider === 'gemini') {
    payload.geminiApiKey = key;
  } else {
    payload.apiKey = key;
  }

  chrome.storage.sync.set(payload, () => {
    showStatus('Settings saved!', 'ok');
  });
});

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${type}`;
  setTimeout(() => { el.className = 'status'; }, 2500);
}
