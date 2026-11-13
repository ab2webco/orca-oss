import type { EngineInterface } from 'claude-code'

import { refresh, viewOf } from './fleet-sync'
import { LEAD_SKILL, isLeadAutostart } from './game-lead'
import { STARTED_KEY, isLeadStarted, startedOf } from './lead-started'

const STARTED_MAX = 50

// Why in memory: a restart is a new process, and each one must rearm its lead again.
const rearmed = new Set<string>()

/** Runs the lead skill once per session in this process, whichever start path gets here first (ORCA-1175). */
export async function rearmLeadOnce($: EngineInterface): Promise<void> {
  const session = await $.session.id()
  if (rearmed.has(session)) {
    return
  }
  rearmed.add(session)
  await $.command.run({ command: LEAD_SKILL, args: '' })
}

/**
 * A session that already ran the lead rules is a resumed one: it comes back as the lead, as its
 * classic.SessionStart hook would, since another plugin may never pass that hook on (ORCA-1175).
 */
export async function startOrRearmLead($: EngineInterface): Promise<void> {
  if (!(await isLeadStarted($))) {
    await leadAutostart($)
    return
  }
  await refresh($)
  const { state } = await viewOf($)
  if (state?.role === 'lead' && state.leadElsewhere === undefined) {
    await rearmLeadOnce($)
  }
}

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
  await rearmLeadOnce($)
}
