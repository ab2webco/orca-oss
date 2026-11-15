import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

// ORCA-851: a federated start records only the requested launch, so a remote member whose host
// sends no hook status showed no model at home; the host's final receipt is kept instead.
describe('a worker dispatch launch receipt', () => {
  let db: OrchestrationDb
  afterEach(() => db.close())

  it("keeps the host's final receipt, which the home reads for the member card", () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work a ticket' })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {
        topology: 'federated',
        agent: 'claude',
        launch: {
          requested: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' },
          effective: null
        }
      }
    })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: 'term_remote'
    })
    expect(db.workerLaunchForTerminal('term_remote')).toBeNull()

    const effective = {
      agent: 'claude',
      model: 'claude-opus-5-5',
      effort: 'high',
      chosenBy: { by: 'lead', kind: 'implement', source: 'flag' }
    }
    db.recordWorkerLaunchReceipt(started.dispatch.id, {
      requested: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' },
      effective
    })
    expect(db.workerLaunchForTerminal('term_remote')).toEqual(effective)
  })
})
