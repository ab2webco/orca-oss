# Scenes, styles and settings

The Team panel can look like a game, a dashboard or a plain list. This page covers its looks,
styles and scenes, which setting wins when several say different things, what changes at once and
what waits, and what happens when you bring a team to a project that already has agents running.

## Looks and styles

The panel has three looks with the same data and actions: **Game** (a scene, levels and XP),
**Display** (a carousel of team metrics) and **Plain**. In the **Game** look the scene comes in
three styles, all acting out the real state of the work, never a timer:

- **Pixel**: a garden; each member's bed grows with its phase, and merged work fills harvest
  crates.
- **Figures**: a castle tower per member that rises from foundation to finished; merged towers
  become trophies on the hills.
- **Office**: whiteboards whose notes move toward done, with plaques for merges. With members on
  more than one machine it becomes a building with one floor per machine, the lead's first, and
  **All** shows every floor.

![Settings > Agents > Panel with the scene, look, style, the style preview and the tab switches](../../assets/scenes-and-settings/panel-settings.png)

Red CI shows the build broken. **Settings > Appearance > Status colors** sets one color per state
(**Needs you**, **At risk**, **Working**, **Verified**, **Idle**), for light and dark; the panel and
the scene use them.

## Scenes

A scene is a built-in one (**Quest**, **Night Watch**, **Crystal Saga**, **Beast Tamer**), one a
plugin adds, or a scene file in the project. A scene themes Pixel; Figures and Office always draw
Orca's own art, and a note in Settings says so when a scene other than Quest is chosen. The preview
in Settings shows the chosen scene in the chosen style.

## Which setting wins

The same settings exist in three places, and each field resolves on its own: the later layer wins.

<figure class="orca-diagram" aria-label="Settings layers, from Orca's defaults to this machine's project settings">
<ol class="orca-chain">
<li><strong>Defaults</strong><span>Game, Pixel and the Quest scene</span></li>
<li><strong>Global Settings</strong><span>every project on this machine</span></li>
<li><strong>orca.yaml</strong><span>committed, shared with everyone on the repo</span></li>
<li><strong>This machine</strong><span>the project's page in Settings</span></li>
</ol>
</figure>

- **Settings > Agents**: **Agent Teams game** (the game in panes, and the **Terminal band**) and
  **Panel** (scene, look, style, and the **PRs**, **Queue** and **Machines** switches), for every
  project.
- `orca.yaml`: `orchestratorGame.panel` (`look`, `style`, `tabs`, `advisor`, `arcade`),
  `orchestratorGame.scene` and `orchestratorGame.sceneFile`, plus the lead's
  `orchestratorGame.orchestrator.rules`.
- The project's page in **Settings**, section **Agent Teams game**: the same rows for this project
  on this machine, each with **Inherit**, plus **Advisor**, **Arcade** and a scene file.

So a setting you change on the project's page beats the repo's `orca.yaml` on your machine only,
and `orca.yaml` beats your global Settings. To see what a pane resolved and which layer set each
field, run `/orca-game:state` in it.

## What changes at once, and what waits

- **The panel**: a look, style or scene picked in Settings shows at once. A change to `orca.yaml`
  shows on the panel's next read of the game state, within about 20 seconds.
- **The lead's rules**: the lead reads them when it runs `/orca-game:lead`. After you change
  `orchestratorGame.orchestrator.rules`, ask it to run `/orca-game:lead` again. It also goes back to
  them after a compaction.
- **Members already running** keep the brief they started with. Members the lead launches after
  the change get the new one; to reach a running member sooner, ask the lead to tell it.
- **The terminal band** is off by default. Turn it on with **Show the band** under **Terminal band**,
  or by choosing Zen or a 2D view under **Default view**; **Render**, **Time zone** and **Teammate
  HUD** appear while it is on. A pane picks the band up when it starts.

## An existing project

A project does not need to be new. Open **+ > Claude Agent Teams** in it and run `/orca-game:lead`
as in [Agent Teams](agent-teams.md#1-start-a-lead); `orca.yaml` is optional, and `/orca-game:setup`
adds it whenever you want.

Agents you already had running on this machine, in any worktree or folder, show up in the lead's
Team panel as members named after their worktree. They take no member slot, earn no XP, and the
lead's sweep, push and stop-all leave them alone; `orca game stop <name>` closes one.

When Orca Lab or the machine restarts, the lead's members stop with it and are kept as paused, with
their ticket and slot. When the lead starts again it runs `orca game resume-members`, or asks you
first if the project says so: each Claude member reopens its own conversation in its worktree, and
any other agent starts again on the same task.
