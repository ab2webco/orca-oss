# ORCA-1302 PR 5a: the 3D Office stage rendered in isolation

`office3dStage` from PR 5a (#1399, head 0836109c3), bundled on its own with esbuild and drawn into a bare canvas. No app chrome. Captured with Playwright (SwiftShader WebGL) at the container widths (panel 219, 320, 350, and the large view at 760) in both themes, deviceScaleFactor 2.

Fixture: three machines.
- This Mac: lead floor, three members (working, resting, done) and one desk taken by another session. Its advisor sits on the balcony over the lead's office.
- m2-studio: one member needs you and one has red CI. Its advisor has decided, so it gets a control room.
- gpu-box: offline, with a see-through member and haze. No advisor, so no control room.

Frame at t=9 s: the lead is at the lift door on its way up to m2-studio's asker.

Known gaps, deferred to 5b:
- no glass lift shaft yet; the cab is a bare slab;
- no status marks over heads;
- no lead marker.

Rebuild: `npx esbuild entry.ts --bundle --outfile=bundle.js --alias:@=<repo>/src/renderer/src`, then `node shoot.mjs`.
