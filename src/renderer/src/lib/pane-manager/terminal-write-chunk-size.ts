/**
 * The largest string Orca hands xterm in one `write`, in characters.
 *
 * Derived, not chosen. `WriteBuffer._innerWrite` checks its 12ms budget only
 * BETWEEN elements, so an element that overruns the budget cannot be cut at all
 * — the check arrives after it. Measured parse throughput for PTY output is
 * 5.7-28.5 MB/s (ORCA-251, runs 31971270025 and 31972534074: live panes, a bare
 * DOM terminal and a DOM-less one, on CI and locally). At the slowest of those
 * 16 KiB parses in ~2.9ms, so a chunk this size leaves xterm's budget doing the
 * yielding instead of being blown past by one element.
 */
export const TERMINAL_WRITE_CHUNK_CHARS = 16 * 1024
