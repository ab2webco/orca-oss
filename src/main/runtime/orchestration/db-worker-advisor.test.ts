import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

const LAST_SAID =
  '{"version":1,"model":"Opus 5.5","effort":"high","pinned":{"model":false,"effort":true}}'
const NEXT_SAID =
  '{"version":1,"model":"Sonnet 5.5","effort":"high","pinned":{"model":false,"effort":true}}'
const LAUNCH_PLAIN = { requested: { agent: 'claude', model: null, effort: null } }

describe('workerAdvisorForTerminal', () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  const createDb = () => {
    const database = new OrchestrationDb(':memory:')
    databases.push(database)
    return database
  }

  const dispatch = (db: OrchestrationDb, handle: string) => {
    const task = db.createTask({ spec: 'work a ticket' })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'claude', launch: LAUNCH_PLAIN }
    })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: handle
    })
  }

  it('keeps the last advisor report a member terminal said, after its dispatch ended', () => {
    const db = createDb()
    dispatch(db, 'term_member')
    db.noteWorkerAdvisorForTerminal('term_member', LAST_SAID)
    expect(db.workerAdvisorForTerminal('term_member')).toBe(LAST_SAID)
  })

  it('a later report replaces the kept one, and null clears it', () => {
    const db = createDb()
    dispatch(db, 'term_member')
    db.noteWorkerAdvisorForTerminal('term_member', LAST_SAID)
    db.noteWorkerAdvisorForTerminal('term_member', NEXT_SAID)
    expect(db.workerAdvisorForTerminal('term_member')).toBe(NEXT_SAID)
    db.noteWorkerAdvisorForTerminal('term_member', null)
    expect(db.workerAdvisorForTerminal('term_member')).toBeNull()
  })

  it('is null for a terminal that never reported, and a report for an unknown terminal is dropped', () => {
    const db = createDb()
    dispatch(db, 'term_quiet')
    db.noteWorkerAdvisorForTerminal('term_unknown', LAST_SAID)
    expect(db.workerAdvisorForTerminal('term_quiet')).toBeNull()
    expect(db.workerAdvisorForTerminal('term_unknown')).toBeNull()
  })
})
