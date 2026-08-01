// Escaping and transport encoding for commands Orca sends over SSH. Split out of
// ssh-connection-utils so that module stays about connecting, not quoting.

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

const REMOTE_COMMAND_CHUNK_MAX_BYTES = 1_024
const REMOTE_COMMAND_PRINTF_ESCAPED_BYTES = new Set([0x21, 0x27, 0x5c])

function encodeRemoteCommandForPrintf(command: string): string[] {
  const chunks: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const character of command) {
    const codePoint = character.codePointAt(0)!
    const isSafePrintableAscii =
      codePoint >= 0x20 && codePoint <= 0x7e && !REMOTE_COMMAND_PRINTF_ESCAPED_BYTES.has(codePoint)
    const encodedCharacter =
      codePoint > 0x7f || isSafePrintableAscii
        ? character
        : `\\0${codePoint.toString(8).padStart(3, '0')}`
    const encodedBytes = codePoint > 0x7f ? Buffer.byteLength(character) : encodedCharacter.length
    if (chunkBytes + encodedBytes > REMOTE_COMMAND_CHUNK_MAX_BYTES) {
      chunks.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += encodedCharacter
    chunkBytes += encodedBytes
  }
  chunks.push(chunk)
  return chunks
}

/** Wrap a POSIX snippet into one line that non-POSIX SSH login shells can forward. */
export function wrapRemoteCommandForPosixShell(command: string): string {
  // Why: csh/tcsh split multiline SSH exec strings before /bin/sh sees them.
  // POSIX printf rebuilds bounded argument chunks without consuming relay stdin.
  const encodedChunks = encodeRemoteCommandForPrintf(command)
  const decodeAndRun =
    'decoded=$(printf %b "$@" && printf _) || exit $?; ' +
    'decoded=${decoded%_}; exec /bin/sh -c "$decoded"'
  const chunkArguments = encodedChunks.map(shellEscape).join(' ')
  return `exec /bin/sh -c ${shellEscape(decodeAndRun)} orca-command ${chunkArguments}`
}

/** Quote for cmd.exe, where doubling is the only escape a bare argument honours. */
export function cmdEscape(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}
