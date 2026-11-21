# ORCA-1302 PR 5c: the Office in the app, Illustrated (3D) and Low resources (2D)

Captured by `tests/e2e/team-office-3d.spec.ts` in the real app (electron-headless, WebGL on), from the 5c branch at 511bf14fe (5b #1401 at 4ffcfa6a3 underneath). Team seeded by `openOfficeTeam`: four members on this computer, one on m2, one on gpu-box; the advisor has spoken on this computer only.

Widths: the scene's container measured 219, 319, 349 and 1119 px (`*.json`), named panel-219, panel-320, panel-350 and large. Both themes.

- `office-<width>-high-<theme>.png`: Illustrated, the 3D Office.
- `office-<width>-low-<theme>.png`: Low resources, today's 2D Office, unchanged.

The spec also asserts no panel overflow at each width and theme, that the 3D Office has 3 floors and moves, and that Low resources draws the 2D floors and no 3D canvas.

Known: at panel-350, the moment the lead rides the lift, its chevron touches the m2 label's left edge (the label sits beside the shaft). It is a passing overlap during the ride, not a placement over desks or members.
