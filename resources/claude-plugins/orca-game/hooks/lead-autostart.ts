import type { EngineInterface } from 'claude-code'

import { refresh, viewOf } from './fleet-sync'
import { LEAD_SKILL, isLeadAutostart } from './game-lead'
import { STARTED_KEY, startedOf } from './lead-started'

const STARTED_MAX = 50

/** Records that this session runs the lead rules; true when it already did. */
export async function markLeadStarted($: EngineInterface): Promise<boolean> {
  const session = await $.session.id()
  const started = startedOf(await $.store.get(STARTED_KEY).catch(() => undefined))
  if (started.includes(session)) {
    return true
  }
  await $.store.set(STARTED_KEY, [...started.slice(1 - STARTED_MAX), session])
  return false
}

/** Forgets this session as the lead: `game lead` named another pane instead. */
export async function unmarkLeadStarted($: EngineInterface): Promise<void> {
  const session = await $.session.id()
  const started = startedOf(await $.store.get(STARTED_KEY).catch(() => undefined))
  if (started.includes(session)) {
    await $.store.set(
      STARTED_KEY,
      started.filter((one) => one !== session)
    )
  }
}

/** Loads the lead rules once per session, in a project whose orca.yaml asks for it. */
export async function leadAutostart($: EngineInterface): Promise<void> {
  await refresh($)
  const { state } = await viewOf($)
  if (state === null || !isLeadAutostart(state)) {
    return
  }
  if (await markLeadStarted($)) {
    return
  }
  await $.command.run({ command: LEAD_SKILL, args: '' })
}
