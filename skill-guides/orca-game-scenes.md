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
   required block filled in, plus its team-band palette:

   ```text
   orca game scene new .orca/scenes/<name>.json
   ```

   It refuses to overwrite an existing file. Keep scenes under `.orca/scenes/` so Settings
   and `orca game scene list` find them. `<name>` is lowercase with dashes (`mario-bros`).

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

6. **Decide whether to commit it.** A scene in `.orca/scenes/` is shared when committed.
   A private scene (licensed characters, personal jokes) stays uncommitted: add `.orca/` to
   `.git/info/exclude`, not to `.gitignore`, so nothing about it reaches the repo.

`orca game scene list` shows the built-in scene ids and every file in `.orca/scenes/` with
its status, from any folder of the project.

## Format

Top level, all required unless marked optional:

| Key       | What it draws                                                                 |
| --------- | ----------------------------------------------------------------------------- |
| `looks`   | The world behind the lead, one per phase                                       |
| `costumes`| The character, one per phase                                                   |
| `cards`   | Each phase's card: icon, name, color (Fleet pane, captions)                    |
| `teller`  | The narrator card that frames replies                                          |
| `band`    | Colors of the chips under the band                                             |
| `foe`     | Optional. The costume a teammate with red CI trades turns with                 |
| `finale`  | Optional. Caption painted while a merge runs                                   |
| `hud`     | Optional. The team band's frame, sky and text colors                          |
| `cast`    | Optional. The scene's pet (what Pet hearts) and who stands for Jev            |

Unknown keys are ignored, so a scene written for a newer Orca still loads on an older one.
The file must be at most 64 KB.

### Phases

`looks`, `costumes` and `cards` each need all six phases, with exactly these keys:

| Phase     | When the game is in it                                                    |
| --------- | ------------------------------------------------------------------------- |
| `working` | Default: thinking, reading, any tool without a more specific phase         |
| `docs`    | Editing docs (`docs/`, `.md`, `.mdx`) or running a spec/plan/docs skill    |
| `build`   | Editing any other file, or an implement/build skill                        |
| `verify`  | Tests, lint, typecheck (vitest, jest, pytest, tsc, eslint, `npm test`…)    |
| `pr`      | `git push`, `gh pr create/edit/review`, `glab mr create/update`            |
| `handoff` | Merging (`gh pr merge`, `glab mr merge`) or moving the tracker ticket      |

### Colors

- Pixel colors (`looks`, costume `colors`, `hud`): `"#rrggbb"` or an integer 0–16777215.
  Six hex digits only: `#fe8`, `#ffee88ff` and color names like `"gold"` are refused.
- Card, teller and band colors: `"#rrggbb"` only, never integers.

### `looks.<phase>`

```json
{
  "skyTop": "#5c94fc", "skyBottom": "#a4c8fc", "sun": "#fcd800", "isNight": false,
  "far": "#80d010", "snow": "#fcfcfc", "near": "#00a800", "ground": "#c84c0c",
  "plant": "#00a800", "plantKind": "flower", "cloud": "#fcfcfc",
  "scenery": "meadow", "isSignal": false
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
  "colors": { "C": "#d82800", "H": "#883c00", "S": "#fca044", "E": "#000000",
              "R": "#d82800", "O": "#2038ec", "Y": "#fcd800" }
}
```

- Exactly **6** `rows` and **2** `legs`; every row is exactly **10** characters of printable
  ASCII (`!` to `~`). No spaces, no accents, no emoji: count the characters of each row.
- `.` is transparent. Every other glyph used in `rows` or `legs` needs an entry in `colors`
  (one ASCII character as key, `.` not allowed as a key).
- The two `legs` rows alternate while the character walks; make them differ slightly.
- Draw the head in the top rows and keep the figure inside the 10×8 box; the game adds the
  walk, the blink and the reactions.
- `foe` uses the same shape. It shows on a teammate whose CI is red, in turns with its own
  costume, and on its tile.

### `cards.<phase>` and `teller`

```json
{ "icon": "★", "name": { "en": "Star power", "es": "Estrella" }, "color": "#fcd800" }
```

- `icon`: 1 to 4 characters, no control characters. One visible symbol reads best.
- `name`: 1 to 32 characters, either a plain string or one per language with `en`
  required and `es`, `ja`, `ko`, `zh` optional. Other languages are dropped, not refused.
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
{ "skyTop": "#5c94fc", "skyBottom": "#a4c8fc", "frame": "#c84c0c",
  "text": "#fcfcfc", "dim": "#fcd800", "star": "#fcfcfc" }
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
Japanese, Korean, Chinese and emoji are refused. A plain string or per-language object.

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

- `pet` walks behind the lead and is what **♥ Pet** hearts; its `name` labels the button
  (`♥ Pet Wolf`). Without a pet, Pet hearts the lead's own character, so a scene whose lead is
  not Clawd (a licensed hero, a mascot) should bring one. `frames` are 1 to 4 walking frames,
  `happy` the frame shown while petted.
- `advisor` stands at the right edge and acts out Jev's decisions while Jev runs in the pane:
  arrows for a lowered or raised model, a yellow card for doubt, a red card for an escalation,
  a stopwatch and flags for CI. The game draws those props; the scene only dresses the body.
  `frames` are 1 to 4 idle frames; optional `gestures` replaces the body for one gesture
  (`lowered`, `raised`, `approved`, `unsure`, `escalated`, `ciRunning`, `ciPassed`,
  `ciFailed`). Without an advisor the game draws a referee.
- A frame is 1 to 7 rows, every row the same width, 1 to 10 printable ASCII glyphs; every
  frame of one member is the size of the first. `.` is transparent; every other glyph needs a
  color. Draw them facing left, toward the lead.
- An invalid `pet` or `advisor` is left out with a warning and the rest of the scene still
  draws, but `validate` reports it: fix it before you report.

## Common problems

| Validate says                                            | Fix                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `…rows.N: must be ten printable ASCII glyphs`            | Count the row: exactly 10 characters, no spaces or accents       |
| `…colors: glyph "X" has no color`                        | Add `"X": "#rrggbb"` to that costume's `colors`                  |
| `…: must be a #rrggbb color or an integer…`              | Six hex digits with `#`, or an integer                           |
| `cards.<phase>.color: must be a #rrggbb color`           | Cards, teller and band take `#rrggbb` strings only               |
| `looks.<phase>: Invalid input: expected object…`         | A phase is missing: all six of `working docs build verify pr handoff` |
| `…name: Too big: expected string to have <=32 characters`| Shorten it (each language separately)                            |
| `finale…: must be width-1 characters…`                   | Remove emoji and CJK characters from the finale                  |
| `cast.<member>…: every row of a frame must be the same width` | Pad the short rows with `.`                                 |
| `cast.<member>.frames: every frame must be the size of the first` | Same width and height for every frame, `happy` and gesture |
| `not valid JSON`                                         | Trailing comma, missing quote or comment: JSON allows none       |

If the game still draws Quest after `validate` passes: check the path in Settings or
`orca.yaml` (relative to the project root, exact case), that project Settings is not
overriding `orca.yaml`, and read the band's note or `orca game state --json` `warnings`.

## Quality bar

- Every phase should be recognizably different (costume colors and the world) so the user
  can tell at a glance what each teammate is doing.
- Name cards in the scene's own voice, short enough to read on a narrow pane.
- Include `hud`, `foe` and `finale`: a scene without them only half changes the game. Add a
  `cast` pet whenever the lead is not Clawd, or Pet hearts the lead.
- Give every costume, pet and advisor one dark color (eyes, hair, boots): hd inks its outline
  from it, and without one the figure blurs into a light sky.
- Before reporting, validate, then look at it with `/quest demo` in a pane, in classic and in
  `/quest render hd`, and describe what you saw. A file that validates can still be ugly; the check is looking at it.
