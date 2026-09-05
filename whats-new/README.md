# Update nudge

`nudge.json` is what older installs poll to learn a new lab release exists. The Lab Release
workflow rewrites it on every promoted release; never edit it by hand.

## Saying what the release brings

Before dispatching a release, write `whats-new/next-release.json` on `main`:

```json
{
  "headline": "Faster terminal start",
  "highlights": [
    "Tabs restore in half the time",
    "SSH panes keep their scrollback after a reconnect"
  ],
  "link": "https://github.com/ab2webco/orca-oss/releases/tag/v1.4.161-lab.1"
}
```

- `headline` — one line, at most 80 characters, what this release is for. Required.
- `highlights` — up to 3 distinct lines of at most 120 characters, each a result the user can
  see. Not commit subjects. Optional.
- `link` — https URL to the release page. Optional; defaults to the tag's release page.

The workflow validates the file before any build starts and fails the dispatch on a typo. On
promotion it embeds the content in `nudge.json`, stamped with the release version so the card
shows it only for that exact release, and deletes `next-release.json` in the same commit, so
nothing stale carries over. It reads the file as it was at dispatch: one written on `main`
while the release is still building is left alone for the next release. Without the file the
nudge ships as before, with no content, and the update card falls back to the release-notes
summary.
