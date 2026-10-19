import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_PLUGIN_DIR_PROBE_OUT_ENV,
  runClaudePluginDirProbeIfRequested
} from './claude-plugin-dir-probe'
import { ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION } from './orchestrator-game-launch'
import type { prepareOrchestratorGameLaunch } from './orchestrator-game-launch-context'

type Prepare = typeof prepareOrchestratorGameLaunch

function depsWith(prepare: Prepare) {
  return {
    prepare: vi.fn(prepare),
    writeReport: vi.fn(async (_path: string, _text: string) => undefined),
    exit: vi.fn((_code: number) => undefined)
  }
}

const env = { [CLAUDE_PLUGIN_DIR_PROBE_OUT_ENV]: '/tmp/probe.json' }

describe('runClaudePluginDirProbeIfRequested', () => {
  it('leaves a normal launch alone', async () => {
    const deps = depsWith(async () => ({ args: [], env: {} }))
    await expect(runClaudePluginDirProbeIfRequested({}, deps)).resolves.toBe(false)
    expect(deps.prepare).not.toHaveBeenCalled()
    expect(deps.exit).not.toHaveBeenCalled()
  })

  it('reports the plugin dirs the real launch path hands Claude, then exits', async () => {
    const deps = depsWith(async () => ({
      args: ['--plugin-dir', '/user-data/claude-plugins/orca-game-0123456789abcdef'],
      env: {}
    }))
    await expect(runClaudePluginDirProbeIfRequested(env, deps)).resolves.toBe(true)
    const request = deps.prepare.mock.calls[0][0]
    // Why: an injected pluginDir would skip the very resolution the release gate attests.
    expect('pluginDir' in request).toBe(false)
    expect(request.settings?.orchestratorGame?.mode).toBe('on')
    await expect(request.detectClaudeVersion?.()).resolves.toBe(
      ORCHESTRATOR_GAME_MIN_CLAUDE_VERSION
    )
    expect(deps.writeReport).toHaveBeenCalledWith(
      '/tmp/probe.json',
      JSON.stringify({ pluginDirs: ['/user-data/claude-plugins/orca-game-0123456789abcdef'] })
    )
    expect(deps.exit).toHaveBeenCalledWith(0)
  })

  it('reports an empty list rather than guessing when no plugin dir is handed over', async () => {
    const deps = depsWith(async () => ({ args: [], env: {} }))
    await runClaudePluginDirProbeIfRequested(env, deps)
    expect(deps.writeReport).toHaveBeenCalledWith('/tmp/probe.json', '{"pluginDirs":[]}')
    expect(deps.exit).toHaveBeenCalledWith(0)
  })

  it('reports a failed resolution and exits non-zero', async () => {
    const deps = depsWith(async () => {
      throw new Error('EACCES: userData is read-only')
    })
    await runClaudePluginDirProbeIfRequested(env, deps)
    expect(deps.writeReport).toHaveBeenCalledWith(
      '/tmp/probe.json',
      JSON.stringify({ error: 'EACCES: userData is read-only' })
    )
    expect(deps.exit).toHaveBeenCalledWith(1)
  })

  it('still exits when the report cannot be written', async () => {
    const deps = depsWith(async () => ({ args: [], env: {} }))
    deps.writeReport.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(runClaudePluginDirProbeIfRequested(env, deps)).resolves.toBe(true)
    expect(deps.exit).toHaveBeenCalledWith(1)
  })
})
