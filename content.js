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

  // ── Groq API ─────────────────────────────────────────────────────────────────

  async function solveWithAI(problemDetails, codeTemplate, apiKey, model, fallbackModel) {
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


    let res;
    let usedModel = model;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: usedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) throw new Error(`Primary model error ${res.status}`);
    } catch (err) {
      console.warn('Primary model failed, trying fallback model', err);
      usedModel = fallbackModel;
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: usedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Fallback model error ${res.status}: ${errText.slice(0, 200)}`);
      }
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from API');

    let parsed;
    try {
      // Strip markdown code fences if present
      let clean = content.replace(/```(?:json)?\n?/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      // Fallback: extract the code value with a regex
      const match = content.match(/"code"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/);
      if (match) {
        // Unescape JSON string escapes
        parsed = { code: match[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
      } else {
        throw new Error('Failed to parse AI response');
      }
    }

    if (!parsed.code) throw new Error('No "code" field in AI response');
    return parsed.code.trim();
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

    const fab = document.getElementById('ib-solver-fab');
    const panel = document.getElementById('ib-solver-panel');
    let isDragging = false;
    let hasDragged = false;
    let startX, startY, initialX, initialY;

    if (fab && panel) {
      fab.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
        
        let newX = initialX + dx;
        let newY = initialY + dy;
        
        const rect = panel.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - rect.height;
        
        newX = Math.max(0, Math.min(newX, maxLeft));
        newY = Math.max(0, Math.min(newY, maxTop));
        
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.left = `${newX}px`;
        panel.style.top = `${newY}px`;
      });

      document.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
      });

      const toggleCard = (forceClose = false) => {
        const card = document.getElementById('ib-solver-card');
        if (!card) return;
        
        const fabRectBefore = fab.getBoundingClientRect();
        
        if (forceClose) {
          card.classList.add('hidden');
        } else {
          card.classList.toggle('hidden');
        }
        
        setTimeout(() => {
          const fabRectAfter = fab.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          
          let newX = panelRect.left + (fabRectBefore.left - fabRectAfter.left);
          let newY = panelRect.top + (fabRectBefore.top - fabRectAfter.top);
          
          const maxLeft = window.innerWidth - panelRect.width;
          const maxTop = window.innerHeight - panelRect.height;
          
          newX = Math.max(0, Math.min(newX, maxLeft));
          newY = Math.max(0, Math.min(newY, maxTop));
          
          panel.style.left = `${newX}px`;
          panel.style.top = `${newY}px`;
        }, 0);
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
        chrome.storage.sync.get(['apiKey', 'model', 'fallbackModel', 'autoSubmit'], res)
      );

      if (!settings.apiKey) {
        setStatus('⚠ No API key — open extension popup', 'err');
        return;
      }

      const model = settings.model || 'openai/gpt-oss-120b';
      const fallbackModel = settings.fallbackModel || 'groq/compound';
      const autoSubmit = document.getElementById('ib-auto-submit')?.checked ?? false;

      setSolveBtn(true);
      setStatus('Extracting problem...', 'info');

      try {
        const problem = extractProblemDetails();
        const template = await extractCodeFromEditor();

        setStatus('Calling Groq...', 'info');
        const code = await solveWithAI(problem, template, settings.apiKey, model, fallbackModel);

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