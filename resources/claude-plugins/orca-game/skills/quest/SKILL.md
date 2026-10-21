---
name: quest
description: |
  Quest mode: alone it prints this pane's game mode and render, each beside the configured value
  when this session changed it; with on, zen or off it sets the mode, with render classic|hd|hd-compact the
  look, with demo a scripted fake party, all for this session only. The game mod answers it, with
  no model turn. Run it as /orca-game:quest (or /quest, which also runs mid-turn).
argument-hint: '[off|on|zen|demo|render classic|hd|hd-compact]'
user_invocable: true
disable-model-invocation: true
---

# /quest — answered by the game mod

The game mod answers `/orca-game:quest` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
