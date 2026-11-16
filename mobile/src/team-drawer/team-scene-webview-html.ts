import { colors } from '../theme/mobile-theme'
import { TEAM_SCENE_ENGINE_JS } from './team-scene-webview-engine.generated'
import { TEAM_SCENE_CANVAS_ID } from './team-scene-webview-messages'

/**
 * The Team band's WebView document: one canvas and the engine, which posts `ready` and then draws
 * what the app sends. Built once; the team arrives by postMessage, never by a new document.
 */
export const TEAM_SCENE_WEBVIEW_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${colors.bgBase}; }
  #${TEAM_SCENE_CANVAS_ID} { display: block; width: 100%; image-rendering: pixelated; }
</style>
</head>
<body>
<canvas id="${TEAM_SCENE_CANVAS_ID}"></canvas>
<script>${TEAM_SCENE_ENGINE_JS}</script>
</body>
</html>`
