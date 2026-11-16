// The engine entry's first import: modules run in import order, so these are in place before any
// painter module's top-level code.
import { installTeamSceneEngineShims } from '../src/team-drawer/team-scene-webview-shims'

installTeamSceneEngineShims(window)
