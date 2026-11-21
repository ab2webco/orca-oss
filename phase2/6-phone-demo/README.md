# ORCA-1302 PR 6: the phone band demo, one floor at a time

`office-phone-band-demo.html` is self-contained (one file, no network). Open it in any browser, best at phone width or with the device toolbar at 390 px.

The band draws the 3D Office as `office3dStage` from #1401 plus 6b's single-floor layout (`office3dFloorOnly`). The chips under it switch floors. It opens on the floor where someone needs you. "Light / Dark" swaps the theme; `?theme=dark` opens dark.

- `phone-390-<floor>-<theme>.png`: still frames at t=9 s for each floor, both themes.

Sample team:
- Lead's machine: the lead, its office and its advisor's balcony.
- m2-studio: an asker and a red CI, with its own control room.
- gpu-box: offline, no control room.

The phone names the lead's floor "Lead's machine", because the phone is not that machine.
