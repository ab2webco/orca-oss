import { writeFile } from 'node:fs/promises'
import { app } from 'electron'
import { ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION } from './orchestrator-game-launch'
import { prepareOrchestratorGameLaunch } from './orchestrator-game-launch-context'

// Why: the release gate (config/scripts/verify-packaged-claude-plugin-seal.mjs) launches the packaged
// app with this set to learn which plugin dirs it hands Claude, then checks the bundle's seal (ORCA-663).
export const CLAUDE_PLUGIN_DIR_PROBE_OUT_ENV = 'ORCA_CLAUDE_PLUGIN_DIR_PROBE_OUT'

type ProbeDeps = {
  prepare: typeof prepareOrchestratorGameLaunch
  writeReport: (path: string, text: string) => Promise<void>
  exit: (code: number) => void
}

const defaultDeps: ProbeDeps = {
  prepare: prepareOrchestratorGameLaunch,
  writeReport: (path, text) => writeFile(path, text),
  exit: (code) => app.exit(code)
}

function pluginDirsOf(args: string[]): string[] {
  return args.flatMap((arg, index) =>
    arg === '--plugin-dir' && index + 1 < args.length ? [args[index + 1]] : []
  )
}

/** Runs the real plugin-dir resolution, writes what it hands Claude, and exits; false when not requested. */
export async function runClaudePluginDirProbeIfRequested(
  env: NodeJS.ProcessEnv,
  deps: ProbeDeps = defaultDeps
): Promise<boolean> {
  const outPath = env[CLAUDE_PLUGIN_DIR_PROBE_OUT_ENV]
  if (!outPath) {
    return false
  }
  let report: { pluginDirs: string[] } | { error: string }
  try {
    const launch = await deps.prepare({
      settings: { orchestratorGame: { mode: 'on' } },
      repoId: null,
      worktreePath: null,
      orcaCli: null,
      systemLocale: 'en-US',
      // Why: the gate runner has no Claude Code; the oldest version that loads the plugin stands in.
      detectClaudeVersion: async () => ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION
    })
    report = { pluginDirs: pluginDirsOf(launch.args) }
  } catch (error) {
    report = { error: error instanceof Error ? error.message : String(error) }
  }
  // Why exit either way: a probe launch that outlives its report would boot the full app.
  const written = await deps.writeReport(outPath, JSON.stringify(report)).then(
    () => true,
    () => false
  )
  deps.exit(written && !('error' in report) ? 0 : 1)
  return true
}
