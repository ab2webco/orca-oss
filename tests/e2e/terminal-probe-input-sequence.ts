export function buildFreshShellProbeInputSequence(command: string): readonly string[] {
  // Why: Windows ConPTY can echo a startup Ctrl+C as literal "^C", which
  // corrupts the following PowerShell command before the shell is ready.
  return [command]
}

export function buildSettledShellProbeInputSequence(
  command: string,
  platform: NodeJS.Platform = process.platform
): readonly string[] {
  // Why: Ctrl+U is a POSIX line-editor binding. A settled native Windows shell
  // needs a separate Ctrl+C so ConPTY cannot join it to the command as input.
  return platform === 'win32' ? ['\x03', command] : ['\x03\x15', command]
}

export function buildPendingLineDiscardInputSequence(command: string): readonly string[] {
  // Why no Ctrl+C: input that lands while the shell handles SIGINT is mangled — bash
  // re-inserts the discarded CSI-u remainder, zsh drops the command's first byte.
  return ['\x15', command]
}
