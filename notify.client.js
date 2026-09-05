/**
 * dsh-notify — agent finish notifier, browser half.
 *
 * Module loading follows the DSH lazy-CJS client model (mirrors the shipped
 * dsh-pet plugin): this bundle's top level only REGISTERS a factory with
 * `window.__ModuleLoader__`; the factory body (CommonJS-style, `require`
 * walks the client module graph) runs at materialization and owns every side
 * effect. `require('react')` resolves React through the module graph.
 *
 * "Agent finished execution" is detected entirely on the client: the
 * root-scoped `shell.overlay` slot provides the global `useSessions`
 * selector hook over the session list state. This plugin selects the sorted
 * set of `running` session ids; whenever a session id LEAVES that set
 * (running -> idle) a toast is pushed. Toasts auto-dismiss after
 * TOAST_LIFE_MS and are capped at MAX_TOASTS (oldest dropped first).
 */
window.__ModuleLoader__.load({
  id: 'dsh-notify',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');

    const TOAST_LIFE_MS = 5000;
    const MAX_TOASTS = 4;

    const CSS = `
      .dn-toast-stack { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 10000; pointer-events: none; }
      .dn-toast { pointer-events: auto; position: relative; min-width: 240px; max-width: 340px; padding: 10px 30px 10px 12px; border-radius: 8px; background: rgba(24, 26, 32, 0.92); color: #e5e7eb; box-shadow: 0 4px 16px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); font-size: 13px; font-family: ui-sans-serif, system-ui, sans-serif; animation: dn-in 160ms ease-out; }
      .dn-toast-title { font-weight: 600; margin-bottom: 2px; color: #6ea8fe; }
      .dn-toast-msg { opacity: 0.85; word-break: break-word; }
      .dn-toast-x { position: absolute; top: 4px; right: 6px; background: none; border: none; color: inherit; opacity: 0.6; cursor: pointer; font-size: 15px; padding: 2px 5px; }
      .dn-toast-x:hover { opacity: 1; }
      @keyframes dn-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    `;

    let styleEl = null;
    function ensureStyles() {
      if (styleEl !== null && document.head.contains(styleEl)) return;
      if (styleEl !== null) styleEl.remove();
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-plugin', 'dsh-notify');
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }

    /** Short label for a finished session: cwd basename, else a generic name. */
    function sessionLabel(cwd) {
      if (typeof cwd !== 'string') return 'agent';
      const base = cwd.split('/').filter(Boolean).pop();
      return base || 'agent';
    }

    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) {
        console.error('[dsh-notify] slots service not available');
        return;
      }
      ensureStyles();

      /* Per-materialization state: previous running set (null = not primed). */
      let prevRunning = null;

      function Toast(props) {
        React.useEffect(() => {
          const d = ctx.timeout(props.onDismiss, TOAST_LIFE_MS);
          return () => d();
        }, []);
        return React.createElement('div', { className: 'dn-toast' },
          React.createElement('div', { className: 'dn-toast-title' }, props.title),
          React.createElement('div', { className: 'dn-toast-msg' }, props.message),
          React.createElement('button', { className: 'dn-toast-x', onClick: props.onDismiss, 'aria-label': 'Dismiss' }, '\u00d7'),
        );
      }

      function ToastStack(props) {
        const [toasts, setToasts] = React.useState([]);
        const [running, setRunning] = React.useState(null);
        const useSessions = props && props.useSessions;

        // The renderer always materializes the root-scope standard props for
        // shell.overlay, so this conditional mirrors the shipped dsh-lofi
        // CommandWatcher idiom (stable hook order in practice).
        if (typeof useSessions === 'function') {
          const sel = useSessions(
            (state) => {
              const ids = [];
              const meta = {};
              const byId = state.byId;
              for (const id of state.ids) {
                const s = byId[id];
                if (s && s.running) {
                  ids.push(id);
                  meta[id] = typeof s.cwd === 'string' ? s.cwd : '';
                }
              }
              ids.sort();
              return { ids, meta };
            },
            (a, b) => a.ids.length === b.ids.length && a.ids.every((v, i) => v === b[i])
          );
          React.useEffect(() => { setRunning(sel); }, [sel]);
        }

        React.useEffect(() => {
          if (running === null) return; // not primed yet
          const current = new Set(running.ids);
          if (prevRunning === null) {
            prevRunning = current; // first observation: no toasts
            return;
          }
          const finished = [];
          prevRunning.forEach((id) => {
            if (!current.has(id)) finished.push(id);
          });
          prevRunning = current;
          if (finished.length === 0) return;
          const now = Date.now();
          const fresh = finished.map((id, i) => ({
            id: 'dn-' + now + '-' + i,
            title: 'Agent finished',
            message: 'Execution completed in ' + sessionLabel(running.meta[id]),
          }));
          setToasts((prev) => prev.concat(fresh).slice(-MAX_TOASTS));
        }, [running]);

        const dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

        if (toasts.length === 0) return null;
        return React.createElement('div', { className: 'dn-toast-stack' },
          toasts.map((t) => React.createElement(Toast, {
            key: t.id,
            title: t.title,
            message: t.message,
            onDismiss: () => dismiss(t.id),
          })),
        );
      }

      // Additive seat beside the shipped shell.overlay entries (dsh-pet, lofi):
      // a fresh id is added instead of replacing an occupant.
      slots.inject('shell.overlay', () => {
        slots.register(
          { name: 'shell.overlay', id: 'dsh-notify.toasts', order: 5, label: 'Agent finished' },
          () => React.createElement(ToastStack, null)
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['timer'];
    return module.exports;
  }
});
