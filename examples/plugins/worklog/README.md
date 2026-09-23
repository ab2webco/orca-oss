# Worklog — Orca plugin template

A deliberately complete sample: copy this folder, rename it, and you have the
skeleton of a real plugin. Unlike `../hello-orca` (a minimal three-piece demo)
this one exercises every surface a non-trivial plugin actually uses.

| Piece                                              | Where                                        |
| -------------------------------------------------- | -------------------------------------------- |
| Settings-surface panel painted with the host tokens | `panel.html`                                 |
| Plugin storage, read **and** written from the panel | `panel.html`, `main.mjs`                     |
| Declared settings, including a `secret`             | `orca-plugin.json` → `contributes.settings`  |
| A worker with commands and an event subscription    | `main.mjs`                                   |
| A contributed automation                            | `orca-plugin.json` → `contributes.automations` |
| Capabilities the user must consent to               | `orca-plugin.json` → `capabilities`          |

The full reference — manifest fields, the design tokens a panel receives, the
bridge budgets, what the worker may and may not do, and how consent is bound to
the installed content hash — is in
[`docs/reference/plugin-development.md`](../../../docs/reference/plugin-development.md).

## Run it

1. Settings → Plugins → enable the plugin system.
2. **Install from folder** and point at this directory (or add it under
   _Development_ so edits reload without reinstalling).
3. **Review & enable**: the consent dialog lists the six capabilities and the
   automation's command verbatim, because a contributed automation binds consent
   to the installed tree's hash.
4. The panel appears as its own page under Settings → Plugins.

The worker is lazy: it forks on the first command invocation or subscribed
event, not at startup. Until then the panel's **Settings** card reads "not
published yet" — that is the lazy activation showing through, not a bug.

## What is deliberately missing

- **No `settings.*` from the panel.** Those methods are worker-only, so the
  worker mirrors the resolved values into a storage key the panel reads.
- **No polling.** Every host call happens on an explicit user action; the bridge
  budget is 30 messages per 10 seconds per plugin and the liveness pong already
  spends one of them every 10 seconds.
- **No network.** The manifest declares no `net:fetch`, so the worker's
  `fetch` throws and `node:http`/`node:net` fail to even import.
