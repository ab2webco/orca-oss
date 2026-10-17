---
name: demo
description: |
  Play a scripted fake party in this pane: every phase, action and reaction and one level-up,
  without running any command or writing XP. /orca-game:mode on returns to real data. The game
  mod answers it, with no model turn. Run it as /orca-game:demo.
user_invocable: true
disable-model-invocation: true
---

# /demo — answered by the game mod

The game mod answers `/orca-game:demo` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
