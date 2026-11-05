import childProcess, { type ChildProcess } from 'node:child_process'

// Why (ORCA-1066): Playwright drains Electron's stderr from spawn and releases app.whenReady
// before electron.launch returns, so a listener attached after launch loses main's startup logs.
export async function launchWithSpawnStderr<T>(
  launch: () => Promise<T>,
  processOf: (launched: T) => ChildProcess,
  onStderr: (chunk: string) => void
): Promise<T> {
  const spawned: { child: ChildProcess; chunks: string[]; onData: (chunk: Buffer) => void }[] = []
  let target: ChildProcess | null = null
  const originalSpawn = childProcess.spawn
  childProcess.spawn = ((...args: Parameters<typeof originalSpawn>) => {
    const child = originalSpawn(...args)
    const entry = {
      child,
      chunks: [] as string[],
      onData: (chunk: Buffer): void => {
        if (child === target) {
          onStderr(chunk.toString())
        } else if (target === null) {
          entry.chunks.push(chunk.toString())
        }
      }
    }
    child.stderr?.on('data', entry.onData)
    spawned.push(entry)
    return child
  }) as typeof originalSpawn
  let launched: T
  try {
    launched = await launch()
  } finally {
    childProcess.spawn = originalSpawn
  }
  const child = processOf(launched)
  const match = spawned.find((entry) => entry.child === child)
  for (const entry of spawned) {
    if (entry !== match) {
      entry.child.stderr?.off('data', entry.onData)
    }
  }
  if (!match) {
    throw new Error(
      'electron.launch did not spawn through child_process.spawn; stderr not captured'
    )
  }
  target = child
  for (const chunk of match.chunks) {
    onStderr(chunk)
  }
  return launched
}
