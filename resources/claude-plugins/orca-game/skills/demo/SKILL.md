---
name: demo
description: |
  Play a scripted fake party in this pane: every phase, action and reaction and one level-up,
  without running any command or writing XP. /orca-game:mode on returns to real data. With the word
  arcade it opens a practice run of the arcade's runner instead, which keeps no points; with the
  word offer it plays the arcade's unlock offer (celebration, countdown, play or pass) the same way.
  The game mod answers it, with no model turn. Run it as /orca-game:demo, /orca-game:demo arcade or
  /orca-game:demo offer.
user_invocable: true
disable-model-invocation: true
---

# /demo — answered by the game mod

The game mod answers `/orca-game:demo` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
