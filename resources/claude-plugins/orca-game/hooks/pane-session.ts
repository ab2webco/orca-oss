import type { EngineInterface } from 'claude-code'

// Module state: a /clear gives the session a new id, never a new pane.
let owned: Promise<boolean> | undefined

async function claim($: EngineInterface): Promise<boolean> {
  const [mark, session] = await Promise.all([
    $.env.get('ORCA_GAME_PANE_SESSION').catch(() => undefined),
    $.session.id().catch(() => undefined)
  ])
  if (mark === undefined || mark === '') {
    // Why env: every process this one starts inherits it, a claude run from its Bash tool too.
    if (session !== undefined) {
      await $.env.set('ORCA_GAME_PANE_SESSION', session).catch(() => undefined)
    }
    return true
  }
  return mark === session
}

/**
 * Whether this is the session Orca launched in the pane, not a claude started inside it, which
 * inherits the pane's ORCA_GAME_ROLE and handle; the first session marks the env (ORCA-1351).
 */
export function isPaneSession($: EngineInterface): Promise<boolean> {
  owned ??= claim($)
  return owned
}
