import { create } from 'zustand'
import type { GameOwnerQuestionHost } from './game-owner-questions-across-hosts'

/** The Inbox state the whole window shares: every host's open questions and whether the sheet is open. */
type GameInboxAppState = {
  hosts: GameOwnerQuestionHost[]
  open: boolean
  setHosts: (hosts: GameOwnerQuestionHost[]) => void
  setOpen: (open: boolean) => void
}

export const useGameInboxAppState = create<GameInboxAppState>((set) => ({
  hosts: [],
  open: false,
  setHosts: (hosts) => set({ hosts }),
  setOpen: (open) => set({ open })
}))
