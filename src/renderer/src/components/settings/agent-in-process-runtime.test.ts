import { describe, expect, it } from 'vitest'
import { AGENT_CATALOG } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  partitionAgentCatalogForPane,
  resolveAgentsPaneDetectionRuntime
} from './agent-in-process-runtime'

const TEAMS: TuiAgent = 'claude-agent-teams'

describe('resolveAgentsPaneDetectionRuntime', () => {
  it('detects no in-process runtime on macOS and Linux hosts', () => {
    expect(
      resolveAgentsPaneDetectionRuntime({
        hostIsWindows: false,
        activeServerEnvironmentId: null,
        localWindowsRuntimeDefault: { kind: 'windows-host' }
      })
    ).toBeNull()
  })

  it('uses win32 for a Windows host running on the Windows runtime', () => {
    expect(
      resolveAgentsPaneDetectionRuntime({
        hostIsWindows: true,
        activeServerEnvironmentId: null,
        localWindowsRuntimeDefault: { kind: 'windows-host' }
      })
    ).toBe('win32')
  })

  it('uses wsl for a Windows host whose local runtime is WSL', () => {
    expect(
      resolveAgentsPaneDetectionRuntime({
        hostIsWindows: true,
        activeServerEnvironmentId: null,
        localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' }
      })
    ).toBe('wsl')
  })

  it('keeps the default list for an active remote server, whose platform is unknown here', () => {
    expect(
      resolveAgentsPaneDetectionRuntime({
        hostIsWindows: true,
        activeServerEnvironmentId: 'env-1',
        localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' }
      })
    ).toBeNull()
  })
})

describe('partitionAgentCatalogForPane', () => {
  it('moves Claude Agent Teams to the in-process list on win32 and wsl', () => {
    for (const runtime of ['win32', 'wsl'] as const) {
      const partitioned = partitionAgentCatalogForPane({
        catalog: AGENT_CATALOG,
        detectedIds: new Set(['claude']),
        runtime
      })

      expect(partitioned.detected.map((agent) => agent.id)).toEqual(['claude'])
      expect(partitioned.inProcess.map((agent) => agent.id)).toEqual([TEAMS])
      expect(partitioned.available.map((agent) => agent.id)).not.toContain(TEAMS)
      expect(partitioned.available.length).toBe(AGENT_CATALOG.length - 2)
    }
  })

  it('keeps Claude Agent Teams in the install list on macOS and Linux', () => {
    const partitioned = partitionAgentCatalogForPane({
      catalog: AGENT_CATALOG,
      detectedIds: new Set(['claude']),
      runtime: null
    })

    expect(partitioned.inProcess).toEqual([])
    expect(partitioned.available.map((agent) => agent.id)).toContain(TEAMS)
  })

  it('lists nothing while detection is still in flight', () => {
    const partitioned = partitionAgentCatalogForPane({
      catalog: AGENT_CATALOG,
      detectedIds: null,
      runtime: 'win32'
    })

    expect(partitioned).toEqual({ detected: [], inProcess: [], available: [] })
  })
})
