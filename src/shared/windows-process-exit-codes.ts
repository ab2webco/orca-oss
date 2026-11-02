// Why: Electron hands Windows exit codes over as signed ints (-36861), which hides
// NTSTATUS and Crashpad codes that are only recognizable in hex.
const KNOWN_WINDOWS_EXIT_CODES: ReadonlyMap<number, string> = new Map([
  // crashpad/util/win/termination_codes.h
  [0xffff7001, 'crashpad-crash-no-dump'],
  [0xffff7002, 'crashpad-snapshot-failed'],
  // Why: Chromium requested a dump (e.g. a fault in V8 JIT code) in a process
  // never registered with a Crashpad handler, so the real exception code is lost.
  [0xffff7003, 'crashpad-not-connected-to-handler'],
  [0xc0000005, 'access-violation'],
  [0xc000001d, 'illegal-instruction'],
  [0xc00000fd, 'stack-overflow'],
  [0xc0000409, 'stack-buffer-overrun'],
  [0x80000003, 'breakpoint'],
  // base::win::kOomExceptionCode
  [0xe0000008, 'chromium-out-of-memory']
])

// Status codes carry severity bits in the top nibble; ordinary exits stay small.
const MIN_STATUS_CODE = 0x40000000

export function describeWindowsProcessExitCode(exitCode: number): string | null {
  const unsigned = exitCode >>> 0
  if (unsigned < MIN_STATUS_CODE) {
    return null
  }
  const hex = `0x${unsigned.toString(16).toUpperCase().padStart(8, '0')}`
  const name = KNOWN_WINDOWS_EXIT_CODES.get(unsigned)
  return name ? `${hex} ${name}` : hex
}
