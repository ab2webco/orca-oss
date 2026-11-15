# Mobile emulator captures against the mock host

Use this guide to capture the phone app's screens on an Android emulator for a PR. The phone pairs
with the mock host in `mobile/scripts/mock-server.ts`, not a real Orca, so every screen has data
and no capture changes anyone's projects.

## The mock has to answer like the host

The mock is only useful if it sends what a real host sends. During ORCA-1224, a patch kept only on
one machine made the mock look right, and it hid two real bugs: #1238 read `settings.get` flat
instead of under `settings`, and #1240 sent a lead turn that the host refused. A third bug showed up
once the mock sent the lead's own agent row the way the host does: the Home card counted the lead as
one of its members. ORCA-1230 put the host shapes into the mock itself:

- Replies are typed with the host's own types (`OrchestratorGameState`, `RuntimeTerminalSend`,
  `RuntimeCreateAgentSessionResult`, `ClaudeAccountAuthVerdict`, `GameCharacter`). Where the host
  has a builder, the mock calls it: `settingsGetResultOf`, `agentTeamsClientSettingsOf`,
  `agentTeamsSettingsPatchOf`, `orchestratorGameScenesOf` and `statusGroupOfName`. When a host type
  changes, `pnpm typecheck` in `mobile/` fails until the mock matches it.
- Mobile can't import the lead types in `src/main/runtime/orchestrator-game-lead-types.ts`: that
  file pulls main-process code into mobile's `tsc`. So `mock-server-lead-sessions.ts` keeps copies
  of them, and `mobile/src/mock-server-lead-sessions.host.test.ts` checks that the mock lists a lead with the
  same fields as the real `GameLeads`.
- `mobile/src/mock-server-host-shapes.test.ts` passes each reply through the phone's own reader (the `+` sheet,
  Settings > Agent Teams, the terminal send check, the scene band, the level bar and the
  long-lived-token row). A shape the phone can't read fails there, not on the emulator.

If a capture needs a reply the mock doesn't send, add it to the mock in the host's type, with a
test, in its own PR. Don't keep a local patch: an untyped fixture can show a screen that a real host
never would.

## Setup (m1, AVD `orca_1183`)

```sh
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
adb=$ANDROID_HOME/platform-tools/adb
$ANDROID_HOME/emulator/emulator -avd orca_1183 -gpu host -no-snapshot-save -no-audio &

cd mobile
# Not 6768: the real Orca already listens there, and the phone would pair with it.
PORT=6799 MOCK_PAIRING_ENDPOINT=ws://10.0.2.2:6799 MOCK_SERVER_KEY_FILE=/tmp/mock-key.json \
  npx tsx scripts/mock-server.ts &
npx expo start --dev-client --port 8081 < /dev/null &   # never CI=1: it turns off file watching

$adb reverse tcp:8081 tcp:8081
$adb shell am start -a android.intent.action.VIEW \
  -d 'exp+orca-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.ab2web.orca.mobile
# Pair: open the "Pairing URL" the mock printed.
$adb shell am start -a android.intent.action.VIEW -d '<Pairing URL>'
```

`MOCK_SERVER_KEY_FILE` keeps the pairing when you restart the mock to change a scenario below.

## Pairing the emulator with a real host

Some captures have to show what a real Orca sends, not the mock. Mint the link from the CLI on any
machine paired with that host. Nobody has to open Settings > Mobile on it:

```sh
orca mobile pair --environment m1 --connection lan --address 10.0.2.2 --json
```

The flags match Settings > Mobile on that host:

- `--environment` names the paired host that mints the link, as in `orca environment list`. Leave
  it out to pair with the Orca on the machine you run the command on.
- `--connection` is the UI's Connection method. `relay` is the default, and it needs Orca sign-in on
  that host. When Relay can't make an invite, the host refuses with `relay_mint_failed`, and the
  error names the Relay failure code. `lan` pairs over `--address` alone, and that is all an emulator
  needs.
- `--address` is the UI's address of this computer, the one the phone dials. `lan` requires it.
  Without one, the command lists the host's addresses instead of minting a link. `10.0.2.2` is how an
  Android emulator reaches the machine it runs on, so the link points the emulator at the Orca on
  that same machine.
- A host keeps one unused link at a time, and repeated calls reuse it until a phone scans it.
  `--rotate`, or a different `--connection` than the pending link's, mints a new one. The old one
  stops pairing only once the new one exists, and the command says so. A mint that fails, such as a
  Relay refusal, leaves the earlier link working.

Then open the `pairingUrl` from the output on the emulator, on the host's machine:

```sh
$adb shell am start -a android.intent.action.VIEW -d '<pairingUrl>'
```

The link is a credential for that host: don't paste it into a PR, a ticket or a chat. A host older
than this command answers with an error that names it and its version. Update it, or pair from its
Settings > Mobile.

## Widths and theme

The AVD screen is 1080 px wide. Set the width with the screen density:

| Width  | Command                     |
| ------ | --------------------------- |
| 390 dp | `$adb shell wm density 443` |
| 320 dp | `$adb shell wm density 540` |

Capture with `$adb exec-out screencap -p > shot.png`, then remove the metadata with
`magick shot.png -strip out.png`. The app is dark only, so one dark capture covers each screen. Open
and read every image before you name it in a report.

## Mock scenarios

Set these variables when you start the mock. They work alongside the ones in `mobile/README.md`.

| Variable                                  | What the phone gets                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_                                  | A live lead for the active worktree, with its own agent card and Jev's report, six members, To Do tickets, PRs, a merge queue, three hosts and the project's buttons |
| `MOCK_LEADS=none`                         | No live lead, so the `+` sheet offers to start or reopen one                                                                                                         |
| `MOCK_LEADS=restoring`                    | A lead that a restart hasn't brought back yet, so the `+` sheet waits                                                                                                |
| `MOCK_LEAD_STORED=<account id>` / `null`  | A saved lead conversation on that account, or on no account                                                                                                          |
| `MOCK_REOPEN=ok`                          | Reopen team succeeds. Without it, the host says why it couldn't                                                                                                      |
| `MOCK_DOCK=1`                             | Each member has a terminal (the lead dock), and the cap goes up to 9                                                                                                 |
| `MOCK_EXTRA_MEMBERS=1`                    | Three more members                                                                                                                                                   |
| `MOCK_STOPPED=1`                          | The project's STOP is on, with one paused member and one queued member                                                                                               |
| `MOCK_REVIEWS=off`                        | A project whose PRs aren't read                                                                                                                                      |
| `MOCK_PANEL_STYLE=pixel\|office\|figures` | The project's panel style. `MOCK_PANEL_LOOK` sets the look (`game` by default)                                                                                       |
| `MOCK_CUSTOM_SCENE=1`                     | A plugin scene, `mock/neon-heist`, whose Figures art comes from `MOCK_SCENE_ART_DIR`. With `fail`, the host can't read the art                                       |
| `MOCK_STATUS_COLORS='{"attention":"#…"}'` | Starts with these dark status-colour overrides                                                                                                                       |
| `MOCK_TOKEN=a\|b`                         | The personal Claude account uses a long-lived token that the host verified (`a`) or rejected (`b`, with a long email)                                                |
| `MOCK_NO_TEAM_CONTROL=1`                  | A host older than the phone's Agent Teams controls                                                                                                                   |

## When the app crashes on launch

If Hermes throws `toSorted is not a function` (or `Map.groupBy`, or `toWellFormed`), a `src/shared`
module the phone imports calls an API that Hermes doesn't have. That's a bug in the app, tracked in
ORCA-1226. Fix it there. A capture-only polyfill hides the crash on the emulator, and users would
still hit it.
