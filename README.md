# dsh-notify

Permanent Cordis plugin for DeepSeek Harness: shows a toast notification in the
Web GUI whenever an agent's execution (a full turn) finishes — for any session,
not just the one you're looking at.

## Files

| File | Purpose |
| --- | --- |
| `notify.mjs` | Host half. Pure surface plugin (empty `apply`) so the entry appears in the host Cordis tree, mirroring `dsh-pet`. |
| `notify.client.js` | Browser half (lazy-CJS client module). Detects the running → idle transition from the global `useSessions` selector hook provided on the root-scoped `shell.overlay` slot, and renders an auto-dismissing toast stack in the bottom-right corner. |
| `package.json` | Package manifest with the `dsh.client` declaration (platform `web`, injects `@deepseek-ai/dsh-cordis-client-runner`). |

## How detection works

The session list state (`SessionListState`) carries a live `running: boolean`
per session (`SessionSummary`), updated whenever an agent's running state
changes. The client half selects the sorted set of running session ids and
fires a toast for every id that leaves the set (running → idle). No host
communication is needed — the permanent client half has no `host.call` bridge,
so the whole feature is driven from the client snapshot.

Toasts (in-page, visible while the GUI tab is in the foreground):

- title: `Agent finished`
- message: `Execution completed in <cwd basename>`
- auto-dismiss after 5 s (`TOAST_LIFE_MS`), dismissible via the × button
- at most 4 visible at once (`MAX_TOASTS`), oldest dropped first

Background-tab notifications (the in-page toast is invisible while the GUI
tab is not in the foreground, so every finish is additionally announced):

- **OS-level notification** — a Web Notification ("Agent finished /
  Execution completed in \<cwd\>") that surfaces over whichever tab or window
  you're looking at. Clicking it focuses the GUI. Requires notification
  permission: the plugin calls `Notification.requestPermission()` on load and
  on your first click (allow the browser prompt). If the prompt is missed,
  grant it via the site-settings (🔒) icon in the address bar.
- **Chime** — a short two-tone WebAudio beep, best effort.
- **Tab-title flash** — the tab title becomes "✓ Agent finished" for
  `TITLE_FLASH_MS` (default 6 s) as a fallback when notifications are denied
  or unavailable, and when another *window* (not another tab) has focus.
  The tab strip stays visible even while the tab itself is hidden, so this
  works in both cases.

## Installation

1. Copy this directory into your web profile directory, keeping a
   subdirectory per plugin (the profile-relative path is what the patch row
   references):

   ```sh
   cp -r . ~/.dsh/profiles/web/notify
   ```

2. Register the entry in the profile's `cordis.patch.yml` (append to the
   `insert` list):

   ```yaml
   - insert:
       - id: dsh-notify
         name: './notify/notify.mjs'
   ```

3. On a web profile with `dsh.profile.patchReload: live`, the reload is
   transactional and the new client bundle is picked up through the
   `/plugins/events` HMR channel; otherwise restart `dsh web`.

## Customization

Edit `notify.client.js`:

- `TOAST_LIFE_MS` — auto-dismiss delay (default `5000`)
- `MAX_TOASTS` — max concurrent toasts (default `4`)
- `TITLE_FLASH_MS` — how long the "✓ Agent finished" tab-title flash lasts (default `6000`)
- `playChime()` / `announceFinished()` — the background-tab chime + notification behavior
- `sessionLabel()` — what the message shows for the finished session
- the `CSS` block — toast styling (colors use raw values; adapt to your theme)
