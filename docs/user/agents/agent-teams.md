# Agent Teams

A team is one **lead** and its **members**. The lead is a Claude session that talks to you, picks
tickets and starts one member per ticket, each in its own worktree. Members work, open their pull
request and report back; the lead relays only what needs you. The **Team** panel shows all of it.

## Start a lead

1. In the project, open **+** and choose **Claude Agent Teams** under **Agents**. If it is not in
   the list, turn it on in **Settings > Agents**.
2. Run `/orca-game:lead`, or `orca game lead` from that terminal. The session becomes the
   project's lead and loads the project's rules from `orca.yaml`.
3. To set up `orca.yaml` (the tracker for the To Do, the lead's rules, the scene), run
   `/orca-game:setup` in a Claude pane of the project.

`orca game lead` prints Orca's built-in rules first. Among them, the lead re-arms its report wait and
`orca game watch --lead` on every start, resume or compaction; the second prints an alert for each
member or merge-queue entry that needs the lead to act. It settles each member `gone from` its host at once and treats a
PR as done only once it merges. It plans parallel lanes by the files they touch and asks members for
a split plan before a large first commit. Members are told to report once and to name a red CI
instead of going idle. Your project's `orchestratorGame.orchestrator.rules` in `orca.yaml` print
after them, unchanged, and win wherever they differ: add a rule there, or contradict a built-in one.

A project has one lead. Once it has one, **+** shows a **Team** group instead of a second
**Claude Agent Teams** entry: **Go to lead** and **Add member…** while the lead runs, **Reopen
team** and **Start fresh lead…** after you close it. `/orca-game:lead fresh` (`orca game lead
--fresh`) starts a new lead conversation instead of reopening the old one. See
[Sidebar and new tabs](../model/sidebar.md#the--menu).

## Add members

- Ask the lead in plain words ("take ORCA-101 and ORCA-102").
- Or open **+ > Add member…**, pick an account under **Member account** and a ticket from the To Do.
- Or run `orca game launch <ticket>` from the lead's terminal. `--on <host>` starts the member on a
  paired Orca Lab host.

Each member is one character for its whole run: the same name and portrait on its card, in its
terminal and in the history.

## The Team panel

Open **Team** in the right sidebar's activity bar. Without a team the same item is called **Your
work** and lists your own agent sessions.

- **Team**, with a team only: the lead, the advisor when installed, and a card per member.
- **Activity**, without a team only: each session's prompt, current step, question, model and
  account.
- **Inbox**: questions for you, with a red count.
- **PRs**: open PRs with their state, and the merge queue on top.
- **Machines**: each host with its free memory and how many agents it runs.

On the **Team** tab:

- Click a member's card to open its terminal and expand the card: ticket title, branch, last tool,
  PR with CI, helpers, and the account's 5-hour and weekly use. Click again to fold it.
- A card that needs you says **Waiting for your answer** and has **Answer in Inbox**.
- Clicking the lead's row opens the lead's session.
- The gear opens **Project settings** for the team.

## Answer from the Inbox

**Inbox** has **For you**, **Waiting**, **Threads** and **Answered**. Questions from this project come
first; other projects' questions sit folded under **Other projects**. When a new question arrives,
its notification opens the panel on the Inbox. The phone shows the same questions; see
[Mobile](../mobile.md).

## From PR to merge

A member works through **Planning**, **Coding**, **Testing** and **In PR**. Its card shows the PR
and its CI (**CI running**, **CI green**, **CI failing**, **Merged**). From a member's terminal,
`orca game state` reports the same CI as `review.ci` and GitHub's merge state as
`review.mergeState`; only `clean` can merge. When the member is done, `orca game sweep --close`
records it in the history and frees its tab.

## Looks, styles and scenes

The panel has three looks with the same data and actions: **Game** (a scene, levels and XP),
**Display** (a carousel of team metrics) and **Plain**. In the **Game** look the scene comes in three
styles, all acting out the real state of the work, never a timer:

- **Pixel**: a garden; each member's bed grows with its phase, and merged work fills harvest
  crates.
- **Figures**: a castle tower per member that rises from foundation to finished; merged towers
  become trophies.
- **Office**: whiteboards whose notes move toward done, with plaques for merges. With members on
  more than one machine it becomes a building with one floor per machine, the lead's first, and
  **All** shows every floor.

Red CI shows the build broken. A scene is a built-in one (Quest, Night Watch, Crystal Saga, Beast
Tamer), one a plugin adds, or a scene file in the project. Pixel draws every scene. When a scene has
no art for Figures or Office, a note in Settings says what the panel draws instead: Orca's own
office, or the scene's characters in Pixel. The style preview in Settings shows the chosen style.

## Where the settings live

- **Settings > Agents > Panel**: scene, look, style and the **PRs**, **Queue** and **Machines**
  switches for every project.
- The project's page in **Settings**, section **Agent Teams game**: the same rows for one project,
  each with **Inherit**, plus **Advisor**, **Arcade** and a custom scene file.
- `orca.yaml`: `orchestratorGame.panel` (`look`, `style`, `tabs`, `advisor`, `arcade`),
  `orchestratorGame.scene` and `orchestratorGame.sceneFile`, shared with everyone on the repo.

Each later layer wins: global Settings, then `orca.yaml`, then the project's Settings on this
machine. A new project starts on **Game**, **Pixel** and the Quest scene.

**Settings > Appearance > Status colors** sets one color per state (**Needs you**, **At risk**,
**Working**, **Verified**, **Idle**), for light and dark. The panel and the scene use them.

## The terminal band

The pixel band above the lead's prompt is off by default. Turn it on with **Show the band** under
**Terminal band** in **Settings > Agents > Agent Teams game**, or by choosing Zen or a 2D view under
**Default view**. **Render**, **Time zone** and **Teammate HUD** appear while it is on. A pane picks
the band up when it starts.

## History and lessons

- `orca game history` lists the project's freed members with their outcome, PR and character.
- When a member ends, Orca keeps a short lesson from its outcome (merged, failed, hit its account
  limit) for 30 days. New members get the project's lessons in their launch brief, marked as data,
  not instructions.
- If a project's repo was removed and added again, `orca game adopt-history --from-repo-id <id>`
  brings its history and lessons over.
- After an Orca Lab restart, `orca game resume-members` brings back the members that were paused.

Every `orca game` command is listed in the [CLI](../cli/overview.md#run-a-team-orca-game) page. The
full behavior is in the [Orca Game reference](../../reference/orchestrator-game.md).
