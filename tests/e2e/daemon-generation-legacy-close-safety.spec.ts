import { fork, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type TestInfo } from '@playwright/test'
import { PROTOCOL_VERSION } from '../../src/main/daemon/types'
import {
  cleanupDaemonGenerationFixtures,
  createDaemonGenerationRuntime,
  launchDaemonGeneration,
  spawnGenerationCanary,
  type DaemonGeneration,
  type DaemonGenerationRuntime,
  type GenerationCanary
} from './helpers/daemon-generation-safety-fixtures'
import {
  processIdentityLiveness,
  recordProcessIdentity,
  recordProcessTree,
  terminateRecordedTree,
  waitForCondition
} from './helpers/daemon-generation-processes'

type LegacyCloseReport = {
  initiator: {
    clientKind: 'runtime'
    clientId: string
    pairedDeviceId: string
    connectionId: string
    callSite: string
    wireReason: null
  }
  observer: {
    clientKind: 'runtime'
    clientId: string
    pairedDeviceId: string
    connectionId: string
    requestCount: number
    closeRequestCount: number
  }
  observerBefore: Record<string, unknown>[]
  observerAfter: Record<string, unknown>[]
  postClosePing: Record<string, boolean>
  calls: Record<string, unknown>[]
  responses: Record<string, unknown>[]
}

function killEvents(generation: DaemonGeneration, sessionId: string): Record<string, unknown>[] {
  return generation
    .logEvents()
    .filter((event) => event.event === 'session-killed' && event.sessionId === sessionId)
}

function launchLegacyCloseClient(options: {
  runtime: DaemonGenerationRuntime
  generations: readonly DaemonGeneration[]
  targetCanaries: readonly GenerationCanary[]
}): {
  child: ChildProcess
  ready: Promise<LegacyCloseReport>
  finish(): void
  output(): string
} {
  const { runtime, generations, targetCanaries } = options
  const configPath = path.join(runtime.rootDir, 'legacy-close-client-config.json')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      generations: generations.map((generation) => ({
        protocolVersion: generation.protocolVersion,
        socketPath: generation.socketPath,
        tokenPath: generation.tokenPath
      })),
      currentProtocolVersion: PROTOCOL_VERSION,
      daemonDir: runtime.daemonDir,
      historyDir: path.join(runtime.userDataDir, 'terminal-history'),
      cwd: runtime.rootDir,
      sessions: targetCanaries.map((canary, index) => ({
        protocolVersion: canary.generation.protocolVersion,
        sessionId: canary.sessionId,
        rootPid: canary.rootIdentity.pid,
        worktreeId: canary.worktreeId,
        tabId: `legacy-close-tab-${index + 1}`
      }))
    })}\n`
  )
  let output = ''
  const child = fork(runtime.legacyCloseClientEntryPath, ['--config', configPath], {
    cwd: runtime.userDataDir,
    execPath: runtime.electronPath,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: path.join(process.cwd(), 'node_modules'),
      ORCA_USER_DATA_PATH: runtime.userDataDir
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-32_768)
  })
  const ready = new Promise<LegacyCloseReport>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Legacy close client timed out: ${output}`)),
      60_000
    )
    const settle = (callback: () => void): void => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      callback()
    }
    const onExit = (code: number | null): void =>
      settle(() => reject(new Error(`Legacy close client exited with ${code}: ${output}`)))
    const onMessage = (message: unknown): void => {
      const payload = message as LegacyCloseReport & { type?: string; message?: string }
      if (payload.type === 'error') {
        settle(() => reject(new Error(payload.message ?? 'Legacy close client failed')))
      } else if (payload.type === 'legacy-close-complete') {
        settle(() => resolve(payload))
      }
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })
  return {
    child,
    ready,
    finish: () => {
      if (child.connected) {
        child.send?.({ type: 'finish' }, () => {})
      }
    },
    output: () => output
  }
}

async function finishLegacyCloseClient(
  client: ReturnType<typeof launchLegacyCloseClient>
): Promise<void> {
  if (!client.child.pid || client.child.exitCode !== null) {
    return
  }
  const identity = await recordProcessIdentity(client.child.pid)
  client.finish()
  try {
    await waitForCondition('legacy close client exit', () => client.child.exitCode !== null, 2_000)
  } catch {
    await terminateRecordedTree(await recordProcessTree(identity))
  }
}

function writeReconstruction(options: {
  testInfo: TestInfo
  generations: readonly DaemonGeneration[]
  canaries: readonly GenerationCanary[]
  report: LegacyCloseReport
  targetSessionIds: ReadonlySet<string>
  before: Record<number, boolean>
  after: Record<number, boolean>
  postClosePing: Record<string, boolean>
}): void {
  const {
    testInfo,
    generations,
    canaries,
    report,
    targetSessionIds,
    before,
    after,
    postClosePing
  } = options
  writeFileSync(
    testInfo.outputPath('legacy-viewer-close-reconstruction.json'),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        invariant: 'A reasonless legacy viewer lifecycle echo cannot kill an authoritative PTY',
        authoritativeBoundary:
          report.calls.length > 0
            ? 'session.tabs.close -> closeMobileSessionTab -> RuntimeNotifier.closeTerminalTab'
            : 'session.tabs.close -> refuseUnattributedMobileSessionTabClose -> snapshot republish',
        initiator: report.initiator,
        observer: report.observer,
        observerBefore: report.observerBefore,
        observerAfter: report.observerAfter,
        requestOrder: report.responses.map((response, index) => ({
          sequence: index + 1,
          response,
          call: report.calls[index] ?? null
        })),
        sessions: canaries.map((canary, index) => ({
          sequence: index + 1,
          targeted: targetSessionIds.has(canary.sessionId),
          worktreeId: canary.worktreeId,
          sessionId: canary.sessionId,
          daemon: {
            label: canary.generation.label,
            protocolVersion: canary.generation.protocolVersion,
            pid: canary.generation.identity.pid,
            startedAtMs: canary.generation.identity.startedAtMs
          },
          root: {
            ...canary.rootIdentity,
            liveBefore: before[canary.rootIdentity.pid],
            liveAfter: after[canary.rootIdentity.pid]
          },
          descendant: {
            ...canary.descendantIdentity,
            liveBefore: before[canary.descendantIdentity.pid],
            liveAfter: after[canary.descendantIdentity.pid]
          },
          postClosePing: postClosePing[canary.sessionId],
          daemonKillEvents: killEvents(canary.generation, canary.sessionId)
        })),
        generations: generations.map((generation) => ({
          label: generation.label,
          protocolVersion: generation.protocolVersion,
          pid: generation.identity.pid
        }))
      },
      null,
      2
    )}\n`
  )
}

test('legacy viewer lifecycle echoes cannot burst-close live PTYs across worktrees and daemon generations', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires the fixture argument before testInfo.
{}, testInfo) => {
  test.setTimeout(120_000)
  const runtime = await createDaemonGenerationRuntime(testInfo)
  const generations: DaemonGeneration[] = []
  const canaries: GenerationCanary[] = []
  let client: ReturnType<typeof launchLegacyCloseClient> | null = null
  let assertionsComplete = false

  try {
    for (const protocolVersion of [PROTOCOL_VERSION - 1, PROTOCOL_VERSION]) {
      const generation = await launchDaemonGeneration({
        runtime,
        label: `legacy-close-v${protocolVersion}`,
        protocolVersion
      })
      generations.push(generation)
      canaries.push(
        await spawnGenerationCanary({
          runtime,
          generation,
          role: 'live',
          worktreeId: `legacy-close-worktree-v${protocolVersion}`
        })
      )
    }
    canaries.push(
      await spawnGenerationCanary({
        runtime,
        generation: generations[1]!,
        role: 'live',
        worktreeId: 'legacy-close-unrelated-worktree'
      })
    )
    const targetCanaries = canaries.slice(0, 2)
    const targetSessionIds = new Set(targetCanaries.map((canary) => canary.sessionId))
    const identities = canaries.flatMap((canary) => [
      canary.rootIdentity,
      canary.descendantIdentity
    ])
    const beforeMap = await processIdentityLiveness(identities)
    const before = Object.fromEntries(
      identities.map(({ pid }) => [pid, beforeMap.get(pid) === true])
    )
    expect(Object.values(before).every(Boolean)).toBe(true)

    client = launchLegacyCloseClient({ runtime, generations, targetCanaries })
    const report = await client.ready
    const afterMap = await processIdentityLiveness(identities)
    const after = Object.fromEntries(identities.map(({ pid }) => [pid, afterMap.get(pid) === true]))
    writeReconstruction({
      testInfo,
      generations,
      canaries,
      report,
      targetSessionIds,
      before,
      after,
      postClosePing: report.postClosePing
    })

    expect(report.initiator).toEqual({
      clientKind: 'runtime',
      clientId: 'legacy-viewer',
      pairedDeviceId: 'legacy-viewer',
      connectionId: 'legacy-viewer-generation-1',
      callSite: 'legacy-viewer:stale-pty-exit-cleanup',
      wireReason: null
    })
    expect(report.observer).toEqual({
      clientKind: 'runtime',
      clientId: 'current-viewer',
      pairedDeviceId: 'current-viewer',
      connectionId: 'current-viewer-generation-2',
      requestCount: targetCanaries.length * 2,
      closeRequestCount: 0
    })
    expect(report.observerBefore).toHaveLength(targetCanaries.length)
    expect(report.observerAfter).toHaveLength(targetCanaries.length)
    expect(
      [...report.observerBefore, ...report.observerAfter].every((response) => response.ok === true)
    ).toBe(true)
    expect(
      report.observerAfter.every((response, index) => {
        const result = response.result as { tabs?: { ptyId?: string | null }[] } | undefined
        return result?.tabs?.some((tab) => tab.ptyId === targetCanaries[index]!.sessionId) === true
      })
    ).toBe(true)
    expect(report.responses).toHaveLength(targetCanaries.length)
    expect(
      report.responses.every((response) => {
        const result = response.result as Record<string, unknown> | undefined
        return (
          response.ok === true &&
          result?.refused === true &&
          result.refusalReason === 'missing-intent' &&
          result.snapshotRepublished === true
        )
      })
    ).toBe(true)
    expect(report.calls).toHaveLength(0)
    expect(Object.values(after).every(Boolean)).toBe(true)
    expect(Object.values(report.postClosePing)).toHaveLength(targetCanaries.length)
    expect(Object.values(report.postClosePing).every(Boolean)).toBe(true)
    expect(
      canaries.every((canary) => killEvents(canary.generation, canary.sessionId).length === 0)
    ).toBe(true)
    assertionsComplete = true
  } finally {
    if (client) {
      await finishLegacyCloseClient(client)
    }
    if (!assertionsComplete) {
      runtime.retainDiagnostics(generations)
    }
    await cleanupDaemonGenerationFixtures({ generations, canaries })
    runtime.remove()
  }
})
