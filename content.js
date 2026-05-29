// ─── IB AI Solver Content Script ───────────────────────────────────────────

(function () {
  'use strict';

  if (document.getElementById('ib-solver-panel')) return;

  // ── DOM Helpers ─────────────────────────────────────────────────────────────

  function extractProblemDetails() {
    const titleEl = document.querySelector('.p-tile__title, h1.p-tile__title');
    const title = titleEl ? titleEl.textContent.trim() : 'Unknown Problem';
    const stmtEl = document.querySelector('.p-html-content__container, .p-statement .p-html-content__container');
    const statement = stmtEl ? stmtEl.innerText.trim() : '';
    return { title, statement };
  }

  // ── Monaco Helpers ───────────────────────────────────────────────────────────

  function getMonacoEditor() {
    // Prefer the global monaco API
    if (window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors();
      if (editors && editors.length > 0) return editors[0];
    }
    // Walk DOM element properties for the editor instance
    const editorEl = document.querySelector('.monaco-editor');
    if (!editorEl) return null;
    for (const key of Object.keys(editorEl)) {
      try {
        const val = editorEl[key];
        if (val && typeof val.getValue === 'function' && typeof val.setValue === 'function') {
          return val;
        }
      } catch {}
    }
    return null;
  }

  function extractCodeFromEditor() {
    const editor = getMonacoEditor();
    if (editor) return editor.getValue();
    // Last-resort fallback
    const ta = document.querySelector('textarea.inputarea');
    return ta ? ta.value : '';
  }



  // ── Monaco Editor Writing ────────────────────────────────────────────────────

  async function typeCodeIntoEditor(code) {
    await navigator.clipboard.writeText(code);

    const textarea = document.querySelector('textarea.inputarea');
    if (!textarea) throw new Error('Editor not found');

    textarea.focus();
    await sleep(150);

    // Select all existing content
    document.execCommand('selectAll');
    await sleep(100);

    // Paste from clipboard — Monaco intercepts this and handles it natively
    document.execCommand('paste');
    await sleep(300);
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Groq API ─────────────────────────────────────────────────────────────────

  async function solveWithAI(problemDetails, codeTemplate, apiKey, model) {
    const { title, statement } = problemDetails;

    const systemPrompt = `You are an expert competitive programmer. Given a coding problem and a code template, produce a complete Python solution.

Rules:
- Output ONLY valid JSON: {"code": "<python code here>"}
- No comments in the code whatsoever
- No docstrings
- Use clean, minimal Python
- The function/class signature must match what the problem expects (infer from the template)
- Handle edge cases
- Do not include any explanation outside the JSON`;

    const userPrompt = `Problem Title: ${title}

Problem Statement:
${statement}

Code Template (implement in Python with same signature):
${codeTemplate}

Return JSON: {"code": "<complete python solution, no comments>"}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq error ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from API');

    let parsed;
    try {
      const clean = content.replace(/```json\n?|```\n?/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error('Failed to parse JSON from AI response');
    }

    if (!parsed.code) throw new Error('No "code" field in AI response');
    return parsed.code;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  function clickSubmit() {
    const btn = document.querySelector('button.p-judge-actions__submit, button[class*="p-judge-actions__submit"]');
    if (btn) btn.click();
  }

  // ── Panel UI ─────────────────────────────────────────────────────────────────

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'ib-solver-panel';

    panel.innerHTML = `
      <div id="ib-solver-card" class="hidden">
        <div class="ib-card-header">
          <div class="ib-card-title">⚡ IB <span>AI</span> Solver</div>
          <button class="ib-close-btn" id="ib-close">✕</button>
        </div>
        <div class="ib-card-body">
          <div class="ib-problem-info">
            <div class="ib-problem-title" id="ib-prob-title">Loading...</div>
            <div class="ib-problem-meta" id="ib-prob-meta">· interviewbit.com</div>
          </div>

          <div class="ib-toggle-row">
            <span class="ib-toggle-label">Auto-submit</span>
            <label class="ib-toggle">
              <input type="checkbox" id="ib-auto-submit" />
              <span class="ib-toggle-slider"></span>
            </label>
          </div>

          <button class="ib-solve-btn" id="ib-solve-btn">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            Solve with AI
          </button>

          <div class="ib-status" id="ib-status"></div>
        </div>
      </div>

      <button id="ib-solver-fab">
        <div class="ib-pulse"></div>
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </button>
    `;

    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('ib-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `ib-status show ${type}`;
  }

  function clearStatus() {
    const el = document.getElementById('ib-status');
    if (el) el.className = 'ib-status';
  }

  function setSolveBtn(loading) {
    const btn = document.getElementById('ib-solve-btn');
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.innerHTML = `<div class="ib-spinner"></div> Solving...`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:14px;height:14px;fill:#0a1a14">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
        Solve with AI`;
    }
  }

  // ── Main ─────────────────────────────────────────────────────────────────────

  async function init() {
    buildPanel();

    const details = extractProblemDetails();
    const titleEl = document.getElementById('ib-prob-title');
    if (titleEl) titleEl.textContent = details.title;

    chrome.storage.sync.get(['autoSubmit'], data => {
      const toggle = document.getElementById('ib-auto-submit');
      if (toggle) toggle.checked = data.autoSubmit || false;
    });

    document.getElementById('ib-auto-submit')?.addEventListener('change', e => {
      chrome.storage.sync.set({ autoSubmit: e.target.checked });
    });

    document.getElementById('ib-solver-fab')?.addEventListener('click', () => {
      document.getElementById('ib-solver-card')?.classList.toggle('hidden');
    });

    document.getElementById('ib-close')?.addEventListener('click', () => {
      document.getElementById('ib-solver-card')?.classList.add('hidden');
    });

    document.getElementById('ib-solve-btn')?.addEventListener('click', async () => {
      clearStatus();

      const settings = await new Promise(res =>
        chrome.storage.sync.get(['apiKey', 'model', 'autoSubmit'], res)
      );

      if (!settings.apiKey) {
        setStatus('⚠ No API key — open extension popup', 'err');
        return;
      }

      const model = settings.model || 'llama-3.3-70b-versatile';
      const autoSubmit = document.getElementById('ib-auto-submit')?.checked ?? false;

      setSolveBtn(true);
      setStatus('Extracting problem...', 'info');

      try {
        const problem = extractProblemDetails();
        const template = extractCodeFromEditor();

        setStatus('Calling Groq...', 'info');
        const code = await solveWithAI(problem, template, settings.apiKey, model);

        setStatus('Writing code...', 'info');
        await typeCodeIntoEditor(code);

        if (autoSubmit) {
          setStatus('Submitting...', 'info');
          await sleep(500);
          clickSubmit();
          setStatus('✓ Submitted!', 'ok');
        } else {
          setStatus('✓ Code entered! Review before submitting.', 'ok');
        }
      } catch (err) {
        console.error('[IB Solver]', err);
        setStatus(`✗ ${err.message}`, 'err');
      } finally {
        setSolveBtn(false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();