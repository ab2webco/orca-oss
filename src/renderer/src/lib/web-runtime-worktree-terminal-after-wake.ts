import { useAppStore } from '@/store'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import {
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive,
  isWebTerminalSurfaceTabId
} from '@/runtime/web-runtime-session'
import { getLastKnownHostTerminalTabCount } from '@/runtime/web-session-tabs-sync'
import {
  beginWebRuntimeWakeTerminalRespawn,
  endWebRuntimeWakeTerminalRespawn
} from '@/runtime/web-runtime-wake-terminal-respawn'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  beginWebRuntimeInitialTerminalBootstrap,
  endWebRuntimeInitialTerminalBootstrap
} from '@/runtime/web-runtime-initial-terminal-bootstrap'

export function ensureWebRuntimeWorktreeTerminalAfterWake(worktreeId: string): void {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  if (!worktree) {
    return
  }
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktree.id)
  if (!runtimeEnvironmentId || !isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    return
  }

  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const hasLivePty = tabs.some((tab) => tabHasLivePty(state.ptyIdsByTabId, tab.id))
  if (hasLivePty) {
    return
  }

  const hasMirroredHostTabs = tabs.some((tab) => isWebTerminalSurfaceTabId(tab.id))
  if (hasMirroredHostTabs) {
    // Why: the host session still owns these tabs — wait for the mirror to repopulate PTY handles instead of duplicating a terminal.
    return
  }

  if (getLastKnownHostTerminalTabCount(runtimeEnvironmentId, worktreeId) > 0) {
    return
  }

  const { renderableTabCount } = state.reconcileWorktreeTabModel(worktreeId)
  if (tabs.length > 0 && renderableTabCount === 0) {
    return
  }

  // Why se separan los dos casos: con tabs esto es un DESPERTAR — dormir conserva
  // las filas y `terminal.stop` limpia las PTYs del host, asi que recrear la
  // superficie es el trabajo de esta funcion. Sin ninguna tab no hay nada que
  // despertar: o es la primera vez que se abre el workspace (y entonces si
  // corresponde una terminal), o el usuario las cerro todas — y ahi volver a
  // abrirle una es exactamente lo que pidio que dejara de pasar.
  const isEmptyWorkspace = tabs.length === 0

  if (!beginWebRuntimeWakeTerminalRespawn(worktreeId)) {
    return
  }
  // Why el reclamo es el unico guardia: es atomico, ya devuelve false cuando el
  // workspace tiene su marca, y lo comparte con el mirror de session tabs — los
  // dos caminos pueden correr en la misma activacion, y sin un reclamo comun
  // cada uno abriria la suya.
  if (
    isEmptyWorkspace &&
    !beginWebRuntimeInitialTerminalBootstrap(runtimeEnvironmentId, worktreeId)
  ) {
    endWebRuntimeWakeTerminalRespawn(worktreeId)
    return
  }

  void createWebRuntimeSessionTerminal({
    worktreeId,
    environmentId: runtimeEnvironmentId,
    activate: true,
    selectWorktree: false
  })
    .then((created) => {
      if (isEmptyWorkspace) {
        endWebRuntimeInitialTerminalBootstrap(runtimeEnvironmentId, worktreeId, {
          succeeded: created.status === 'created'
        })
      }
    })
    .finally(() => {
      endWebRuntimeWakeTerminalRespawn(worktreeId)
    })
}
