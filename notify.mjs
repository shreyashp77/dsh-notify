/**
 * dsh-notify — agent finish notifier, node half.
 *
 * Pure UI plugin: the browser half (notify.client.js) watches the session
 * list's `running` flags and toasts whenever a session's agent transitions
 * running -> idle. No host-side behavior; the empty apply exists so the
 * plugin appears in the host cordis tree / Loader (mirrors dsh-pet).
 *
 * The browser half is shipped via exports["./client"], discovered from the
 * package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
function apply() {}
export { apply };
