// Main's renderer delivery window (src/main/ipc/pty.ts). The renderer ACKs a chunk only when its
// output scheduler consumes it, so this window also bounds that scheduler's queue.
export const PTY_BATCH_FLUSH_CHUNK_CHARS = 16 * 1024
export const PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS = 512 * 1024
export const PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS = 8 * 1024 * 1024
export const PTY_RENDERER_INTERACTIVE_RESERVE_CHARS = 256 * 1024
// Why: reserve a bounded lane so an active pane's keystroke redraw reaches the renderer ahead of hidden bulk output's ACKs.
export const PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS = 512 * 1024
// Why + one chunk: the gate is checked before a send, so the last send lands up to a chunk past it.
// Transformed (SSH) payloads are indivisible and can exceed a chunk; local output never is.
export const PTY_RENDERER_MAX_IN_FLIGHT_CHARS =
  PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS +
  PTY_RENDERER_INTERACTIVE_RESERVE_CHARS +
  PTY_BATCH_FLUSH_CHUNK_CHARS
