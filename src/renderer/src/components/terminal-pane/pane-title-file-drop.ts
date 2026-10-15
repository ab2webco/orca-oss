import type { DragEvent, RefObject } from 'react'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { WORKSPACE_FILE_PATH_MIME, WORKSPACE_FILE_PATHS_MIME } from '@/lib/workspace-file-drag'
import type { PtyTransport } from './pty-transport'
import { handleInternalTerminalFileDrop } from './terminal-drop-handler'

function carriesWorkspaceFiles(event: DragEvent<HTMLElement>): boolean {
  return (
    event.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME) ||
    event.dataTransfer.types.includes(WORKSPACE_FILE_PATHS_MIME)
  )
}

/** Drag/drop handlers that let a pane title strip accept workspace files like the terminal does. */
export function createPaneTitleFileDropHandlers({
  paneId,
  tabId,
  worktreeId,
  cwd,
  managerRef,
  paneTransportsRef,
  onActivatePaneTitleInteraction
}: {
  paneId: number
  tabId: string
  worktreeId: string
  cwd: string
  managerRef: RefObject<PaneManager | null>
  paneTransportsRef: RefObject<Map<number, PtyTransport>>
  onActivatePaneTitleInteraction: (paneId: number) => void
}): {
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
} {
  return {
    onDragOver: (event) => {
      onActivatePaneTitleInteraction(paneId)
      if (carriesWorkspaceFiles(event)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
    },
    onDrop: (event) => {
      if (!carriesWorkspaceFiles(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onActivatePaneTitleInteraction(paneId)
      const manager = managerRef.current
      if (!manager) {
        return
      }
      void handleInternalTerminalFileDrop({
        manager,
        paneTransports: paneTransportsRef.current,
        worktreeId,
        tabId,
        cwd,
        dataTransfer: event.dataTransfer,
        dropTarget: event.target
      })
    }
  }
}
