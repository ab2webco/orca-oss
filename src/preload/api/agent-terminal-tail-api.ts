import type { AgentTerminalTailPtyReading } from '../../shared/agent-terminal-tail'

export type AgentTerminalTailApi = {
  /** Batch ptyId → plain-text tail of each pane's live screen. One call per
   *  tick for the whole grid; main reads the emulator it already keeps. */
  readPtys: (ptyIds: string[], lines?: number) => Promise<AgentTerminalTailPtyReading[]>
}
