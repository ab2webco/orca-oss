---
name: view
description: |
  Pick how the game is shown: off, flat, zen, 2d-classic or 2d-hd, each with its cost. Alone it
  lists them with the current one and the one this machine suggests. A scope after the view says
  where: pane (the default) for this pane only, project for this project on this machine, global
  for every project. The game mod answers it, with no model turn. Run it as /orca-game:view.
argument-hint: '[off|flat|zen|2d-classic|2d-hd] [pane|project|global]'
user_invocable: true
disable-model-invocation: true
---

# /view — answered by the game mod

The game mod answers `/orca-game:view` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
