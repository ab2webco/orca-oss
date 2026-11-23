# ORCA-1209 QA evidence: Team scenes and agent states

Read-only QA pass on `main` 44f15524666 (macOS, Electron E2E harness, WebGL on). No product change.

## How it was captured

`rig/qa-orca-1209-scenes-states.spec.ts` (throwaway, not part of the app) launches the E2E app with a real
lead and 7 real member terminals, then loops 5 scenes x 4 window widths x 2 themes:

| Member | State | How it was produced |
|---|---|---|
| Ana | working | real Codex hook, working on Bash `npm test` |
| Ben | idle | real `Stop` hook |
| Cleo | waiting / needs you | real `game.ownerAsk` from the lead on her ticket ORCA-2003 |
| Dan | limited | `Stop` hook + `agent.limit` overlaid on game.state |
| Eva | finished | `Stop` hook + done work item overlaid on game.state |
| Finn | blocked | real Codex `PermissionRequest` hook (maps to waiting by design) |
| Gil | red CI | `Stop` hook + `review.ci: failure` overlaid on game.state |
| Lead | needs you | the same owner question ("Merge #2003 now?") |

Scenes: Office 3D (office + high), Office 2D (office + low, the Low resources Office), Figures 3D
(figures + diorama + high), Figures Low resources (figures + diorama + low), Figures 2D (diorama off).

Window widths 1440, 768, 390, 320. The Team panel does not follow the window: it is 349 px at 1440 and
768, and 219 px at 390 and 320 (`dom-report.json`, `rightSidebarWidth`).

## Layout

- `scenes/<scene>/scene-<scene>-<width>-<theme>.png`: the scene canvas only.
- `scenes/<scene>/panel-<scene>-<width>-<theme>.png`: the whole Team panel (scene + Team cards).
- `scenes/show-all/`: the three WebGL scenes after "Show all".
- `sidebar/sidebar-<width>-<theme>.png`: the left sidebar team rows.
- `crops/`: light vs dark crops used by the defect tickets.
- `sheets/`: contact sheets (one row per scene, all widths and themes).
- `dom-report.json`: per cell, every Team card and sidebar row text, tone and glyph, plus the scene's data attributes.
- `existing-specs/`: contact sheets of the screenshots written by the repo's own scene and state specs.
- `motion/`: sampled frames (about 18 per recording) from `team-scene-motion.spec.ts`.

Full-window shots (and the sidebar-team-agent-rows / agent-status sheets) were read locally but are not
published here: the terminal prompt in them shows the local user and host name.

## Existing specs run on this Mac

- `electron-headless`, 10 passed (7.7m): team-office-3d (2), team-panel-diorama (2), team-panel-scene-motion,
  team-panel-scene-states, status-tones-sidebar, status-colors-settings, sidebar-team-agent-rows,
  agent-status-claude-monitor-idle.
- `electron-ondemand` with `ORCA_E2E_FORCE_HEADFUL=1`, team-scene-motion: 4 passed (4.6m).

## Videos

### `videos/states/`: members change state live (25 s each, cropped to the Team panel)

Recorded by `rig/qa-orca-1209-states-video.spec.ts` with the showcase recorder (`startClip`, real composited
frames at 60 fps, re-encoded at 30 fps), with a real lead and 7 real members. Each clip follows the same timeline:

- 0 s: Ana, Cleo, Eva, Finn and Gil working; Ben idle; Dan at the usage limit.
- 3 s: Cleo goes working -> waiting for you (owner question on ORCA-2003); the lead also reads "Waiting for you".
- 7 s: Finn hits a permission prompt (Codex PermissionRequest, Bash).
- 11 s: Gil stops with red CI: his card turns to a red "CI failing" and moves up the list.
- 15 s: Cleo's question is answered; Cleo and the lead go back to working.
- 18 s: Eva finishes (ticket Done): green "Done" card and check in the scene.
- 21 s: Ana stops and goes idle. Her card is below the fold of the Team list, so this shows in the scene only.

| File | Scene | Window | Panel | Theme |
|---|---|---|---|---|
| `states-office-3d-1440-light.mp4` | Office 3D | 1440 | 349 px | light |
| `states-office-3d-1440-dark.mp4` | Office 3D | 1440 | 349 px | dark |
| `states-office-3d-390-light.mp4` | Office 3D | 390 (phone) | 219 px | light |
| `states-office-3d-390-dark.mp4` | Office 3D | 390 (phone) | 219 px | dark |
| `states-figures-2d-1440-light.mp4` | Figures 2D | 1440 | 349 px | light |
| `states-figures-2d-1440-dark.mp4` | Figures 2D | 1440 | 349 px | dark |
| `states-figures-2d-390-light.mp4` | Figures 2D | 390 (phone) | 219 px | light |
| `states-figures-2d-390-dark.mp4` | Figures 2D | 390 (phone) | 219 px | dark |

### `videos/motion/`: the ORCA-1336 movement recordings (`team-scene-motion.spec.ts`, light theme)

Encoded from the spec's timestamped canvas frames, so each frame is shown for as long as it was on screen.

- `motion-office-lead-lift-out.mp4`: Office 3D, the lead walks to the lift and rides up to a member who joined on another floor.
- `motion-office-lead-lift-back.mp4`: Office 3D, the lead rides back down to its own desk.
- `motion-office-join-and-sit.mp4`: Office 3D (Show all), a member joins, walks in, rides up and sits.
- `motion-office-stand-to-lobby.mp4`: Office 3D (Show all), that member stands and goes down to the lobby.
- `motion-office-leave.mp4`: Office 3D (Show all), the member leaves the building.
- `motion-figures-lead-crossing-out.mp4`: Figures 3D, the lead takes the boat to a member on another island who needs the user.
- `motion-figures-lead-crossing-back.mp4`: Figures 3D, the lead crosses back to the home island.
- `motion-figures-arrive.mp4`: Figures 3D (Show all), a member arrives at its plot.
- `motion-figures-lead-to-asker-home.mp4`: Figures 3D (Show all), a member on the home island asks and the lead walks out to it.
