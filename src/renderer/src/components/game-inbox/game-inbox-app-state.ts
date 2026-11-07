import { create } from 'zustand'
import type { GameOwnerQuestionHost } from './game-owner-questions-across-hosts'

/** Every host's open owner questions, shared by the whole window. */
type GameInboxAppState = {
  hosts: GameOwnerQuestionHost[]
  setHosts: (hosts: GameOwnerQuestionHost[]) => void
}

export const useGameInboxAppState = create<GameInboxAppState>((set) => ({
  hosts: [],
  setHosts: (hosts) => set({ hosts })
}))
