import type { EngineInterface } from 'claude-code'

import { cliInvocationOf } from './cli-invocation'
import { gameWatchArgvOf } from './game-config'

const DEBOUNCE_MS = 300
const RESTART_MS = 5000
// Why long: a host without `game watch` fails at once, and the poll still keeps the band current.
const UNSUPPORTED_RESTART_MS = 300000

type FleetLines = { ready: boolean; changes: number; rest: string }

/** What a piece of `orca game watch` output says, with a line it cut kept for the next piece. */
export const fleetLinesOf = (rest: string, text: string): FleetLines => {
  const lines = `${rest}${text}`.split('\n')
  const cut = lines.pop() ?? ''
  const words = lines.map((line) => line.trim().split(' ')[0])
  return {
    ready: words.includes('ready'),
    changes: words.filter((word) => word === 'fleet').length,
    rest: cut
  }
}

function sleep($: EngineInterface, ms: number): Promise<void> {
  return new Promise((resolve) => {
    $.clock.after(ms, resolve)
  })
}

/** Calls `onChange` once per burst of fleet changes Orca pushes, for the session's life. */
export async function watchFleet($: EngineInterface, onChange: () => void): Promise<void> {
  let isPending = false
  const changed = (): void => {
    if (isPending) {
      return
    }
    isPending = true
    $.clock.after(DEBOUNCE_MS, () => {
      isPending = false
      onChange()
    })
  }
  for (;;) {
    const argv = gameWatchArgvOf(await $.env.get('ORCA_GAME_CLI').catch(() => undefined))
    const comspec = await $.env.get('ComSpec').catch(() => undefined)
    const invocation = argv === undefined ? undefined : cliInvocationOf(argv, comspec)
    if (invocation === undefined) {
      return
    }
    let isReady = false
    let rest = ''
    try {
      const child = $.process.spawn({ argv: invocation.argv, env: invocation.env })
      for await (const piece of child) {
        if (piece.stream !== 'stdout') {
          continue
        }
        const read = fleetLinesOf(rest, piece.text)
        rest = read.rest
        // Why on ready too: a restarted watch missed whatever changed while it was down.
        if (read.ready || read.changes > 0) {
          changed()
        }
        isReady ||= read.ready
      }
    } catch {
      // Falls through to a restart: Orca closed, restarted, or the module is unloading.
    }
    await sleep($, isReady ? RESTART_MS : UNSUPPORTED_RESTART_MS)
  }
}
