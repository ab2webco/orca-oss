import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { ArcadeTab } from './ArcadeTab'
import { conversationTabOf } from './arcade-conversation-tab'

/** The Arcade tab inside the editor surface: Esc shows Claude again, a finished run closes the tab. */
export function GameArcadeEditorTab({ file }: { file: OpenFile }): React.JSX.Element {
  const backToConversation = useCallback(() => {
    const state = useAppStore.getState()
    const target = conversationTabOf(state.unifiedTabsByWorktree[file.worktreeId] ?? [], file.id)
    if (target) {
      state.activateTab(target.id, { worktreeId: file.worktreeId })
    } else {
      state.setActiveTabTypeForWorktree(file.worktreeId, 'terminal')
    }
  }, [file.id, file.worktreeId])
  const done = useCallback(() => {
    backToConversation()
    useAppStore.getState().closeFile(file.id)
  }, [backToConversation, file.id])
  return <ArcadeTab isActive onBack={backToConversation} onDone={done} />
}
