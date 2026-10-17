---
name: state
description: |
  Show this pane's Agent Teams game state: mode, scene, render, timezone, HUD, rewards and tracker
  with the layer each came from, this session's own mode and render, the lead and its members with
  their slots, a held STOP, warnings and links. The game mod answers it from a fresh
  `orca game state`, with no model turn. Run it as /orca-game:state.
user_invocable: true
disable-model-invocation: true
allowed-tools: Bash
---

# /state — the game state, read for the person

The game mod answers `/orca-game:state` itself, so reading this means the mod did not load in
this session (Claude Code older than 2.1.287, or the pane was not started by Orca's game).

1. If `ORCA_GAME_CLI` is empty, say this session was not started by Orca's game and stop. Never
   run a bare `orca`: on Linux it is usually the GNOME screen reader, and elsewhere it may be
   another Orca build.
2. Otherwise run `"$ORCA_GAME_CLI" game state` with Bash and show its lines as they are, then say
   in one line that a mode or render this pane set with `/orca-game:mode` or `/orca-game:render`
   does not show there.
