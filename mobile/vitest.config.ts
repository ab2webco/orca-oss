import { configDefaults, defineConfig } from 'vitest/config'

const vitestOxcConfig = { tsconfig: false } as never

export default defineConfig({
  root: import.meta.dirname,
  // Why: the app tsconfig intentionally excludes tests; Vite 8's OXC transform
  // otherwise fails before Vitest can run the test modules.
  oxc: vitestOxcConfig,
  test: {
    // Why: root-only option, so it filters both projects; each line is expected noise, not a failure.
    onConsoleLog: (log) =>
      !log.includes('react-test-renderer is deprecated') &&
      !log.includes('BackHandler is not supported on web'),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          // .tsx too: component tests exist (react-test-renderer + mocked react-native) and were
          // silently never collected, so render-level regressions shipped untested.
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          // Why: *.render.test.tsx mount react-native-web for real and belong to the render project.
          exclude: [...configDefaults.exclude, 'src/**/*.render.test.tsx']
        }
      },
      './vitest.render.config.ts'
    ]
  }
})
