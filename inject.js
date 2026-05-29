// ─── IB Solver Page-Context Bridge ─────────────────────────────────────────
// Runs in the MAIN world (page context) via manifest "world": "MAIN".
// Has direct access to window.monaco. Communicates with content.js via CustomEvents.

(function () {
  'use strict';

  // ── Find the Monaco text model (works on ALL Monaco versions) ──────────────
  function getModel() {
    try {
      const m = window.monaco;
      if (!m || !m.editor) return null;

      // getModels() exists on every Monaco version
      if (typeof m.editor.getModels === 'function') {
        const models = m.editor.getModels();
        if (models && models.length > 0) return models[0];
      }
    } catch {}
    return null;
  }

  // ── Write code into the Monaco editor ──────────────────────────────────────
  window.addEventListener('ib-solver-set-code', (e) => {
    const code = e.detail;
    try {
      const model = getModel();
      if (model) {
        model.setValue(code);
        window.dispatchEvent(new CustomEvent('ib-solver-set-code-done', {
          detail: { ok: true },
        }));
        return;
      }

      window.dispatchEvent(new CustomEvent('ib-solver-set-code-done', {
        detail: { ok: false, error: 'No Monaco model found' },
      }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ib-solver-set-code-done', {
        detail: { ok: false, error: err.message },
      }));
    }
  });

  // ── Read code from the Monaco editor ───────────────────────────────────────
  window.addEventListener('ib-solver-get-code', () => {
    let code = '';
    try {
      const model = getModel();
      if (model) code = model.getValue();
    } catch (err) {
      console.error('[IB Solver inject]', err);
    }
    window.dispatchEvent(new CustomEvent('ib-solver-code-result', { detail: code }));
  });
})();
