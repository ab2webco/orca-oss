# ORCA-1302 · Office 3D, design pass

Prototype: `prototype/office-3d-orca-1302.html` (one file, three.js r128 from cdnjs, the same pinned build the
approved ORCA-1296 diorama uses). Open it in a browser; no build step. Demo data lives only in the prototype.

It reuses the diorama's material kit, toon shading with ink outlines, lighting, orthographic camera, palette and
`makeUnit` figures (at 1.6x), and its quality toggle: Ilustrada (toon + outline + shadows) and Bajos recursos
(the diorama's low-poly Lambert figures, no shadows, 1x pixel ratio, ~30 fps).

## What it shows, against today's 2D Office

| 2D Office today | 3D prototype |
| --- | --- |
| One floor per machine (building) | One loft floor per host, stacked over a glass elevator; label `host · used/cap` or `sin conexión` |
| Unreachable host | Floor desaturated under haze; its members drawn see-through; screens show static |
| Desks of other sessions (taken) / free cap | Coat over the chair, standby screen / empty desk with the chair pushed in |
| Monitor per desk phase: plan, tests, checks, review (approved, changes, waiting), queue #n, code | Same screens, same palette, on a live canvas texture |
| Red CI: bug hops on the screen, desk shakes | Same bug and red glow, desk jitters |
| Task board over each desk (stage 0-4, red card when broken, star when done) | Same board on the wall above each desk |
| Plaques of merged work | Star plaques on the lead floor's back wall; a merge adds one |
| Launch STOP | STOP sign by the lead's corner |
| Poses: typing, raise hand, cheer, done, slumped (limited/asleep/blocked) | Same poses on the diorama figures |
| Plays when resting: music, sketch, paper plane, game | Headphones + notes, sketch pad, paper plane flight, game pad + game screen |
| Holds: limited, asleep, loggedOut, unreachable, queued, starting | Hourglass, standby + zz, lock, static + faded, clock with empty chair, boot bar |
| Emotes: alert, prompt, check, star, heart, blocked | Same marks in Orca's status colours |
| Lead rounds, attends who needs you, rides to other floors | Lead walks its floor, attends asking members first, rides the elevator to other floors |
| Jev decisions, verdict flights | Jev at the lead floor's window with a clipboard; speaks and sends a plane in the verdict's colour |
| Steward model change | Steward appears beside the member and says the pick |
| Arrivals / departures | New member rides the elevator and walks to a free desk; a leaving one walks back and vanishes |
| Hover label and click target | Hover shows name + state + host; click says which terminal it would open |

## Captures

- `office-{1440,768,390,320}-{light,dark}-{toon,lite}.png`: the whole page at each width, theme and quality.
- `moments/`: the sample flow step by step (arrive, work, needs you, hand-in, merge) in both themes,
  the elevator ride, hover label, 5 machines × 8 members, one member at 390, and Panel 219 inside a 320 page.
