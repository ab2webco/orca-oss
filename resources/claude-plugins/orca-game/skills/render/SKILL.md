---
name: render
description: |
  Set this pane's game look for this session: classic, the 5-row pixel art, or hd, the 9 to
  10-row scene. Alone it prints the mode and render. The game mod answers it, with no model turn;
  Orca's configured render is unchanged. Run it as /orca-game:render.
argument-hint: '[classic|hd]'
user_invocable: true
disable-model-invocation: true
---

# /render — answered by the game mod

The game mod answers `/orca-game:render` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
