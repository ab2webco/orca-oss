// Why: reanimated's published mock assigns `module.exports`, so Vite's ESM interop
// hands `import Animated from 'react-native-reanimated'` the whole module. Plain JS:
// its TS entry drags reanimated's internals into `tsc` and its compiled build ships no types.
import * as published from 'react-native-reanimated/lib/module/mock'

export * from 'react-native-reanimated/lib/module/mock'
export default published.default.default
