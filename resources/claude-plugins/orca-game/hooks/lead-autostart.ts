import type { EngineInterface } from 'claude-code'

import { refresh, viewOf } from './fleet-sync'
import { LEAD_SKILL, isLeadAutostart } from './game-lead'

export const STARTED_KEY = 'lead-started-sessions'
const STARTED_MAX = 50

export const startedOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

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
