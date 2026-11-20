# ORCA-1302 · Office 3D, design pass

Prototype: `prototype/office-3d-orca-1302.html` (one file, `<meta charset="utf-8">`, three.js r128 from cdnjs, the
same pinned build the approved ORCA-1296 diorama uses). Open it in a browser; no build step. Demo data lives only in
the prototype.

## Owner's round 2 (2026-11-20)

- **Office developers, not the diorama's characters.** Original devs in sweaters on the diorama's toon kit (toon
  shading, ink outline, same proportions so every pose fits): 12 sweater colours, six knits (stripe, plain, cardigan,
  roll neck, two bands, shirt collar), eight hairstyles including a beanie, glasses, beards, varied trousers and shoes.
- **The lead stands out at a glance.** Violet coat over a black roll neck, a headset, and a violet chevron over the
  head that keeps a minimum on-screen size, so it still reads at Panel 219.
- **The lead's office ("gerencia").** A glass office beside the lead's floor with its door sign, a desk facing the
  room with a LEAD plate, a bookshelf, two guest chairs and a rug. The lead works there, walks out through the door to
  whoever needs you (riding the elevator to another floor if needed), and returns.
- **Jev in a control room.** A balcony over the back of the lead's office with a video wall of every member in Orca's
  status colours ("N te necesitan"), three console monitors, and Jev in a headset at the console.
- **Low resources keeps today's Office.** It is not a lighter 3D mode: in the product it keeps the current 2D Office
  renderer unchanged. The prototype's toggle says so and draws nothing.
- **Accents fixed:** the file now declares UTF-8.

## What it shows, against today's 2D Office

| 2D Office today | 3D prototype (Illustrated) |
| --- | --- |
| One floor per machine (building) | One loft floor per host, stacked over a glass elevator; label `host · used/cap` or `sin conexión` |
| Unreachable host | Floor desaturated under haze; its members drawn see-through; screens show static |
| Desks of other sessions (taken) / free cap | Coat over the chair, standby screen / empty desk with the chair pushed in |
| Monitor per desk phase: plan, tests, checks, review (approved, changes, waiting), queue #n, code | Same screens, same palette, on a live canvas texture |
| Red CI: bug hops on the screen, desk shakes | Same bug and red glow, desk jitters |
| Task board over each desk (stage 0-4, red card when broken, star when done) | Same board on the wall above each desk |
| Plaques of merged work | Star plaques on the lead floor's back wall; a merge adds one |
| Launch STOP | STOP sign on the lead's floor |
| Poses: typing, raise hand, cheer, done, slumped (limited/asleep/blocked) | Same poses on the devs |
| Plays when resting: music, sketch, paper plane, game | Headphones + notes, sketch pad, paper plane flight, game pad + game screen |
| Holds: limited, asleep, loggedOut, unreachable, queued, starting | Hourglass, standby + zz, lock, static + faded, clock with empty chair, boot bar |
| Emotes: alert, prompt, check, star, heart, blocked | Same marks in Orca's status colours |
| Lead rounds, attends who needs you, rides to other floors | Lead works in its office, walks out to whoever needs you first, rides the elevator, hands work round |
| Jev decisions, verdict flights | Jev at the control-room console; speaks and sends a plane in the verdict's colour |
| Steward model change | Steward (a dev with a tablet) appears beside the member and says the pick |
| Arrivals / departures | New member rides the elevator and walks to a free desk; a leaving one walks back and vanishes |
| Hover label and click target | Hover shows name + state + host; click says which terminal it would open |

## Captures (Illustrated only)

- `office-{1440,768,390,320}-{light,dark}.png`: the whole page at each width and theme.
- `moments/`: the sample flow step by step (arrive, work, needs you, hand-in, merge) in both themes, the elevator
  ride, hover label, 5 machines × 8 members, one member at 390, Panel 219 in both themes, close-ups of the devs and of
  the lead's office with the control room in both themes, and the Low resources note.
