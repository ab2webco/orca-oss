import { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusIpcPayload
} from '../../shared/agent-status-types'
import { resolveMemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import { MEMORY_PRESSURE_CHANGED_CHANNEL } from '../ipc/memory-pressure'
import { collectMemorySnapshot } from './collector'
import { MemoryPressureMonitor, type MemoryPressurePopupRecord } from './memory-pressure-monitor'
import { rankMemoryPressurePanes } from './memory-pressure-panes'
import { readMemoryPressure } from './memory-pressure-reading'
import { listRegisteredPtys } from './pty-registry'

type MemoryPressureStore = Pick<
  Store,
  'getSettings' | 'onSettingsChanged' | 'getRepo' | 'getWorktreeMeta'
>

export type MemoryPressureAgentSource = {
  getStatusSnapshot: () => readonly Pick<
    AgentStatusIpcPayload,
    'paneKey' | 'connectionId' | 'providerSessionOnly' | 'receivedAt'
  >[]
}

type MemoryPressureRuntime = Pick<
  OrcaRuntimeService,
  'getPtyLastOutputAt' | 'listLocalAgentPtyIds' | 'getPtyIdForPaneKey'
>

export type MemoryPressurePopupLog = {
  push: (record: MemoryPressurePopupRecord) => void
  close: () => void
}

/** Local PTYs running an agent: hook and OSC status rows, plus agents known only from their title. */
function localAgentPtyIds(
  agents: MemoryPressureAgentSource,
  runtime: MemoryPressureRuntime,
  now: number
): Set<string> {
  const ptyIds = new Set(runtime.listLocalAgentPtyIds())
  for (const row of agents.getStatusSnapshot()) {
    // Why: an SSH agent's memory is on its host, resume-only rows are not live agents, and a
    // row outlives an agent that exited inside a still-open shell.
    if (
      row.connectionId !== null ||
      row.providerSessionOnly === true ||
      now - row.receivedAt > AGENT_STATUS_STALE_AFTER_MS
    ) {
      continue
    }
    const ptyId = runtime.getPtyIdForPaneKey(row.paneKey)
    if (ptyId) {
      ptyIds.add(ptyId)
    }
  }
  return ptyIds
}

export function createMemoryPressureService(
  store: MemoryPressureStore,
  runtime: MemoryPressureRuntime,
  agents: MemoryPressureAgentSource,
  popupLog: MemoryPressurePopupLog
): { monitor: MemoryPressureMonitor; dispose: () => void } {
  const monitor = new MemoryPressureMonitor({
    readPressure: () => readMemoryPressure(),
    // Why the shared collector: it coalesces with the Resource Manager's poll into one ps/top sweep.
    collectPanes: async () => {
      const snapshot = await collectMemorySnapshot(store)
      // Why: the collector keys sessions by registry session id, which can differ from the PTY id.
      const ptyIdBySession = new Map(
        listRegisteredPtys().map((pty) => [pty.sessionId ?? pty.ptyId, pty.ptyId])
      )
      return rankMemoryPressurePanes(
        snapshot,
        (sessionId) => {
          const ptyId = ptyIdBySession.get(sessionId) ?? sessionId
          return { ptyId, lastOutputAt: runtime.getPtyLastOutputAt(ptyId) }
        },
        localAgentPtyIds(agents, runtime, Date.now())
      )
    },
    getSettings: () => resolveMemoryPressureWarningSettings(store.getSettings()),
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(MEMORY_PRESSURE_CHANGED_CHANNEL, state)
        }
      }
    },
    countLocalAgentPanes: () => localAgentPtyIds(agents, runtime, Date.now()).size,
    recordPopup: (record) => popupLog.push(record)
  })
  const disposeSettings = store.onSettingsChanged((updates) => {
    if (
      'memoryPressureWarningEnabled' in updates ||
      'memoryPressureWarningThresholdPercent' in updates
    ) {
      monitor.applySettings()
      void monitor.tick()
    }
  })
  return {
    monitor,
    dispose: () => {
      disposeSettings()
      monitor.stop()
      popupLog.close()
    }
  }
}
