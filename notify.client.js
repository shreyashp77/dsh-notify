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

    console.info('[dsh-notify] browser half materialized');

    const TOAST_LIFE_MS = 5000;
    const MAX_TOASTS = 4;
    const TITLE_FLASH_MS = 6000;

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
      console.info('[dsh-notify] apply() ran; slots ok; notification.permission =',
        typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

      // Notification permission: try on load, and again on the first user
      // interaction (some browsers require activation to show the prompt).
      ensureNotifyPermission();
      window.addEventListener('pointerdown', ensureNotifyPermission, { once: true, capture: true });


      /* Per-materialization state: previous running set (null = not primed). */
      let prevRunning = null;
      /* Last known cwd per session, so sessions that already LEFT the running
       * set can still be labeled in toasts/notifications. */
      const metaHistory = {};

      /*
       * Background-tab awareness. The in-page toast lives in this page's DOM,
       * so it is invisible while the GUI tab is not in the foreground — exactly
       * when the user needs the cue. On every finish we therefore additionally:
       *   - fire an OS-level Web Notification (surfaces over any tab/window;
       *     permission requested on load and on first click, best effort),
       *   - flash the tab title (still visible in the tab strip while hidden),
       *   - play a short chime (WebAudio, best effort).
       */
      let audioCtx = null;
      function playChime() {
        try {
          audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
          if (audioCtx.state === 'suspended') audioCtx.resume();
          const t = audioCtx.currentTime;
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, t);
          osc.frequency.setValueAtTime(1174.66, t + 0.12);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + 0.5);
        } catch (e) { /* audio unavailable: best effort only */ }
      }

      function ensureNotifyPermission() {
        if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
        try { Notification.requestPermission(); } catch (e) { /* ignore */ }
      }

      function systemNotify(body) {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
        try {
          const n = new Notification('Agent finished', { body: body, tag: 'dsh-notify' });
          n.onclick = function () { window.focus(); n.close(); };
          return true;
        } catch (e) { return false; }
      }

      let titleCancel = null;
      function flashTitle() {
        if (titleCancel !== null) return; // already flashing
        const original = document.title;
        document.title = '\u2713 Agent finished';
        titleCancel = ctx.timeout(() => {
          document.title = original;
          titleCancel = null;
        }, TITLE_FLASH_MS);
      }

      /** Cross-surface announcement for finished sessions (labels = cwd basenames). */
      function announceFinished(labels) {
        const where = labels.filter(Boolean).join(', ');
        const body = 'Execution completed' + (where ? ' in ' + where : '');
        if (!document.hidden) {
          if (!document.hasFocus()) flashTitle(); // other window focused: cue in tab strip
          return;
        }
        const shown = systemNotify(body);
        playChime();
        if (!shown) flashTitle(); // tab-strip cue when notifications unavailable
      }

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
          for (const id of running.ids) {
            if (running.meta[id]) metaHistory[id] = running.meta[id];
          }
          const current = new Set(running.ids);
          if (prevRunning === null) {
            prevRunning = current; // first observation: no toasts
            console.info('[dsh-notify] primed; running sessions =', current.size);
            return;
          }
          const finished = [];
          prevRunning.forEach((id) => {
            if (!current.has(id)) finished.push(id);
          });
          prevRunning = current;
          if (finished.length === 0) return;
          console.info('[dsh-notify] finish detected for', finished,
            'document.hidden =', document.hidden, 'hasFocus =', document.hasFocus());
          const now = Date.now();
          const fresh = finished.map((id, i) => ({
            id: 'dn-' + now + '-' + i,
            title: 'Agent finished',
            message: 'Execution completed in ' + sessionLabel(metaHistory[id]),
          }));
          setToasts((prev) => prev.concat(fresh).slice(-MAX_TOASTS));
          announceFinished(finished.map((id) => sessionLabel(metaHistory[id])));
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
      // a fresh id is added instead of replacing an occupant. The registered
      // component IS a React function component: the renderer calls it with
      // the root-scope standard kit (which carries `useSessions`), so the
      // props MUST be forwarded — discarding them strands the detection hook.
      slots.inject('shell.overlay', () => {
        slots.register(
          { name: 'shell.overlay', id: 'dsh-notify.toasts', order: 5, label: 'Agent finished' },
          (props) => React.createElement(ToastStack, props)
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['timer'];
    return module.exports;
  }
});
