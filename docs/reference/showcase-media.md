# Showcase media

The clips on the site and the GIFs in the README are recorded from the real app by the
`tests/e2e/*-showcase.spec.ts` specs. Nothing in them is drawn by hand: every frame is a state the
spec drove the app into and asserted.

## Record and export

macOS only (the recorder encodes with VideoToolbox), with `ffmpeg` and Claude Code 2.1.287+ on
`PATH`:

```sh
ORCA_SHOWCASE_CLIPS=1 npx playwright test tests/e2e/game-lead-wave-showcase.spec.ts \
  --config tests/playwright.config.ts --project=electron-headless --workers=1 --output tmp/clips
node config/scripts/export-showcase-media.mjs --from tmp/clips
```

Pass several specs in one run, or one `--output` per run: Playwright empties its output folder at the
start of every run, so a second run deletes the first run's clips.

The export writes, per clip, `docs/assets/media/<name>.mp4`, `.webm` and a `.png` poster (the last
second) for the site, and `docs/assets/readme/<name>.gif` (1200 px, 12 fps) for the README.
`--only lead-wave,agent-grid` limits it to some clips.

Without `ORCA_SHOWCASE_CLIPS=1` the specs run as ordinary regression tests and record nothing.

## How a clip is made

- `tests/e2e/helpers/showcase-clip.ts` subscribes to the window's composited frames in main
  (`beginFrameSubscription`), so the hidden test window records at `--force-device-scale-factor=2`
  and every repaint lands on a 60 fps grid by the time it painted. A resize mid-clip is dropped
  frames, so size the window before `showcaseClip` starts.
- `showcase-messages-api.ts` is a local Messages API: a lead or agent Claude Code streams the scripted
  answer for a matching prompt instead of an API error. Unmatched side requests get `OK.`, which is
  never on screen; add a reply for any prompt that reaches the transcript.
- `showcase-repo.ts` opens a `lumen-app` repo instead of the e2e fixture repo, so the sidebar, tabs and
  grid read `lumen-app` on `main`. While recording on macOS it lives at `/Users/Shared/code/lumen-app`,
  because the diff header prints the absolute path.
- `startGameBand(..., { showcase })` runs the band with `HOME` at its root (Claude prints
  `~/lumen-app`), a configured permission mode and `hasSeenAutoDefaultNudge`, so neither the auto-mode
  notice nor its offer is drawn.

## Phone clips

The `mobile-<scene>-<ios|android>` clips are recorded from a release build on the iOS simulator and
the Android emulator, paired with the mobile mock (`MOCK_SCENARIO=showcase npx tsx
scripts/mock-server.ts` in `mobile/`; `POST /mock/owner-question` sends the notification). Name each
recording `mobile-<scene>-<platform>.showcase.webm` or `.mp4` and export it with the same script; a
portrait clip gets a 360 px GIF.

- Android: record with `adb emu screenrecord start --fps 60 <file>.webm`. `adb shell screenrecord`
  writes only changed frames and drops the last ones when stopped. Run `cmd uimode night yes` first,
  or opening the app from a notification flashes the light notification card full screen.
- iOS: `xcrun simctl io <udid> recordVideo` also writes only changed frames, so end the take on a
  screenshot of the settled screen, and drive it with `axe batch` (one session for every tap). Under
  load each `axe` call costs seconds; cut the still waits, never the motion.
- Open each terminal once before the take: a cold terminal draws blank for a second.

## Before shipping a clip

Watch it frame by frame (`ffmpeg -i clip.mp4 -vf fps=2,scale=1440:-1 frames/%03d.png`), and check
for: fixture names (`orca-e2e-repo-*`, `Test agent`), temp paths (`/var/folders`, `/private/tmp`),
the auto-mode notice, empty terminals, and a duration that matches the spec's waits (a short clip
means frames were lost).
