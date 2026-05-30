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


  // ── Monaco Helpers (via bridge) ─────────────────────────────────────────────

  function extractCodeFromEditor() {
    return new Promise((resolve) => {
      const handler = (e) => {
        window.removeEventListener('ib-solver-code-result', handler);
        resolve(e.detail || '');
      };
      window.addEventListener('ib-solver-code-result', handler);
      window.dispatchEvent(new CustomEvent('ib-solver-get-code'));

      // Fallback timeout — if inject.js hasn't loaded yet, read textarea
      setTimeout(() => {
        window.removeEventListener('ib-solver-code-result', handler);
        const ta = document.querySelector('textarea.inputarea');
        resolve(ta ? ta.value : '');
      }, 500);
    });
  }



  // ── Monaco Editor Writing (via bridge) ──────────────────────────────────────

  async function typeCodeIntoEditor(code) {
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        window.removeEventListener('ib-solver-set-code-done', handler);
        if (e.detail?.ok) {
          resolve();
        } else {
          reject(new Error(e.detail?.error || 'Failed to set code in editor'));
        }
      };
      window.addEventListener('ib-solver-set-code-done', handler);
      window.dispatchEvent(new CustomEvent('ib-solver-set-code', { detail: code }));

      // Timeout safety
      setTimeout(() => {
        window.removeEventListener('ib-solver-set-code-done', handler);
        reject(new Error('Timed out writing code to editor'));
      }, 3000);
    });
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── System prompt (shared by all providers) ─────────────────────────────────

  function buildPrompts(problemDetails, codeTemplate) {
    const { title, statement } = problemDetails;

    const systemPrompt = `You are an expert competitive programmer. You will be given a coding problem and a Python code template from InterviewBit. Your job is to fill in the template with a correct solution.

CRITICAL RULES:
1. You MUST keep the EXACT same class name, method name, and parameter signature from the template.
2. You MUST keep any provided class/method structure from the template UNCHANGED.
3. Only fill in the method body (or fix bugs if the problem asks to fix a bug).
4. Do NOT rename anything, do NOT change parameters, do NOT change return types.
5. Do NOT add any new comments or docstrings. Keep any comments already in the template. NO EXTRA COMMENTS ALLOWED.
6. Output ONLY valid JSON: {"code": "<complete python solution>"}
7. The "code" field must contain the ENTIRE template with your solution filled in, ready to submit as-is.
8. STRICLY PREVENT COMMENTS. ONLY COMMENTS FROM THE TEMPLATE CAN BE THERE AND NO EXTRA COMMENTS.`;

    const userPrompt = `Problem: ${title}

Statement:
${statement}

Code Template (keep this structure EXACTLY, only fill in the logic):
\`\`\`python
${codeTemplate}
\`\`\`

Return ONLY JSON: {"code": "<complete solution keeping the exact template structure>"}`;

    return { systemPrompt, userPrompt };
  }

  // ── Groq API ────────────────────────────────────────────────────────────────

  async function callGroq(apiKey, model, systemPrompt, userPrompt) {
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
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content;
  }

  // ── Gemini API ──────────────────────────────────────────────────────────────

  async function callGemini(apiKey, model, systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  }

  // ── Unified solve function ──────────────────────────────────────────────────

  function parseAIResponse(content) {
    if (!content) throw new Error('Empty response from AI');
    
    console.log('[IB Solver] Raw AI response:', content);

    // 1. Try to clean markdown fences around JSON if present
    let clean = content.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    // 2. Try parsing as JSON directly
    try {
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed === 'object') {
        if (parsed.code) return parsed.code.trim();
        // Fallback: search key values if they named the key differently
        for (const val of Object.values(parsed)) {
          if (typeof val === 'string' && val.includes('class Solution')) {
            return val.trim();
          }
        }
      }
    } catch (e) {
      console.warn('[IB Solver] Direct JSON parse failed, trying regex and block matching...', e);
    }

    // 3. Extract "code" field from JSON using a regex (handles unescaped control chars/newlines)
    const codeFieldRegex = /"code"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/i;
    const matchJsonField = content.match(codeFieldRegex);
    if (matchJsonField) {
      return matchJsonField[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
    }

    // 4. Try to extract from a python code block
    const codeBlockRegex = /```(?:python|py)?\n([\s\S]*?)\n```/gi;
    let matchBlock;
    while ((matchBlock = codeBlockRegex.exec(content)) !== null) {
      const blockContent = matchBlock[1].trim();
      if (blockContent.includes('class Solution') || blockContent.includes('def ')) {
        return blockContent;
      }
    }

    // 5. Check if clean content itself looks like python
    if (clean.includes('class Solution') || clean.includes('def ')) {
      return clean;
    }

    // 6. Search for class Solution directly
    const idx = content.indexOf('class Solution');
    if (idx !== -1) {
      let sub = content.substring(idx);
      const endFence = sub.indexOf('```');
      if (endFence !== -1) sub = sub.substring(0, endFence);
      return sub.trim();
    }

    throw new Error('Failed to parse AI response. See browser console for details.');
  }

  async function solveWithAI(problemDetails, codeTemplate, settings) {
    const { systemPrompt, userPrompt } = buildPrompts(problemDetails, codeTemplate);
    const provider = settings.provider || 'groq';

    let apiKey, model, fallbackModel, callFn, providerLabel;

    if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      model = settings.model || 'gemini-3.5-flash';
      fallbackModel = settings.fallbackModel || 'gemini-3.1-flash-lite';
      callFn = callGemini;
      providerLabel = 'Gemini';
    } else {
      apiKey = settings.apiKey;
      model = settings.model || 'openai/gpt-oss-120b';
      fallbackModel = settings.fallbackModel || 'groq/compound';
      callFn = callGroq;
      providerLabel = 'Groq';
    }

    if (!apiKey) throw new Error(`No ${providerLabel} API key set — open extension popup`);

    let content;
    try {
      content = await callFn(apiKey, model, systemPrompt, userPrompt);
      if (!content) throw new Error('Empty response');
    } catch (err) {
      console.warn(`Primary model (${model}) failed, trying fallback`, err);
      content = await callFn(apiKey, fallbackModel, systemPrompt, userPrompt);
      if (!content) throw new Error('Empty response from fallback model');
    }

    return parseAIResponse(content);
  }

  // ── Submit & Run ─────────────────────────────────────────────────────────────

  function clickSubmit() {
    const btn = document.querySelector('button.p-judge-actions__submit, button[class*="p-judge-actions__submit"]');
    if (btn) btn.click();
  }

  function clickRun() {
    const btn = document.querySelector('button.p-judge-actions__test, button[class*="p-judge-actions__test"]');
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

          <div class="ib-toggle-row">
            <span class="ib-toggle-label">Auto-run</span>
            <label class="ib-toggle">
              <input type="checkbox" id="ib-auto-run" />
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

    chrome.storage.sync.get(['autoSubmit', 'autoRun'], data => {
      const toggleSubmit = document.getElementById('ib-auto-submit');
      if (toggleSubmit) toggleSubmit.checked = data.autoSubmit || false;
      const toggleRun = document.getElementById('ib-auto-run');
      if (toggleRun) toggleRun.checked = data.autoRun || false;
    });

    document.getElementById('ib-auto-submit')?.addEventListener('change', e => {
      const autoSubmit = e.target.checked;
      const toggleRun = document.getElementById('ib-auto-run');
      if (autoSubmit && toggleRun) {
        toggleRun.checked = false;
        chrome.storage.sync.set({ autoSubmit: true, autoRun: false });
      } else {
        chrome.storage.sync.set({ autoSubmit: autoSubmit });
      }
    });

    document.getElementById('ib-auto-run')?.addEventListener('change', e => {
      const autoRun = e.target.checked;
      const toggleSubmit = document.getElementById('ib-auto-submit');
      if (autoRun && toggleSubmit) {
        toggleSubmit.checked = false;
        chrome.storage.sync.set({ autoRun: true, autoSubmit: false });
      } else {
        chrome.storage.sync.set({ autoRun: autoRun });
      }
    });

    const fab = document.getElementById('ib-solver-fab');
    const panel = document.getElementById('ib-solver-panel');
    let isDragging = false;
    let hasDragged = false;
    let startX, startY, initialLeft, initialTop;

    // ── Drag logic ──────────────────────────────────────────────────────────
    // We track the FAB's own absolute position and move the panel so the FAB
    // stays exactly where the user dragged it. This prevents the FAB from
    // jumping when the card opens/closes (which changes the panel's size).

    function getFabAbsolutePos() {
      const fabRect = fab.getBoundingClientRect();
      return { x: fabRect.left, y: fabRect.top };
    }

    function positionPanelForFab(fabX, fabY) {
      // The FAB is at the bottom of the panel flex container.
      // We need to figure out the panel offset so the FAB lands at (fabX, fabY).
      const card = document.getElementById('ib-solver-card');
      const cardVisible = card && !card.classList.contains('hidden');

      // Temporarily measure where the FAB would be relative to the panel
      // Set panel to a known position, measure, then adjust.
      panel.style.left = '0px';
      panel.style.top = '0px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      const panelRect = panel.getBoundingClientRect();
      const fabRect = fab.getBoundingClientRect();

      // FAB offset within the panel
      const fabOffsetX = fabRect.left - panelRect.left;
      const fabOffsetY = fabRect.top - panelRect.top;

      // Desired panel position
      let newLeft = fabX - fabOffsetX;
      let newTop = fabY - fabOffsetY;

      // Clamp to viewport
      const maxLeft = window.innerWidth - panelRect.width;
      const maxTop = window.innerHeight - panelRect.height;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    }

    // Store the desired FAB position (absolute viewport coords)
    let fabTargetX = null;
    let fabTargetY = null;

    if (fab && panel) {
      fab.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;

        // Capture FAB's current absolute position as the drag origin
        const fabPos = getFabAbsolutePos();
        initialLeft = fabPos.x;
        initialTop = fabPos.y;

        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;

        // Compute desired FAB absolute position
        let targetX = initialLeft + dx;
        let targetY = initialTop + dy;

        // Clamp FAB within viewport
        const fabW = fab.offsetWidth;
        const fabH = fab.offsetHeight;
        targetX = Math.max(0, Math.min(targetX, window.innerWidth - fabW));
        targetY = Math.max(0, Math.min(targetY, window.innerHeight - fabH));

        fabTargetX = targetX;
        fabTargetY = targetY;

        positionPanelForFab(targetX, targetY);
      });

      document.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
      });

      const toggleCard = (forceClose = false) => {
        const card = document.getElementById('ib-solver-card');
        if (!card) return;

        // Remember FAB position before toggling
        const fabPos = getFabAbsolutePos();
        fabTargetX = fabPos.x;
        fabTargetY = fabPos.y;

        if (forceClose) {
          card.classList.add('hidden');
        } else {
          card.classList.toggle('hidden');
        }

        // Reposition panel so FAB stays in the same spot
        positionPanelForFab(fabTargetX, fabTargetY);
      };

      fab.addEventListener('click', (e) => {
        if (hasDragged) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        toggleCard();
      });

      document.getElementById('ib-close')?.addEventListener('click', () => {
        toggleCard(true);
      });
    }

    document.getElementById('ib-solve-btn')?.addEventListener('click', async () => {
      clearStatus();

      const settings = await new Promise(res =>
        chrome.storage.sync.get(['provider', 'apiKey', 'geminiApiKey', 'model', 'fallbackModel', 'autoSubmit'], res)
      );

      const provider = settings.provider || 'groq';
      const needsKey = provider === 'gemini' ? settings.geminiApiKey : settings.apiKey;

      if (!needsKey) {
        setStatus('⚠ No API key — open extension popup', 'err');
        return;
      }

      const autoSubmit = document.getElementById('ib-auto-submit')?.checked ?? false;
      const autoRun = document.getElementById('ib-auto-run')?.checked ?? false;

      setSolveBtn(true);
      setStatus('Extracting problem...', 'info');

      try {
        const problem = extractProblemDetails();
        const template = await extractCodeFromEditor();

        const providerLabel = provider === 'gemini' ? 'Gemini' : 'Groq';
        setStatus(`Calling ${providerLabel}...`, 'info');
        const code = await solveWithAI(problem, template, settings);

        setStatus('Writing code...', 'info');
        await typeCodeIntoEditor(code);

        if (autoSubmit) {
          setStatus('Submitting...', 'info');
          await sleep(500);
          clickSubmit();
          setStatus('✓ Submitted!', 'ok');
        } else if (autoRun) {
          setStatus('Running tests...', 'info');
          await sleep(500);
          clickRun();
          setStatus('✓ Running tests!', 'ok');
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