# ORCA-1302 #1403: camera, collision, seating and lift

In-app captures from `tests/e2e/team-office-3d.spec.ts`, one approved run on head 78665e30e (1 passed, 1.2 min, WebGL on):

- `camera-*.png`: Follow the lead (the default), Show all, a drag pan, a Ctrl+wheel zoom, then Follow the lead again.
- `office-<width>-<high|low>-<theme>.png`: panel 219, 320, 350, 410 and 600, plus the large view (measured 219/319/349/409/599/1119), both themes. `high` is Illustrated (3D); `low` is Low resources, today's 2D Office.

`follow-ride/`: the running scene in Follow the lead, drawn at 30 fps with a frame every 0.5 s from 6 to 16 s, at a 410×760 panel. The lead presses the call panel, boards, rides up and walks to the asker; the camera rises with it. Rendered from the isolated harness on head 6b6c1e6d9, which adds the clamp that keeps the followed frame inside the building. Before the clamp, at 410 the bottom half of the frame was empty under a lead on the ground floor.

Shadows were seen only in software rendering (SwiftShader in the harness), plus this one run on this Mac's GPU. They have not been checked on another GPU.
