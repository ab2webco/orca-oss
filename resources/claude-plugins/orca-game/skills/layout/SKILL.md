---
name: layout
description: |
  List and change the game Panel's widgets for this project: reset, add <section>, remove <section>
  or move <section> up|down (team, review, reviews, todo, actions). Alone it lists each section
  with its state. The game mod answers it, with no model turn. Run it as /orca-game:layout.
argument-hint: '[reset|add <section>|remove <section>|move <section> up|down]'
user_invocable: true
disable-model-invocation: true
---

# /layout — answered by the game mod

The game mod answers `/orca-game:layout` itself and no model turn runs, so reading this means the
mod did not load in this session: Claude Code is older than 2.1.287, or Orca did not start this
pane with its game. Say that in one line and do nothing else.
