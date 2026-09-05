import { defineConfig } from 'vitest/config'

const vitestOxcConfig = { tsconfig: false } as never

// Why: react-native ships Flow source that OXC cannot transform, so the node
// project mocks it wholesale. This project mounts components for real through
// react-native-web so drawer/modal/gesture behaviour is exercised, not stubbed.
export default defineConfig({
  root: import.meta.dirname,
  oxc: vitestOxcConfig,
  resolve: {
    mainFields: ['module', 'main'],
    // Why: RN libraries pick their web implementation by `.web.*` extension, which Metro
    // resolves and Vite does not.
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.mjs', '.js', '.json'],
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      {
        find: /^react-native-reanimated$/,
        replacement: new URL('./test-doubles/reanimated-published-mock.mjs', import.meta.url)
          .pathname
      }
    ]
  },
  define: { __DEV__: 'false' },
  test: {
    name: 'render',
    environment: 'happy-dom',
    // Why: a zero-sized window makes useWindowDimensions size every sheet to a negative height.
    environmentOptions: { happyDOM: { width: 390, height: 844 } },
    setupFiles: ['./vitest.render.setup.ts'],
    include: ['src/**/*.render.test.tsx'],
    // Why: react-native-web's BackHandler shim logs on every subscribe; the drawer subscribes by
    // design. Root-only option: under `pnpm test` the root config's filter applies instead.
    onConsoleLog: (log) => !log.includes('BackHandler is not supported on web'),
    server: {
      deps: {
        inline: [
          /react-native-gesture-handler/,
          /react-native-safe-area-context/,
          /react-native-reanimated/,
          /react-native-worklets/
        ]
      }
    }
  }
})
