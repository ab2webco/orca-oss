import type { EngineInterface, On } from 'claude-code'

import { viewOf } from './fleet-sync'
import { LEAD_SKILL, leadRenameOf, type LeadNameRecord } from './game-lead'
import { markLeadStarted } from './lead-autostart'
import { STARTED_KEY, startedOf } from './lead-started'

const NAMES_KEY = 'lead-session-names'
const NAMES_MAX = 50

type Records = Record<string, LeadNameRecord>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordsOf = (value: unknown): Records =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([session, one]): [string, LeadNameRecord][] =>
          isRecord(one)
            ? [
                [
                  session,
                  {
                    ...(typeof one.applied === 'string' ? { applied: one.applied } : {}),
                    ...(one.isPersonNamed === true ? { isPersonNamed: true } : {})
                  }
                ]
              ]
            : []
        )
      )
    : {}

async function saveRecord($: EngineInterface, session: string, record: LeadNameRecord) {
  const records = recordsOf(await $.store.get(NAMES_KEY).catch(() => undefined))
  delete records[session]
  const kept = Object.entries(records).slice(1 - NAMES_MAX)
  await $.store.set(NAMES_KEY, Object.fromEntries([...kept, [session, record]]))
}

let isRenaming = false

/** Names a started lead session after the project's label, again whenever the label changes. */
export async function syncLeadName($: EngineInterface): Promise<void> {
  const { state, isDemo } = await viewOf($)
  if (isDemo || state === null || isRenaming) {
    return
  }
  const session = await $.session.id()
  const started = startedOf(await $.store.get(STARTED_KEY).catch(() => undefined))
  const records = recordsOf(await $.store.get(NAMES_KEY).catch(() => undefined))
  const name = leadRenameOf({
    state,
    isStarted: started.includes(session),
    record: records[session]
  })
  if (name === null) {
    return
  }
  isRenaming = true
  try {
    await saveRecord($, session, { applied: name })
    await $.command.run({ command: 'rename', args: name })
  } finally {
    isRenaming = false
  }
}

/** A /rename the mod did not run keeps that name; the lead skill they ran makes this session the lead. */
export const registerLeadName = (on: On): void => {
  on('command.run', { command: 'rename' }, async ($, e, next) => {
    // Why any other origin: a name the person or another plugin gave is theirs to keep.
    if (e.origin.kind !== 'plugin' || e.origin.name !== 'orca-game') {
      await saveRecord($, await $.session.id(), { isPersonNamed: true }).catch(() => undefined)
    }
    return next(e)
  })
  on('command.run', { command: LEAD_SKILL }, async ($, e, next) => {
    await markLeadStarted($).catch(() => undefined)
    return next(e)
  })
}
