// ─── Plain-text tail of an agent pane's live screen ─────────────────────────
// The dashboard grid shows what an agent is DOING, which is its terminal, not a
// prose summary of it. Text rather than ANSI because a cell is ~320px wide: an
// xterm must be built at the pty's real grid (80-240 cols) and scaled to fit,
// which is illegible at that size (ORCA-234).

/** A grid screen holds well under this; the cap keeps a malformed request from
 *  turning one IPC call into an unbounded fan of terminal reads. */
export const AGENT_TERMINAL_TAIL_MAX_PANES = 32
/** Ceiling on lines per pane. A cell renders under ten; the rest is headroom. */
export const AGENT_TERMINAL_TAIL_MAX_LINES = 24
export const AGENT_TERMINAL_TAIL_DEFAULT_LINES = 8
/** Per-line character ceiling. A 240-col pty line would otherwise cross IPC in
 *  full for every cell on every tick, to be clipped by CSS on arrival. */
export const AGENT_TERMINAL_TAIL_MAX_LINE_CHARS = 200

/** Why a reason and not an omission: "this pane has no terminal" and "Orca
 *  could not read the terminal" must never render identically (ORCA-191). */
export type AgentTerminalTailUnreadReason =
  /** No live pty behind the pane — it was closed or never spawned. */
  | 'pane-closed'
  /** A pty exists but neither main's emulator nor its host could be read. */
  | 'terminal-unreadable'

export type AgentTerminalTailReading =
  | { read: true; lines: string[] }
  | { read: false; reason: AgentTerminalTailUnreadReason }

export type AgentTerminalTailPtyReading = {
  ptyId: string
  tail: AgentTerminalTailReading
}

export type AgentTerminalTailRequest = {
  ptyIds: string[]
  lines?: number
}

export function clampAgentTerminalTailLines(requested: unknown): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return AGENT_TERMINAL_TAIL_DEFAULT_LINES
  }
  return Math.max(1, Math.min(AGENT_TERMINAL_TAIL_MAX_LINES, Math.floor(requested)))
}

/** Clips each line to the wire budget; the cell clips again for its own width. */
export function boundAgentTerminalTailLines(lines: readonly string[], limit: number): string[] {
  return lines
    .slice(-limit)
    .map((line) =>
      line.length > AGENT_TERMINAL_TAIL_MAX_LINE_CHARS
        ? line.slice(0, AGENT_TERMINAL_TAIL_MAX_LINE_CHARS)
        : line
    )
}
