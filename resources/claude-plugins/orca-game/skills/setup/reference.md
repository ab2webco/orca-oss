# orca.yaml keys for the game

Everything sits under `orchestratorGame:`. Each key resolves on its own: global Settings, then
`orca.yaml`, then the project's Settings on this machine. `orca game state --json` reports every
invalid value in `warnings`, and that parser is the authority over this summary.

```yaml
orchestratorGame:
  mode: on # on | zen | off
  scene: quest # quest | vigilante | jrpg | tamer | <publisher>.<id>/<scene id>
  sceneFile: .orca/scenes/my-scene.json # optional: the project's own scene; wins over scene
  hud: true # teammate band above the prompt
  rewards: true # XP, level-ups, celebrations
  rewardWeights: # optional: XP per reward, 0 to 1000; 0 turns one off, an unset one keeps its default
    ci-green: 10 # review-merged 100, ci-green 20, work-item-review 50, work-item-done 70, member-claimed 10
    member-claimed: 0
  tracker: true # follow the worktree's linked work item
  render: hd # classic (5-row pixel art, the default) | hd (9 to 14-row 2D-HD scene) | hd-compact (the hd scene in 7 rows)
  timezone: America/Bogota # hd's day and night: local (the machine's clock, the default) | an IANA zone

  todo: # or: off
    provider: jira # plane | jira | linear | github | gitlab
    project: CIN # Plane project id, Jira project key, Linear team key
    workspace: my-site # optional: Plane workspace slug, Jira site id, Linear workspace id
    workPrompt: 'Work on {id}: {title} {url}' # optional: what "▶ work on" sends the lead
    action: todo # optional: the command of the action the To Do link runs instead of opening the tracker

  links: # at most 6, static
    - label: Test plan # at most 24 characters
      url: https://tests.example.com/projects/CIN # may use {workItem.identifier} {branch} {review.number}

  activity: # at most 8; an MCP call an agent makes becomes a chip
    - name: Test run # at most 24 characters
      tools: mcp__tests__* # tool name glob; every MCP tool when omitted
      match: 'TR-([A-Z]+)-\d+' # regex; {0} the match, {1}-{9} its groups
      url: https://tests.example.com/projects/{1}/runs/{0}

  actions: # at most 6; a later layer replaces the whole list
    - label: Test runs # at most 24 characters
      command: tests # optional slash command: lowercase, digits and -, up to 24
      prompt: | # sent to the lead as a turn; 1 to 2000 characters
        Launch one member per QA ticket to run its test run and report pass/fail.
    - label: To Do
      command: todo
      prompt: Read my open tickets with the jira CLI and show them by status. Do not launch anything.
    - label: Runs
      mcp: { server: tests, tool: list_test_runs, args: { project: CIN } } # runs from the Panel

  orchestrator: # the lead
    autostart: true # a plain session here starts as the lead
    label: Lead # the lead's name, at most 32 characters
    cap: 4 # members running at once, 1 to 12; unset, Orca sizes it to the machine
    agent: claude
    model: claude-opus-5-5 # optional
    effort: medium # optional, only with model
    launchPrompt: | # optional: what a new member is told; {id} {title} {url} {status}
      /implement {id}
    pushPrompt: | # optional: what `game push` sends a stopped member
      Continue {id} from where you stopped.
    rules: | # optional, up to 4000 characters: appended to Orca's lead rules
      - [FE] tickets go to the frontend repo (--repo name:frontend).
    actions: true # false hides Orca's lead buttons (Wave, Status, Push, Sweep, Stop)
    accounts: auto # auto (also when unset): each member on its agent's freest managed account | default: Orca's own selection
```

- URLs must be `http(s)` with a literal host: no placeholder before the path.
- A placeholder in a prompt or link with no value in a worktree drops that link, or leaves the
  value empty in a prompt.
- Braces are placeholders everywhere: write `~/.local/state/x`, not `${XDG_STATE_HOME}/x`.
- A scene file's optional `cast` gives it a pet that `♥ Pet <name>` hearts (Clawd without one) and
  the character that acts out Jev's decisions (a referee without one); see "The cast" in
  `docs/reference/orchestrator-game.md`.
