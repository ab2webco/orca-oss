---
name: mode
description: |
  Set this pane's game mode for this session: off shows everything, on hides tool rows, zen also
  hides short working notes, flat draws the game as text with no scene or characters. Alone it prints the mode and render. The game mod answers it, with
  no model turn; Orca's configured mode is unchanged. Run it as /orca-game:mode.
argument-hint: '[on|zen|flat|off]'
user_invocable: true
disable-model-invocation: true
---

# /mode — answered by the game mod

The game mod answers `/orca-game:mode` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
