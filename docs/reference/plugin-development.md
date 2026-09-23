# Writing an Orca plugin

Everything below is verified against this repository's source; each claim cites
`file:line`. The whole plugin surface is **experimental** — no compatibility
promises until `pluginApi` v1 freezes
([`plugin-manifest.ts:49`](../../src/shared/plugins/plugin-manifest.ts),
[`plugin-host-api.ts:16`](../../src/shared/plugins/plugin-host-api.ts)).

A plugin is a folder with an `orca-plugin.json` at its root
([`plugin-manifest.ts:182`](../../src/shared/plugins/plugin-manifest.ts)). It can
contain two kinds of code, and they are very different places to be:

| | **Panel** | **Worker** |
| --- | --- | --- |
| Runtime | Sandboxed iframe, opaque origin, `sandbox="allow-scripts"` only ([`PluginPanel.tsx:273-276`](../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)) | `child_process.fork` of the Electron binary as plain Node ([`plugin-host-process.ts:78-93`](../../src/main/plugins/plugin-host-process.ts)) |
| Host API reach | 5 of the 13 methods ([`plugin-host-api.ts:273-275`](../../src/shared/plugins/plugin-host-api.ts)) | all 13 |
| Network | CSP `default-src 'none'; connect-src 'none'` ([`plugin-panel-shell.ts:25-27`](../../src/shared/plugins/plugin-panel-shell.ts)) | only hosts declared under `net:fetch` ([`plugin-host-preload.ts:66-78`](../../src/main/plugins/plugin-host-preload.ts)) |
| Filesystem | none | read-only, own folder ([`plugin-worker-sandbox-args.ts:11-19`](../../src/main/plugins/plugin-worker-sandbox-args.ts)) |
| Lifetime | while its surface is mounted | lazy: forked on the first command or subscribed event, reaped after 5 min idle ([`plugin-host-protocol.ts:110-112`](../../src/shared/plugins/plugin-host-protocol.ts)) |

Two worked examples ship in this repo:
[`examples/plugins/hello-orca`](../../examples/plugins/hello-orca) (minimal) and
[`examples/plugins/worklog`](../../examples/plugins/worklog) (a template that
exercises everything on this page). Copy the second one.

## Getting it running

The plugin system is off by default: `pluginSystemEnabled`
([`global-settings-types.ts:328`](../../src/shared/global-settings-types.ts),
default `false` at [`constants.ts:329`](../../src/shared/constants.ts)). Turn it
on in **Settings → Plugins**, then install by folder or by Git URL
([`plugin-install-source.ts:11-39`](../../src/renderer/src/components/settings/plugin-install-source.ts)
parses `https://…#ref`; the `#ref` is mandatory).

While developing, add the folder to **Development** instead. That list is
`devPluginPaths` ([`global-settings-types.ts:338`](../../src/shared/global-settings-types.ts),
read at [`index.ts:2944`](../../src/main/index.ts)); the plugin loads straight
from the directory, and a dev path **shadows** an installed plugin with the same
identity ([`plugin-discovery.ts:238-251`](../../src/main/plugins/plugin-discovery.ts)).
Editing a panel's HTML reloads the frame without reinstalling.

## The manifest

`orca-plugin.json` is parsed by `pluginManifestSchema`
([`plugin-manifest.ts:104-169`](../../src/shared/plugins/plugin-manifest.ts)).
`contributes` is `.strict()` (line 153): an undeclared key fails the whole
manifest, which is also why a field cannot be "added later" by a plugin.

### Identity and gating

| Field | Rule |
| --- | --- |
| `manifestVersion` | literal `1` ([`:106`](../../src/shared/plugins/plugin-manifest.ts)) |
| `pluginApi` | literal `1` — the host-API major you target ([`:122`](../../src/shared/plugins/plugin-manifest.ts)) |
| `id`, `publisher` | kebab-case `[a-z0-9]+(-[a-z0-9]+)*`, ≤ 64 chars, not `__proto__`/`prototype`/`constructor` ([`plugin-manifest-fields.ts:4-20`](../../src/shared/plugins/plugin-manifest-fields.ts)) |
| identity | `<publisher>.<id>` — also the install directory name ([`plugin-manifest.ts:185-187`](../../src/shared/plugins/plugin-manifest.ts)) |
| `version` | semver ([`:54`, `:112`](../../src/shared/plugins/plugin-manifest.ts)) |
| `engines.orca` | only the `>=x.y.z` form ([`:60-63`](../../src/shared/plugins/plugin-manifest.ts)); below it the host refuses to load the plugin at discovery ([`plugin-discovery.ts:110-117`](../../src/main/plugins/plugin-discovery.ts)) |
| `main` | relative path to the worker entry; optional ([`:124`](../../src/shared/plugins/plugin-manifest.ts)) |
| `description`, `author`, `repository`, `icon` | optional ([`:113-118`](../../src/shared/plugins/plugin-manifest.ts)) |

Every path in a manifest is a *portable relative path inside the plugin folder*
([`plugin-manifest-fields.ts:24-28`](../../src/shared/plugins/plugin-manifest-fields.ts)),
and realpath containment separately rejects symlink escapes when the file is
read. Write `icons/logo.svg`, never `./icons\logo.svg` or an absolute path —
both separators are accepted on import ([`plugin-host-runtime.ts:82`](../../src/main/plugins/plugin-host-runtime.ts)),
but the manifest is compared as text.

**Reserved identities.** A `publisher` of `ab2web`, *or any `id` starting with
`orca-`*, is reserved ([`plugin-marketplace.ts:157-164`](../../src/shared/plugins/plugin-marketplace.ts)).
Such a plugin cannot be installed from a local path at all and must resolve to
the `ab2webco` organisation over Git
([`plugin-install-trust.ts:11-30`](../../src/main/plugins/plugin-install-trust.ts)).
Pick something else.

### What `contributes` accepts

| Key | Limit | Notes |
| --- | --- | --- |
| `panels` | 64 ([`:55`](../../src/shared/plugins/plugin-manifest.ts)) | `id`, `title`, `entry`, optional `icon`, `surface` |
| `commands` | 256 ([`:56`](../../src/shared/plugins/plugin-manifest.ts)) | `id`, `title`, optional `context` (`global`\|`worktree`) and `action` |
| `events` | 3 — the whole closed set ([`:91-96`](../../src/shared/plugins/plugin-manifest.ts)) | `worktree.created`, `worktree.removed`, `agent.status.changed` |
| `settings` | 32 ([`plugin-settings-contribution.ts:15`](../../src/shared/plugins/plugin-settings-contribution.ts)) | declarative form, rendered by Orca |
| `automations` | 16 ([`plugin-automation-contribution.ts:32`](../../src/shared/plugins/plugin-automation-contribution.ts)) | scheduled work |
| `keybindings` | 256 ([`plugin-content-pack-contributions.ts:10`](../../src/shared/plugins/plugin-content-pack-contributions.ts)) | must name a contributed command, and match its context ([`plugin-manifest-contribution-validation.ts:99-117`](../../src/shared/plugins/plugin-manifest-contribution-validation.ts)) |
| `languagePacks` | 16 ([`:9`](../../src/shared/plugins/plugin-content-pack-contributions.ts)) | one per locale |
| `vmRecipes` | 64 ([`:11`](../../src/shared/plugins/plugin-content-pack-contributions.ts)) | |
| `agents` | 64 ([`:12`](../../src/shared/plugins/plugin-content-pack-contributions.ts)) | agent profiles |
| `skills` | 32 ([`:15`](../../src/shared/plugins/plugin-content-pack-contributions.ts)) | a directory holding a `SKILL.md`, served to **any** agent in **any** workspace |
| `capabilities` | 32 ([`plugin-manifest.ts:166`](../../src/shared/plugins/plugin-manifest.ts)) | see below |

Cross-field rules that reject a manifest outright
([`plugin-manifest-contribution-validation.ts:119-168`](../../src/shared/plugins/plugin-manifest-contribution-validation.ts),
[`plugin-settings-contribution.ts:116-142`](../../src/shared/plugins/plugin-settings-contribution.ts)):

- `main` is required when any command has no built-in `action`, when
  `contributes.events` is non-empty, or when `process:spawn` is declared.
- `contributes.events` requires the `events:subscribe` capability.
- `contributes.skills` requires `skills:contribute`.
- `contributes.settings` requires `settings:own`; a `secret` setting also
  requires `secrets`.
- Duplicate panel/command/automation ids, duplicate locales, duplicate
  vmRecipe/agent/skill paths, and duplicate keybindings are all rejected.

Declared files are also size-capped at install and discovery
([`plugin-artifact-validation.ts:15-24`](../../src/main/plugins/plugin-artifact-validation.ts)):
panel entry 10 MB, worker entry 50 MB, plugin icon 2 MB, language pack 5 MB,
VM recipe 256 KB, agent profile 1 MB, `SKILL.md` 256 KB.

## Capabilities and consent

Ten capability kinds exist, and only these
([`plugin-capabilities.ts:14-25`](../../src/shared/plugins/plugin-capabilities.ts)).
A typo fails manifest validation rather than silently granting nothing.

| Kind | Unlocks | Shown to the user as ([`:90-107`](../../src/shared/plugins/plugin-capabilities.ts)) |
| --- | --- | --- |
| `workspace:read` | `workspace.readContext` | "Read the name, branch, and terminal list of your focused worktree" |
| `terminal:send` | `terminal.sendText` | "Type text into a terminal you can see (always a specific terminal)" |
| `notifications:show` | `notifications.show` | "Show desktop notifications labeled with the plugin name" |
| `storage` | `storage.get/set/delete/keys` | "Store data in the plugin's own storage folder" |
| `secrets` | `secrets.get/set/delete` | "Store and read secrets in the plugin's own encrypted vault" |
| `settings:own` | `settings.get/set` | "Read and change the plugin's own settings" |
| `events:subscribe` | `events.subscribe` and `contributes.events` | "Get notified when worktrees are created or removed and when agent status changes" |
| `net:fetch` | `fetch` in the worker, to the declared hosts only | "Connect to these network hosts: …" |
| `process:spawn` | `--allow-child-process` on the worker | "Start programs as you. Programs it starts are not constrained by this plugin worker's file or network permissions." |
| `skills:contribute` | `contributes.skills` | "Teach every agent, in every project, how to use this plugin…" |

`net:fetch` is the one scoped kind: it takes `hosts`, 1–64 entries, each a
hostname or a `*.example.com` wildcard
([`plugin-capabilities.ts:58-79`](../../src/shared/plugins/plugin-capabilities.ts)).

Enforcement is deny-by-default and happens at every plugin-callable boundary
([`plugin-capability-gate.ts:34-63`](../../src/shared/plugins/plugin-capability-gate.ts)).
A disabled plugin, an unknown one, and one with stale consent all fail
identically (`consent_required`) so plugin code cannot probe the difference.

### The consent fingerprint, and why updates re-prompt

Consent is recorded as `<publisher>.<id> → fingerprint`
([`plugin-consent-state.ts:12-27`](../../src/shared/plugins/plugin-consent-state.ts)).
The plugin is `approved` only while the recorded fingerprint equals the current
one; otherwise it is `pending`. `needsReconsent` distinguishes "never approved"
from "approved, then changed" ([`:31-38`](../../src/shared/plugins/plugin-consent-state.ts)).

The fingerprint is a SHA-256 over three parts
([`plugin-consent-fingerprint.ts:36-57`](../../src/shared/plugins/plugin-consent-fingerprint.ts)):

1. the canonicalised capability set — order- and duplicate-insensitive, so
   reformatting the manifest does not invalidate consent
   ([`plugin-capabilities.ts:122-143`](../../src/shared/plugins/plugin-capabilities.ts));
2. whether `main` exists at all — adding a worker to a panel-only plugin crosses
   a trust boundary even with an unchanged capability list;
3. **the installed tree's content hash**, but only when the manifest carries
   *instructional* contributions: `keybindings`, `vmRecipes`, `agents`,
   `automations`, or `skills`
   ([`plugin-consent-fingerprint.ts:14-29`](../../src/shared/plugins/plugin-consent-fingerprint.ts)).

Part 3 is the one that surprises people. Those bytes are executed later under
the user's (or an agent's) authority, so approval is bound to the exact tree.
**Any** update to such a plugin — a typo fix in the README included — produces a
new content hash, a new fingerprint, and a fresh consent prompt; the panel
surface switches to `pending-update` until the user approves
([`plugin-panels.ts:30-37`](../../src/renderer/src/store/plugin-panels.ts)). A
plugin with none of those five contributions keeps its consent across an update
that does not change capabilities or add `main`.

For a dev-path plugin the identity is a live hash of the folder
([`plugin-discovery.ts:131-137`](../../src/main/plugins/plugin-discovery.ts)), so
editing any file in a plugin that declares an automation sends it back to
`pending`. Budget for that while developing.

## Panels

A panel contributes `{ id, title, entry, icon?, surface? }`
([`plugin-manifest.ts:65-79`](../../src/shared/plugins/plugin-manifest.ts)).
`surface` picks where it lands:

- `worktree` (default) — the per-worktree right sidebar.
- `settings` — its own page on the plugin's card in Settings. The frame grows to
  the height the panel reports, so the Settings page scrolls as one page; do not
  put a scroller inside the panel. Its width is whatever the Settings column has
  left after the app's fixed settings sidebar: roughly 830px in a maximised
  window, ~415px at a 768px window, and **under 100px** below about 700px, where
  the Settings page itself stops being usable. Give the panel `min-width: 0`,
  `overflow-wrap: anywhere` and a single-column fallback, or it will overflow a
  box it never chose.
- `nav` — a first-level destination in the left sidebar, for global content.

`icon` is either a name from a curated set of 32 lucide icons
([`plugin-panel-icon.tsx:42-75`](../../src/renderer/src/components/right-sidebar/plugin-panel-icon.tsx);
`file-text` and `FileText` both resolve) or a relative `.svg` in your folder that
the host sanitises. Anything unrecognised falls back to the plug icon
([`:101-112`](../../src/renderer/src/components/right-sidebar/plugin-panel-icon.tsx)).

### What the host puts around your HTML

Your document is *appended to* a host-generated shell, so the shell's `<head>`
parses first ([`plugin-panel-shell.ts:88-200`](../../src/shared/plugins/plugin-panel-shell.ts)).
You get, without opting in:

- **A CSP you cannot loosen** — `default-src 'none'; connect-src 'none';
  script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;
  font-src data:; base-uri 'none'; form-action 'none'`
  ([`:25-27`](../../src/shared/plugins/plugin-panel-shell.ts)). No network, no
  external scripts, no external images. A second CSP meta of your own can only
  tighten it.
- **The app typeface.** Geist is embedded as a `data:` woff2 `@font-face`, and
  `body` gets `font-family: var(--font-sans)`, `font-size: 14px`,
  `line-height: 1.5`, `letter-spacing: 0.01em`
  ([`:75-86`](../../src/shared/plugins/plugin-panel-shell.ts)). Declaring your
  own `font-family` opts out of it.
- **A radius scale** derived from `--radius`: `--radius-sm` (0.6×) through
  `--radius-4xl` (2.6×), plus `box-sizing: border-box` on everything
  ([`:78-82`](../../src/shared/plugins/plugin-panel-shell.ts)).
- **A theme class on `<html>`**: literally `light` or `dark`, filled in by the
  renderer from the live document ([`:101`](../../src/shared/plugins/plugin-panel-shell.ts),
  [`plugin-panel-design-token-css.ts:21-23`](../../src/renderer/src/components/right-sidebar/plugin-panel-design-token-css.ts)).
  Changing the app theme rebuilds the frame with new token values
  ([`PluginPanel.tsx:83-86`](../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)),
  so you normally never need the class — the tokens already changed.
- **A liveness responder and a content-height reporter**, both inside the shell
  because the host cannot read into an opaque-origin frame
  ([`:99-197`](../../src/shared/plugins/plugin-panel-shell.ts)).

You do **not** get Tailwind, `main.css`, any bundled asset, or the app DOM. The
shell deliberately leaves `input`, `button` and `select` unstyled so existing
panels keep the look they shipped with — matching the app is your CSS's job, and
your CSS always wins because it parses later in the same document.

### The design tokens you actually receive

Exactly these 22, snapshotted from the live document and injected as custom
properties on `:root`
([`plugin-panel-shell.ts:39-62`](../../src/shared/plugins/plugin-panel-shell.ts);
injection at [`plugin-panel-design-token-css.ts:9-19`](../../src/renderer/src/components/right-sidebar/plugin-panel-design-token-css.ts)):

```
--background      --foreground
--card            --card-foreground
--popover         --popover-foreground
--primary         --primary-foreground
--secondary       --secondary-foreground
--muted           --muted-foreground
--accent          --accent-foreground
--destructive     --destructive-foreground
--border          --input            --ring
--radius          --font-sans        --font-mono
```

That is a curated subset of `main.css`, not all of it: freezing every token as
public API would lock future refactors. The list grows additively; renaming or
dropping an entry is a breaking change for installed plugins.

Everything visual must come from these or be computed from them
(`calc(var(--radius) * …)`, `color-mix(…)`). A literal colour will be wrong in
one of the two themes. Values are stripped of `{}<>;` before injection, so
nothing a token contains can break out of the `<style>` block.

### Talking to the host: the postMessage bridge

The panel posts to `window.parent` with `targetOrigin: '*'` — the frame's origin
is opaque, so anything stricter is silently dropped; the host identifies the
*sending window* instead of trusting an origin
([`plugin-panel-bridge-host.ts:76-90`](../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts)).

Request: `{ type: 'orca-panel-action', requestId, action, params }`.
Reply: `{ type: 'orca-panel-action-result', requestId, ok, value?, errorCode?, error? }`
([`plugin-panel-bridge.ts:15-19, 58-98`](../../src/shared/plugins/plugin-panel-bridge.ts)).
`requestId` is yours, 1–128 chars.

Only five methods are panel-callable — the set is derived from the host API
table so it can never drift from the gate
([`plugin-host-api.ts:273-275`](../../src/shared/plugins/plugin-host-api.ts)):

`workspace.readContext`, `terminal.sendText`, `notifications.show`,
`storage.get`, `storage.set`.

Notably **not** panel-callable: `storage.delete`, `storage.keys`, all of
`secrets.*`, all of `settings.*`, `events.subscribe`. A panel that needs a
declared setting has to have the worker mirror it into a storage key — that is
what `examples/plugins/worklog` does.

`errorCode` is one of `invalid_request`, `unknown_method`, `capability_denied`,
`consent_required`, `panel_forbidden`, `invalid_params`, `rate_limited`,
`unavailable`, `action_failed`
([`plugin-panel-bridge.ts:73-82`](../../src/shared/plugins/plugin-panel-bridge.ts)).

### The message budget — and the bug it causes

Per plugin, the bridge admits **30 messages per sliding 10 000 ms window**, and
caps a single message at **64 KiB**
([`plugin-panel-bridge.ts:23-24`](../../src/shared/plugins/plugin-panel-bridge.ts);
enforcement at [`plugin-panel-message-budget.ts:19-45`](../../src/shared/plugins/plugin-panel-message-budget.ts)).
Oversized and malformed traffic still spends budget. Over the limit, the host
answers `ok: false, errorCode: 'rate_limited'`
([`plugin-panel-bridge-host.ts:115-140`](../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts)).

Two things eat into those 30 before you do:

- The watchdog pings every 10 s and your pong is charged to the data budget too
  ([`:107`](../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts),
  interval at [`plugin-panel-bridge.ts:36`](../../src/shared/plugins/plugin-panel-bridge.ts)).
  A pong has its own reserved 1 KiB lane so a saturated data budget can never
  make a live panel look dead ([`:31`](../../src/shared/plugins/plugin-panel-bridge.ts)),
  but the *count* still comes off the 30.
- Content-height reports, though the shell only sends one when the height
  actually changed ([`plugin-panel-shell.ts:166-171`](../../src/shared/plugins/plugin-panel-shell.ts)).

So the concrete failure: a panel that polls, say, six storage keys every two
seconds burns its window in ten seconds and stays saturated. The user clicks a
button, the click's `storage.set` comes back `rate_limited` — and if the panel
reads `result.value` without checking `result.ok`, that refusal is
indistinguishable from an empty answer. The click vanishes with no error and the
panel paints stale data over the write that never happened.

Do not poll. Call on explicit user actions, and always branch on `ok` before
touching `value`.

### Never return without saying why

This is the mistake everyone makes, and the reason it is hard to catch is that
the code looks defensive. Checking `ok` and returning is only half of it — the
other half is that the user's click is now gone and nothing on screen says so:

```js
// WRONG. Two silent returns: on a refusal the write never happens, the panel
// stays on "Saving…", and the user has no idea their click was dropped.
call('storage.get', { key: 'entries' }).then(function (read) {
  if (!read.ok) return
  call('storage.set', { key: 'entries', value: next }).then(function (write) {
    if (!write.ok) return
    setStatus('Saved.')
  })
})
```

```js
// RIGHT. Every refusal reaches the screen, a rate limit is retried past the
// 10s window because the work started as a click, and a reply that never
// arrives becomes a deadline instead of a frozen panel.
request('storage.get', { key: 'entries' })
  .then(function (read) {
    if (!read.ok) return fail(read)           // fail() paints read.reason
    return request('storage.set', { key: 'entries', value: next }).then(function (write) {
      if (!write.ok) return fail(write)
      input.value = ''                         // only after a confirmed write
      setStatus('Saved.')
    })
  })
  .catch(reportUnexpected)                     // a throw while rendering, too
```

Three rules behind that shape, all of them in
[`examples/plugins/worklog/panel.html`](../../examples/plugins/worklog/panel.html):

1. **One funnel for refusals.** Every `ok: false` goes through a single `fail()`
   that writes the reason into the status line. A bare `return` next to an
   `if (!ok)` is the bug.
2. **`rate_limited` is a brake, not a failure.** Work that started as a user
   action is worth retrying; anything less than the 10s window just spends
   another message and gets refused again, so back off past it and say that you
   are retrying.
3. **Put a deadline on every call.** The host answers every request it receives,
   but a reply addressed to a document or session it has already replaced is
   dropped — and a promise that never settles is a panel frozen on its last
   status line with no error anywhere. That failure is invisible in code review
   and invisible at runtime; only a timeout makes it speakable.

Do not clear the user's input, or paint a success state, before the write comes
back `ok`. Both tell them something happened that did not.

### Ship controls disabled until the script has wired them

The panel document is not long-lived. The host re-parses it from scratch every
time it rebuilds the frame — and it rebuilds whenever the baked theme snapshot
changes ([`use-plugin-panel-theme-revision.ts:9-32`](../../src/renderer/src/components/right-sidebar/use-plugin-panel-theme-revision.ts))
or the entry HTML is re-read ([`PluginPanel.tsx:174-213`](../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)).

Between the parser creating a `<button>` and the trailing `<script>` attaching
its listener there is a real window. It is invisible on a fast machine and wide
enough on a loaded one that a click lands on a control that does nothing: no
handler, no error, no status change — the panel simply ignores the user.

So give every control the state it actually has:

```html
<input id="entry" type="text" disabled />
<button id="add" type="button" disabled>Add entry</button>
```

```js
// last line of wiring, after every addEventListener
;['entry', 'add', 'refresh'].forEach(function (id) {
  document.getElementById(id).disabled = false
})
```

A dimmed control that becomes live is honest about a panel that is still
booting. An enabled control that silently drops the click is not.

The same fact has a second consequence: **nothing a panel keeps in its own
document survives a rebuild.** Scroll position, a half-typed form, a cached
list, a pending request — all of it goes when the frame is re-keyed, and the
panel gets no notice and no teardown hook. Anything that must outlive that
belongs in `storage.*`, which is why this page keeps saying so.

### One surface, several flows

A panel that writes its status line and its list from more than one place has to
decide which write wins. The flows do not finish in the order they started: a
`load()` waiting on two bridge replies can land *after* a click that began later
and already wrote the newer truth, and then it paints the older one back —
status cleared, the row the click just added gone, and no error anywhere.

Order of completion is not order of intent. Give the shared surface an owner:

```js
var surfaceOwner = 0
function claimSurface() { return ++surfaceOwner }
function ownsSurface(owner) { return owner === surfaceOwner }
```

Each flow claims it when it starts and checks before it writes, so a superseded
flow finishes quietly instead of reporting stale state.
`examples/plugins/worklog/panel.html` does this in `load()` and in every handler.

Two more panel bounds: a reported content height is clamped to
**48–8000 px** with **320 px** before the first report
([`plugin-panel-bridge.ts:54-56`](../../src/shared/plugins/plugin-panel-bridge.ts)),
and a panel that misses the pong deadline of **5 000 ms** is demoted to an
errored badge and suspended ([`:37`](../../src/shared/plugins/plugin-panel-bridge.ts)).

## Storage, secrets and settings

Three separate stores, all per plugin, all under
`<userData>/plugins-data/<publisher>.<id>/`
([`plugin-discovery.ts:71-73`](../../src/main/plugins/plugin-discovery.ts),
[`plugin-storage-store.ts:11-24`](../../src/main/plugins/plugin-storage-store.ts)) —
never a shared namespaced blob, so one plugin's key can never resolve into
another's.

| Store | File | Capability | Caps |
| --- | --- | --- | --- |
| `storage.*` | `storage.json` | `storage` | value ≤ 256 KiB, whole store ≤ 5 MiB, ≤ 1024 keys ([`plugin-host-api.ts:68-70`](../../src/shared/plugins/plugin-host-api.ts)) |
| `settings.*` | `settings.json` | `settings:own` | same key rules |
| `secrets.*` | encrypted vault | `secrets` | value ≤ 64 KiB ([`:83`](../../src/shared/plugins/plugin-host-api.ts)) |

Keys are 1–256 chars and `__proto__`/`prototype`/`constructor` are rejected
([`:60-65`](../../src/shared/plugins/plugin-host-api.ts)). Values are plain JSON;
a write that would exceed a cap comes back as an error, not a truncation
([`plugin-storage-store.ts:69-93`](../../src/main/plugins/plugin-storage-store.ts)).
A corrupt store file reads as empty rather than wedging the plugin.

### Declarative settings

`contributes.settings` names the keys and Orca renders the form; the values land
in the same stores `settings:own` and `secrets` already read, so no new host API
is involved ([`plugin-settings-contribution.ts:3-13`](../../src/shared/plugins/plugin-settings-contribution.ts)).

Each entry is `string`, `boolean` or `number`, with `key` (letter first, then
letters/digits/underscore, ≤ 64), `label`, optional `description`, `default`,
`required`; `string` adds `placeholder` and `secret`; `number` adds `min`/`max`
([`:17-62`](../../src/shared/plugins/plugin-settings-contribution.ts)). A
`secret: true` string is stored in the encrypted vault instead of
`settings.json`.

Two rules that reject the manifest ([`:82-97`](../../src/shared/plugins/plugin-settings-contribution.ts)):
a `required` setting cannot declare a `default` (the "needs setup" state it
exists to produce would be unreachable), and a `secret` cannot declare one
either. A required setting with no value puts the plugin in `needsSetup`
([`plugin-list-projection.ts:229-234`](../../src/main/plugins/plugin-list-projection.ts));
a blank string counts as unconfigured, not just an absent one
([`plugin-settings-contribution.ts:169-182`](../../src/shared/plugins/plugin-settings-contribution.ts)).

## The worker

`main` is imported as an ES module by file URL, and its **default export is the
activate function** ([`plugin-host-runtime.ts:82-90`](../../src/main/plugins/plugin-host-runtime.ts)).
An optional `deactivate` named export is awaited on shutdown. Activation is
awaited before the host marks the worker ready, and the ready deadline is
**10 s** ([`plugin-host-protocol.ts:108`](../../src/shared/plugins/plugin-host-protocol.ts)) —
keep it short.

```js
export default async function activate(orca) {
  orca.commands.register('my.command', async (args) => ({ ok: true }))
  orca.events.on('worktree.created', async (payload) => { /* … */ })
  const stored = await orca.host.call('storage.get', { key: 'state' })
  orca.log('activated')
}
export function deactivate() {}
```

The `orca` object is exactly four things
([`plugin-host-runtime.ts:20-36`](../../src/main/plugins/plugin-host-runtime.ts)):
`commands.register`, `events.on`, `host.call(method, params)`, and
`grantedCapabilities` (informational — the host re-gates every call regardless),
plus `log(message)`.

### What the worker cannot do

It runs under **Node's permission model**, with this fixed `execArgv` and never
Orca's own flags ([`plugin-worker-sandbox-args.ts:4-23`](../../src/main/plugins/plugin-worker-sandbox-args.ts)):

```
--preserve-symlinks --preserve-symlinks-main
--permission
--allow-fs-read=<plugin root>
--allow-fs-read=<host entry dir>
--require <plugin-host-preload>
[--allow-child-process]      ← only with process:spawn
```

Read that as a list of absences:

- **No filesystem writes. Anywhere.** There is no `--allow-fs-write`. Persist
  through `storage.*` / `secrets.*`.
- **No reading outside your own folder** — not `~/.config`, not the user's
  repos, not `~/.ssh`. Only your install tree and the host entry directory.
- **No child processes** without `process:spawn`.
- **No `process.env` from the user's shell.** The worker gets an allowlist of 19
  variables, plus `ELECTRON_RUN_AS_NODE=1`
  ([`plugin-worker-env.ts:8-56`](../../src/main/plugins/plugin-worker-env.ts)):
  `PATH`, `HOME`, `USERPROFILE`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`,
  `TEMP`, `TMP`, `ORCA_USER_DATA_PATH`, `XDG_CONFIG_HOME`, `SYSTEMROOT` (passed
  through as `SystemRoot`), `SYSTEMDRIVE`, `WINDIR`, `COMSPEC`, `PATHEXT`,
  `PROCESSOR_ARCHITECTURE`, `NUMBER_OF_PROCESSORS`. A token you exported in your
  shell is *not* visible to a plugin. On Windows the lookup folds case, because
  Windows env keys are case-insensitive and POSIX ones are not.
- **No network modules.** The preload throws on importing `net`, `http`,
  `https`, `http2`, `tls`, `dns`, `dns/promises`, `dgram`
  ([`plugin-host-preload.ts:3-29`](../../src/main/plugins/plugin-host-preload.ts)),
  deletes `WebSocket`, and replaces `fetch` with one that only reaches the hosts
  you declared under `net:fetch` — with `redirect: 'manual'`, so a redirect off
  an allowed host does not follow ([`:66-84`](../../src/main/plugins/plugin-host-preload.ts)).
- **No native escape hatches**: `process.binding`, `process._linkedBinding`,
  `process.getBuiltinModule` and `process.dlopen` are made permanently
  `undefined` ([`:95-100`](../../src/main/plugins/plugin-host-preload.ts)).
- **No Electron.** The entry is forked with `ELECTRON_RUN_AS_NODE`
  ([`plugin-host-entry.ts:1-6`](../../src/main/plugins/plugin-host-entry.ts)).

If `process:spawn` *is* granted, note the consent line says it plainly:
programs the plugin starts are **not** constrained by any of the above.

### Timeouts and supervision

| Bound | Value |
| --- | --- |
| Ready after activation | 10 s ([`plugin-host-protocol.ts:108`](../../src/shared/plugins/plugin-host-protocol.ts)) |
| A command invocation | 30 s ([`:109`](../../src/shared/plugins/plugin-host-protocol.ts)) |
| An event handler | 5 min, then the worker is killed ([`plugin-host-process.ts:23, 288-292`](../../src/main/plugins/plugin-host-process.ts)) |
| Unacknowledged events in flight | 64, then killed ([`:24, 281-285`](../../src/main/plugins/plugin-host-process.ts)) |
| Idle reap | 5 min with no in-flight work ([`plugin-host-protocol.ts:110-112`](../../src/shared/plugins/plugin-host-protocol.ts)) |
| Concurrent live workers | 5; further activations queue ([`:114`](../../src/shared/plugins/plugin-host-protocol.ts)) |
| Shutdown grace before SIGKILL | 2 s ([`plugin-host-process.ts:22`](../../src/main/plugins/plugin-host-process.ts)) |
| Crash restarts | 3, backing off 500 / 2000 / 5000 ms, then `errored` ([`plugin-supervisor.ts:31-34`](../../src/main/plugins/plugin-supervisor.ts)) |

The worker is **lazy**: nothing forks until a command is invoked or a subscribed
event arrives ([`plugin-worker-manager.ts:46`](../../src/main/plugins/plugin-worker-manager.ts),
[`plugin-event-delivery.ts:30-33`](../../src/main/plugins/plugin-event-delivery.ts)).
A manifest subscription is a durable activation trigger; a runtime
`events.subscribe` only reaches a worker that is already running and dies with
it ([`plugin-event-bus.ts:1-30`](../../src/main/plugins/plugin-event-bus.ts)).

### Event payloads

Bounded projections, validated before they reach any plugin
([`plugin-events.ts:11-39`](../../src/shared/plugins/plugin-events.ts)):

- `worktree.created` → `{ worktreeId, path, branch }`
- `worktree.removed` → `{ worktreeId, path }`
- `agent.status.changed` → `{ worktreeId | null, paneKey, state, receivedAt }`

## Automations

`contributes.automations` declares scheduled work that Orca creates for the user
when the plugin is enabled and removes when it is disabled or uninstalled
([`plugin-automation-contribution.ts:9-31`](../../src/shared/plugins/plugin-automation-contribution.ts)).
A plugin **cannot** create an automation through any API — it is declarative
like `panels`.

Each entry carries `id`, `title`, `trigger` (a cron expression with at least one
possible run), `timezone` (an IANA zone), optional `precheck` (shell, ≤ 1024
chars), and optional `workspace`; then **exactly one** of:

- `provider` + `prompt` — launches an agent; the prompt body lives in a file
  inside the plugin (≤ 128 KiB), never inline, so the reviewer reads the same
  bytes the content hash covers ([`:34-36, 64-70`](../../src/shared/plugins/plugin-automation-contribution.ts));
- `command` — a shell string, ≤ 1024 chars, that *is* the run: no agent, no
  terminal, no model ([`:43, 72-78`](../../src/shared/plugins/plugin-automation-contribution.ts)).

Both schemas are `.strict()`, hence a union rather than two optional fields.

What the host guarantees
([`plugin-automation-reconciliation.ts:24-47`](../../src/main/plugins/plugin-automation-reconciliation.ts)):

- They are **born disabled**. Turning on automatic work is the user's decision.
- They are born **with no project**, unless the declaration says
  `"workspace": "plugin-owned"` — which asks for a folder Orca creates *for the
  plugin*, outside every user project. It is a literal, not a path: a plugin can
  never name a directory or point at someone else's repo.
- Reconciliation runs on explicit lifecycle transitions (consent, enable,
  disable, uninstall), not on every discovery refresh, so a flickering dev
  folder does not delete the user's rows.
- On an existing row only the plugin-owned fields are refreshed (title, prompt,
  precheck command, provider, cron, timezone) and only if the user has not
  edited them. Project, workspace, mode, enabled, timeouts and missed-run grace
  are the user's and are never touched.

One thing to design around: an automation's command is **not** run inside the
worker sandbox. It is spawned with `shell: true`, the working directory of the
chosen workspace, and the full `process.env`
([`precheck-runner.ts:130-136`](../../src/main/automations/precheck-runner.ts)).
It also has no idea where your plugin is installed — the install path is a
content hash. Keep the command self-contained and relative to its working
directory, or ship a real entry point and have the user point at it.

Because an automation is instructional content, declaring one binds consent to
the content hash — see above. The consent dialog shows the trigger, the precheck
and the command verbatim ([`plugin-automation-contribution.ts:110-131`](../../src/shared/plugins/plugin-automation-contribution.ts)).

## Lifecycle: which state shows what

The wire status is one of `running`, `restarting`, `idle`, `pending`,
`disabled`, `errored`, `invalid`
([`plugin-list-projection.ts:36-66`](../../src/main/plugins/plugin-list-projection.ts)),
derived in that precedence order: disabled → pending → errored → restarting →
running/idle ([`:199-210`](../../src/main/plugins/plugin-list-projection.ts)).

- `invalid` — the manifest is missing, unparseable, fails validation, declares a
  missing artifact, or requires a newer Orca.
- `pending` — installed but awaiting consent, or awaiting *re*-consent.
- `idle` — enabled, no worker running. This is the normal resting state.
- `errored` — crashed past the restart budget, or failed to activate.

**Only `running`, `restarting` and `idle` mount a panel's document**
([`plugin-panels.ts:19-21`](../../src/renderer/src/store/plugin-panels.ts)).
A `pending` plugin keeps its *surface* — the sidebar entry, the Settings page —
but renders an approval notice instead of your HTML
([`plugin-panels.ts:26-28`](../../src/renderer/src/store/plugin-panels.ts),
[`PluginPanel.tsx:156-161, 235-237`](../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)).
That is deliberate: without it the panel would silently vanish on every update
and the user would have nowhere to learn why. `errored` and `disabled` mount
nothing.

If your panel is blank after an update, check the status before debugging your
HTML — the host never asked for it.

## Publishing

### Install layout

Installs are immutable and hash-addressed, behind an atomic pointer swap
([`plugin-discovery.ts:26-36`](../../src/main/plugins/plugin-discovery.ts)):

```
<userData>/plugins/<publisher>.<id>/current    ← text file naming the hash
<userData>/plugins/<publisher>.<id>/<hash>/    ← the install tree
```

The previous version's directory is kept for one-step rollback
([`plugin-install.ts:35-44`](../../src/main/plugins/plugin-install.ts)). **No
script ever runs during install** — the installer copies files, nothing more, so
there is no `postinstall` hook and no build step. Ship what you want executed.

The tree is capped at **2 000 entries and 50 MB**
([`plugin-content-hash.ts:15-16`](../../src/main/plugins/plugin-content-hash.ts)),
which includes everything in the folder, not just declared artifacts. A
committed `node_modules` will blow it.

### Sources

- **Local path** — the folder must contain `orca-plugin.json`
  ([`plugin-install.ts:68-87`](../../src/main/plugins/plugin-install.ts)).
- **Git URL + ref** — HTTPS or SSH only; Orca shells out to the *system* `git`
  with argv arrays (never a shell string, never a vendored client) so your
  credential helpers and SSH remotes keep working, and resolves the ref to an
  exact commit ([`:110-145`](../../src/main/plugins/plugin-install.ts)).
- **Marketplace** — a Git repo holding `orca-marketplace.json`
  ([`plugin-marketplace.ts:5, 101-119`](../../src/shared/plugins/plugin-marketplace.ts)):
  `{ name, owner, plugins: [{ id, source: { kind: 'git', url, ref }, description?, categories? }] }`,
  up to 2 048 entries. Each entry's `id` is the canonical `<publisher>.<id>` the
  source manifest must match, and `ref` is mandatory — an omitted remote default
  would make the listing irreproducible. Listings in the `themes`, `icons`,
  `icon-themes`, `terminal-themes` or `skills` categories are hidden in this
  build because those contributions are not accepted yet
  ([`:28-49`](../../src/shared/plugins/plugin-marketplace.ts)).

The "Official" badge is host-derived and cannot be self-awarded: it needs the
reserved `ab2web.orca-*` identity, served from the `ab2webco` organisation, via
the official index ([`plugin-list-projection.ts:260-266`](../../src/main/plugins/plugin-list-projection.ts),
[`plugin-marketplace.ts:16-26, 137-140`](../../src/shared/plugins/plugin-marketplace.ts)).

### Updating

An update installs into a new hash directory and swaps the pointer. Whether the
user is prompted again depends only on the fingerprint: a changed capability
set, a newly-added `main`, or — for a plugin with instructional contributions —
*any* change at all. The old version directory stays for rollback.

Bump `version` in the manifest for humans; the host's identity is the content
hash, not the version string.

## Checklist before you ship

- `orca-plugin.json` parses — the fastest check is the fixture test:
  `npx vitest run --config config/vitest.config.ts src/shared/plugins/plugin-demo-fixture.test.ts`
  with your folder added to it.
- No literal colours in the panel; everything from the 22 tokens. Look at it in
  both themes and at 320 px.
- No polling on the bridge; every reply branches on `ok` before `value`.
- The worker never writes a file, reads outside its folder, or expects an env
  var beyond the 19.
- Paths in the manifest use `/` and stay inside the plugin folder.
- Nothing large committed: 2 000 entries, 50 MB.
