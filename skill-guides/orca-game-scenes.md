---
name: orca-game-scenes
description: >-
  Create, edit, validate and activate a custom scene for Orca Lab's Agent Teams game
  (the pixel-art band and Fleet pane in a Claude Agent Teams pane) without errors:
  start from `orca game scene new`, edit the JSON, loop on `orca game scene validate`
  until it is clean, select it with `orchestratorGame.sceneFile` in project Settings
  or orca.yaml, and check it live with `/quest demo`. Use when someone asks for a new
  game scene, theme or skin (e.g. "make a Mario scene"), to change a scene's colors,
  characters or names, or when a custom scene draws Quest instead of itself.
---

# Orca Lab game scenes

A scene is one JSON file that restyles the Agent Teams game: the sky and world behind the
lead, the character drawn for each phase of work, the phase cards, the narrator, the chips
under the band, the team band itself, the foe shown on red CI and the merge caption. No
plugin and no code: Orca validates the file, sends it to the game, and re-reads it on every
refresh, so an edit shows within seconds.

The rules below are the ones Orca and the game enforce. A file that breaks any of them is
not drawn: the game falls back to Quest and its note (and Settings) shows the first problem.
Do not hand back a scene until `orca game scene validate` says it is valid.

## The workflow

Run every step; skipping validation is the usual way scenes ship broken.

1. **Start from the template**, never from a blank file. It is the built-in Quest with every
   required block filled in, its team-band palette (`hud`) and its advisor (a wizard), plus an
   example of each optional block Quest lacks: a `foe` (a goblin), a `finale` and a `cast.pet`
   (a fox), and a `roster` of ten of Quest's characters. Replace them all; none of them is meant
   to stay:

   ```text
   orca game scene new .orca/scenes/<name>.json
   ```

   It refuses to overwrite an existing file. Keep scenes under `.orca/scenes/` so Settings
   and `orca game scene list` find them. `<name>` is lowercase with dashes (`mario-bros`).
   `orca game --help`, `orca game scene --help` and `orca game scene new --help` list the
   commands and their flags.

2. **Edit the JSON** following the format below. Change one block at a time.

3. **Validate until clean**:

   ```text
   orca game scene validate .orca/scenes/<name>.json
   ```

   It lists every problem as `path: message` (for example
   `costumes.pr.rows.2: must be ten printable ASCII glyphs`) and exits 1 while any remain.
   Fix them all and run it again. `--json` gives `{ file, valid, issues }`.

4. **Activate it for the project.** Pick one:
   - On this machine only: Settings → the project → **Agent Teams game** → **Scene** →
     the scene's file in the list (or **Custom file…** and its path).
   - For everyone on the project: in `orca.yaml` at the project root:

     ```yaml
     orchestratorGame:
       sceneFile: .orca/scenes/<name>.json
     ```

   The path is relative to the project root; absolute paths and `..` are refused. Project
   Settings win over `orca.yaml`, so if `orca.yaml` seems ignored, set the project's Scene in
   Settings back to **Inherit**. `sceneFile` wins over `scene` in the same place.

5. **Check it live.** In a Claude Agent Teams pane, `/quest demo` plays a scripted party
   through every phase with the scene (nothing is read or written); `/quest on` returns to
   real data. Look at: the characters in each phase, the cards' names and colors, the chips
   under the band, the team band's frame and sky, the foe, and the cast's pet (press Pet).
   Then `/quest render hd` and look again: hd draws the same file as a 9 to 10-row scene, with
   every character outlined in ink taken from the darkest color of its own `colors` and shaded
   from them, so a costume whose colors are all pale gets a pale outline. `/quest render classic`
   returns (or set `orchestratorGame.render` for the project).

6. **Decide whether to commit it.** A scene in `.orca/scenes/` is shared when committed. For a
   private scene (licensed characters, personal jokes) see [Private scenes](#private-scenes).

`orca game scene list` shows the built-in scene ids and every file in `.orca/scenes/` with
its status, from any folder of the project.

## Private scenes

`sceneFile` is always a path inside the worktree: Orca refuses an absolute path, a `..` part and
a link that resolves outside the worktree, and global Settings never takes a `sceneFile`. These
are the only ways to keep a scene out of the repo:

- **An uncommitted file in the worktree.** Keep it in `.orca/scenes/` and add the line
  `.orca/scenes/<name>.json` (or `.orca/`) to `.git/info/exclude`, not to `.gitignore`, so
  nothing about it is committed (in a linked worktree `.git` is a file: the exclude file is
  `$(git rev-parse --git-common-dir)/info/exclude`, shared by every worktree). Select it in
  project Settings (this machine only), not in `orca.yaml`, which is committed. The file lives only in that checkout: each worktree reads its
  own copy, so a child worktree (`orca game launch`) or a fresh clone draws Quest until it gets
  one. A folder workspace has no `.git`; just never share the file.
- **A personal plugin outside the project.** A folder with an `orca-plugin.json` whose
  `contributes.gameScenes` lists the scene (`{ "id": "<scene>", "path": "scenes/<scene>.json" }`),
  added under Settings → Plugins (the plugin system must be on); add the folder under
  **Development** to have edits picked up without reinstalling. Select it as
  `<publisher>.<id>/<scene>` in the **Scene** list of Settings → Agents → **Agent Teams game**
  (every project) or of Settings → the project → **Agent Teams game** (that project), where it is
  listed under the plugin's name. It follows you into every project and worktree on this machine
  and never touches a repo. See `docs/reference/plugin-development.md` (Game scenes) for the manifest.

`orca game scene validate` takes any path, so validate a plugin's scene file the same way.

## Characters for an existing scene

To add characters to a scene, or regenerate them, edit that file **where it is**, private ones
too, and change only its `roster`: every other key stays as it is.

1. Run `orca game scene validate <file>` first. If it already has issues, report them before
   editing; do not fix other blocks unasked.
2. List the glyphs its costumes draw (the keys of every `costumes.<phase>.colors`). Recolor the
   figure's main ones (body, clothes, hair); leave the eyes and the darkest color alone, since hd
   inks the outline from it.
3. Keep the roster's names and their order, then add names in the scene's voice until there are
   at least 10. The first stays a plain name. Each of the others becomes
   `{ "name": …, "variant": { "colors": {…}, "accessory": …, "accessoryColor": … } }` with 1 to 3
   of those glyphs in colors of its own. To regenerate, replace the `variant`s and keep the names.
4. Make each one unmistakable: no two characters share a palette and an accessory, and every
   `accessoryColor` is lighter than `#666666`, or it vanishes into the dark Panel tile.
5. Validate until clean; roster problems read `roster.N…`.
6. Look at them: the [captures](#looking-at-it-without-a-pane) draw every roster name as its
   Panel tile in `sheet-roster-scene-file-<phase>.png`. `/quest demo` does not: its party is not
   named from the roster.

## Looking at it without a pane

`/quest demo` in a Claude Agent Teams pane is the real check. Without a pane, an Orca **source
checkout** (with its dependencies and Playwright's Chromium installed) renders a scene file to
PNGs:

```text
pnpm run capture:orca-game-scenes -- --scene-file /abs/path/<name>.json --out /tmp/<name>-captures
```

- Every phase of the file is drawn, in classic and in hd by day and by night, at 130 and 60
  columns, with the advisor, the hero at a fixed step and, in hd, a two-member party:
  `scene-file-<phase>-classic-130.png`, `scene-file-<phase>-hd-day-60.png`… and one sheet per
  phase, `sheet-scene-file-<phase>.png`, with its six captures labelled. Look at the sheets.
- Every `roster` name is drawn as its Panel tile, one sheet per phase:
  `sheet-roster-scene-file-<phase>.png`.
- `--phases build,pr` (or `all`) limits or widens the phases; the built-in scenes, drawn too for
  comparison, default to `build`. The Panel's advisor and member cards land in `sheet-cards.png`
  and `sheet-members.png`; `index.txt` lists every file.
- They are the cells the game hands the terminal, painted in a browser: a terminal's font and
  gamma differ, so confirm in a pane before you report.

## Format

Top level, all required unless marked optional:

| Key        | What it draws                                                      |
| ---------- | ------------------------------------------------------------------ |
| `looks`    | The world behind the lead, one per phase                           |
| `costumes` | The character, one per phase                                       |
| `cards`    | Each phase's card: icon, name, color (Fleet pane, captions)        |
| `teller`   | The narrator card that frames replies                              |
| `band`     | Colors of the chips under the band                                 |
| `foe`      | Optional. The costume a teammate with red CI trades turns with     |
| `finale`   | Optional. Caption painted while a merge runs                       |
| `hud`      | Optional. The team band's frame, sky and text colors               |
| `cast`     | Optional. The scene's pet (what Pet hearts) and who stands for Jev |
| `roster`   | Optional. Names a lead's members take, each in a look of its own   |
| `themes`   | Optional. Palette variants the band shows one a day                |

Unknown keys are ignored, so a scene written for a newer Orca still loads on an older one.
The file must be at most 64 KB.

### Phases

`looks`, `costumes` and `cards` each need all six phases, with exactly these keys:

| Phase     | When the game is in it                                                  |
| --------- | ----------------------------------------------------------------------- |
| `working` | Default: thinking, reading, any tool without a more specific phase      |
| `docs`    | Editing docs (`docs/`, `.md`, `.mdx`) or running a spec/plan/docs skill |
| `build`   | Editing any other file, or an implement/build skill                     |
| `verify`  | Tests, lint, typecheck (vitest, jest, pytest, tsc, eslint, `npm test`…) |
| `pr`      | `git push`, `gh pr create/edit/review`, `glab mr create/update`         |
| `handoff` | Merging (`gh pr merge`, `glab mr merge`) or moving the tracker ticket   |

### Colors

- Pixel colors (`looks`, costume `colors`, `hud`): `"#rrggbb"` or an integer 0–16777215.
  Six hex digits only: `#fe8`, `#ffee88ff` and color names like `"gold"` are refused.
- Card, teller and band colors: `"#rrggbb"` only, never integers.

### `looks.<phase>`

```json
{
  "skyTop": "#5c94fc",
  "skyBottom": "#a4c8fc",
  "sun": "#fcd800",
  "isNight": false,
  "far": "#80d010",
  "snow": "#fcfcfc",
  "near": "#00a800",
  "ground": "#c84c0c",
  "plant": "#00a800",
  "plantKind": "flower",
  "cloud": "#fcfcfc",
  "scenery": "meadow",
  "isSignal": false
}
```

- `skyTop` → `skyBottom` is a vertical gradient. `isNight: true` adds twinkling stars and
  turns `sun` into a moon.
- `far` is the distant layer, `snow` its highlights, `near` the closer layer, `ground` the
  strip the character walks on.
- `plantKind` is one of `tree`, `cactus`, `none`, `antenna`, `crystal`, `flower`; `plant`
  is its color.
- `scenery` (optional) is the world's shape: `peaks`, `skyline`, `crystals` or `meadow`.
  Left out, it is mountains.
- `isSignal` (optional, `true`) turns the sun into a signal disc with a beam over the city.
- Every color key is required even if the scenery barely shows it.

### `costumes.<phase>` and `foe`

```json
{
  "rows": ["...CCCCC..", "..CCCCCCCC", "..HHSSES..", "..SSSHHHH.", "..RROYORR.", ".SROOOOORS"],
  "legs": ["..HH..HH..", ".HH....HH."],
  "colors": {
    "C": "#d82800",
    "H": "#883c00",
    "S": "#fca044",
    "E": "#000000",
    "R": "#d82800",
    "O": "#2038ec",
    "Y": "#fcd800"
  }
}
```

- The figure is **10 wide by 7 tall**: 6 `rows` of body, then one legs row. `legs` holds the
  **2 frames** of that seventh row, which alternate while the character walks; make them differ
  slightly. Every row is exactly **10** characters of printable ASCII (`!` to `~`). No spaces,
  no accents, no emoji: count the characters of each row.
- `.` is transparent. Every other glyph used in `rows` or `legs` needs an entry in `colors`
  (one ASCII character as key, `.` not allowed as a key).
- A resting or idle figure sits: the legs row is dropped and the body moves down one row, so
  the 6 body rows must read on their own. hd draws the same 10×7 with a 1-pixel outline (12×9).
- Draw the head in the top rows; the game adds the walk, the blink and the reactions.
- **Facing.** Nothing is mirrored when a figure walks back: every costume is drawn exactly as
  written, everywhere. The hero faces **right** (its prop is drawn on its right, the pet and
  the party walk on its left), so draw every costume facing right.
- `foe` uses the same shape and also faces right as written. It shows on a teammate whose CI is
  red: on the band it replaces that teammate's costume in turns, **as written**; on the
  teammate's Panel tile it stands at the right, **mirrored** (it faces left, toward the
  teammate). Draw it once, facing right; the tile flips it.

### `cards.<phase>` and `teller`

```json
{ "icon": "★", "name": { "en": "Star power", "es": "Estrella" }, "color": "#fcd800" }
```

- `icon`: 1 to 4 characters, no control characters. One visible symbol reads best.
- `name`: 1 to 32 characters, either a plain string or one per language with `en`
  required and `es` optional. Other languages are dropped, not refused.
  The game shows the name in Orca's UI language and falls back to `en`.
- `color`: `#rrggbb`.
- `teller` is the same shape: the narrator whose card frames the lead's replies.

### `band`

```json
{ "gold": "#fcd800", "ink": "#000000", "panel": "#2038ec", "parchment": "#fcfcfc" }
```

`gold` is the highlighted chips (Team, Panel) and `ink` the text on them; `panel` is every
other chip and `parchment` the text on those. Keep `ink` on `gold` and `parchment` on `panel`
readable: aim for strong contrast (dark on light or light on dark).

### `hud` (optional)

```json
{
  "skyTop": "#5c94fc",
  "skyBottom": "#a4c8fc",
  "frame": "#c84c0c",
  "text": "#fcfcfc",
  "dim": "#fcd800",
  "star": "#fcfcfc"
}
```

The team band above the prompt (the party strip). All six keys are required when `hud` is
present. Without it the band keeps Quest's night sky and gold frame, so only the characters
and chips change: include `hud` whenever the scene should look like itself everywhere.
`text` is the band's own text (the empty-party message, the hidden-teammates count) and `dim`
the second line under each teammate. The XP bar is drawn in `frame`, so `frame` must stand out
against the sky. Teammate names keep the game's state colors (working, idle, waiting).

### `finale` (optional)

```json
{ "en": "★ COURSE CLEAR ★", "es": "★ NIVEL SUPERADO ★" }
```

1 to 24 characters, painted into the pixel art, so only width-1 characters: Latin letters
and accents, digits, punctuation, box drawing and block characters, `★` and card suits.
CJK characters and emoji are refused. A plain string or per-language object.

### `cast` (optional)

```json
{
  "pet": {
    "name": { "en": "Wolf", "es": "Lobo" },
    "frames": [
      ["W...W", "WWWWW", "WEWEW", ".WWW.", ".W.W."],
      ["W...W", "WWWWW", "WEWEW", ".WWW.", "W...W"]
    ],
    "happy": ["W...W", "WWWWW", "WHWHW", ".WWW.", ".W.W."],
    "colors": { "W": "#d8d8d8", "E": "#1a1a1a", "H": "#ff5a8a" }
  },
  "advisor": {
    "name": "Golem",
    "frames": [[".GGG.", "GEGEG", "GGGGG", "G.G.G", ".G.G."]],
    "gestures": { "escalated": [".GGG.", "GRGRG", "GGGGG", "GGG.G", ".G.G."] },
    "colors": { "G": "#b8b8b0", "E": "#d83a2e", "R": "#ff3b3b" }
  }
}
```

- `pet` walks behind the lead (in hd right behind it, the party behind the pet) and is what
  **♥ Pet** hearts; its `name` labels the button
  (`♥ Pet Wolf`). Without a pet, Pet hearts the lead's own character, so a scene whose lead is
  not Clawd (a licensed hero, a mascot) should bring one. `frames` are 1 to 4 walking frames,
  `happy` the frame shown while petted.
- `advisor` stands at the right edge and acts out Jev's decisions while Jev runs in the pane:
  arrows for a lowered or raised model, a yellow card for doubt, a red card for an escalation,
  a stopwatch and flags for CI, a stop sign when the gate stops a command. It also comes in,
  with or without Jev, while Claude consults its advisor tool: a thought cloud for the whole
  call, then a lit bulb when the advice is back. The game draws those props; the scene only
  dresses the body. `frames` are 1 to 4 idle frames; optional `gestures` replaces the body for
  one gesture (`lowered`, `raised`, `approved`, `unsure`, `escalated`, `ciRunning`, `ciPassed`,
  `ciFailed`, `stopped`, `consulting`, `advised`). A `stopped` body that raises a hand on the
  left reads best. Without an advisor the game draws a referee.
- A frame is 1 to 7 rows, every row the same width, 1 to 10 printable ASCII glyphs; every
  frame of one member is the size of the first. `.` is transparent; every other glyph needs a
  color. Frames are drawn as written, never mirrored: draw the **pet facing right**, the way
  the hero walks (it follows on the hero's left), and the **advisor facing left**, toward the
  lead (it stands at the right edge and holds its props out on its left).
- An invalid `pet` or `advisor` is left out with a warning and the rest of the scene still
  draws, but `validate` reports it: fix it before you report.

### `roster` (optional)

```json
[
  "Mario",
  {
    "name": "Luigi",
    "variant": { "colors": { "C": "#2e7d4f" }, "accessory": "cape", "accessoryColor": "#7fd36a" }
  },
  {
    "name": { "en": "Peach", "es": "Melocotón" },
    "costumes": { "working": { "rows": ["…"], "legs": ["…"], "colors": {} } }
  }
]
```

1 to 24 entries. Each member a lead launches takes the first name no live member holds and keeps
it until it is released; the ticket stays next to it (`Mario · CIN-12 Cartelera`). Once every
name is taken, members are named after their ticket only. A name is 1 to 32 characters, a plain
string or per-language object, must not look like a ticket id (`K-9`), contain `·`, or repeat.

An entry is a plain name, drawn in the phase costumes, or an object with `name` and one look:

- `variant`: the phase costumes with changes, at least one of:
  - `colors`: glyph → color, laid over every phase's `colors`. Only glyphs some costume draws.
  - `accessory`: `crown`, `halo`, `horns`, `antenna`, `bow`, `feather` or `cape`, drawn on the
    empty cells around the head, so it never covers the costume. `accessoryColor` sets its color.
- `costumes`: a costume of its own for **every** phase, in the shape above.

Set a `variant` or `costumes`, not both. An invalid roster is left out with a warning and the
scene still draws; the project's `orchestratorGame.orchestrator.memberNames` replaces the names.

### `themes` (optional)

```json
[{ "name": { "en": "Autumn", "es": "Otoño" }, "weight": 0.4, "look": { "near": "#b8742f" } }]
```

1 to 8 palette variants. Each `look` sets any of the look colors (`skyTop`, `skyBottom`, `sun`,
`far`, `snow`, `near`, `ground`, `plant`, `cloud`), at least one; every phase's own color is
mixed `weight` (0 to 1) of the way toward it, so 1 replaces it and 0.3 tints it. The band takes
turns by calendar day, on the project's timezone: one day the plain looks, the next each theme
in order, then the plain looks again. Keep the layer contrast in mind: a `far` close to the sky
is pushed apart from it like any other. An invalid `themes` is left out with a warning and the
scene still draws in its plain looks.

## Common problems

| Validate says                                                     | Fix                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `…rows.N: must be ten printable ASCII glyphs`                     | Count the row: exactly 10 characters, no spaces or accents            |
| `…colors: glyph "X" has no color`                                 | Add `"X": "#rrggbb"` to that costume's `colors`                       |
| `…: must be a #rrggbb color or an integer…`                       | Six hex digits with `#`, or an integer                                |
| `cards.<phase>.color: must be a #rrggbb color`                    | Cards, teller and band take `#rrggbb` strings only                    |
| `looks.<phase>: Invalid input: expected object…`                  | A phase is missing: all six of `working docs build verify pr handoff` |
| `…name: Too big: expected string to have <=32 characters`         | Shorten it (each language separately)                                 |
| `finale…: must be width-1 characters…`                            | Remove emoji and CJK characters from the finale                       |
| `cast.<member>…: every row of a frame must be the same width`     | Pad the short rows with `.`                                           |
| `cast.<member>.frames: every frame must be the size of the first` | Same width and height for every frame, `happy` and gesture            |
| `roster.N.variant.colors: glyph "X" is in no costume`             | Recolor only glyphs a `costumes.<phase>.colors` lists                 |
| `roster.N: set a variant or costumes, not both`                   | Keep one look per entry                                               |
| `roster.N.variant: must set colors or an accessory`               | Give the variant a palette, an accessory or both                      |
| `not valid JSON`                                                  | Trailing comma, missing quote or comment: JSON allows none            |

If the game still draws Quest after `validate` passes: check the path in Settings or
`orca.yaml` (relative to the project root, exact case), that project Settings is not
overriding `orca.yaml`, and read the band's note or `orca game state --json` `warnings`.

## Quality bar

- Every phase should be recognizably different (costume colors and the world) so the user
  can tell at a glance what each teammate is doing.
- Name cards in the scene's own voice, short enough to read on a narrow pane.
- Give the roster at least 10 names, each a character of its own, so a team in one phase never
  looks like clones.
- Include `hud`, `foe` and `finale`: a scene without them only half changes the game. Add a
  `cast` pet whenever the lead is not Clawd, or Pet hearts the lead.
- Give every costume, pet and advisor one dark color (eyes, hair, boots): hd inks its outline
  from it, and without one the figure blurs into a light sky.
- In hd a narrow pane closes the party up behind the hero, and only the teammates that fit whole
  are drawn: at 60 columns with an advisor, usually two walking (with a pet) and one sitting by
  the fire. That is the layout, not your scene.
- Before reporting, validate, then look at it with `/quest demo` in a pane, in classic and in
  `/quest render hd` (or, without a pane, at the [captures](#looking-at-it-without-a-pane)),
  and describe what you saw. A file that validates can still be ugly; the check is looking at it.
