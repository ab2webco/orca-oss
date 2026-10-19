import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

const LAUNCH_PLAIN = { requested: { agent: 'claude', model: null, effort: null } }

describe('workerObservedModelForTerminal', () => {
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

  it('keeps the model a member terminal was seen on, after its dispatch ended', () => {
    const db = createDb()
    dispatch(db, 'term_member')
    db.noteWorkerObservedModelForTerminal('term_member', {
      model: 'claude-opus-5-5',
      effort: 'high'
    })
    expect(db.workerObservedModelForTerminal('term_member')).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high'
    })
  })

  it('a later sighting replaces it on the newest dispatch only, and the Jev report is untouched', () => {
    const db = createDb()
    dispatch(db, 'term_member')
    db.noteWorkerAdvisorForTerminal('term_member', '{"version":1}')
    db.noteWorkerObservedModelForTerminal('term_member', { model: 'claude-opus-5-5' })
    dispatch(db, 'term_member')
    db.noteWorkerObservedModelForTerminal('term_member', {
      model: 'claude-sonnet-5-5',
      effort: 'low'
    })
    expect(db.workerObservedModelForTerminal('term_member')).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'low'
    })
  })

  it('is null for a terminal never seen, and a sighting for an unknown terminal is dropped', () => {
    const db = createDb()
    dispatch(db, 'term_quiet')
    db.noteWorkerObservedModelForTerminal('term_unknown', { model: 'claude-opus-5-5' })
    expect(db.workerObservedModelForTerminal('term_quiet')).toBeNull()
    expect(db.workerObservedModelForTerminal('term_unknown')).toBeNull()
  })
})
