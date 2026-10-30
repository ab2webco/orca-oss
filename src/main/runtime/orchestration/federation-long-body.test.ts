import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from './db'
import { syncFederatedDispatch } from './federation-sync'
import {
  formatOrchestrationCheckText,
  prepareOrchestrationCheckOutput
} from '../../../shared/orchestration-check-output'
import { gameInboxesOf } from '../../../shared/orchestrator-game-inbox'
import { gameInboxSourceOf } from '../orchestrator-game-inbox-source'
import { ORCHESTRATION_METHODS } from '../rpc/methods/orchestration'

// Why (ORCA-858): the lead watches check --json under Claude Code's Monitor, which cuts each line at ~500 characters, each event at ~3000.
const MONITOR_LINE_CUT = 500
const MONITOR_EVENT_CUT = 3000

/** What the lead sees of one printed result in a Monitor notification. */
const seenInWatch = (output: string): string =>
  output
    .slice(0, MONITOR_EVENT_CUT)
    .split('\n')
    .map((line) => line.slice(0, MONITOR_LINE_CUT))
    .join('\n')

describe('a long body from a remote member', () => {
  it('is readable in full on the lead through its watch output', async () => {
    const body = Array.from({ length: 60 }, (_, index) => `Hallazgo ${index}: "ruta" ok;`)
      .join(' ')
      .padEnd(3000, ' ñ')
    expect(body).toHaveLength(3000)
    const db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'Remote member reports',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: 'tab_lead:11111111-1111-4111-8111-111111111111'
    })
    const task = db.createTask({ spec: 'ORCA-858 remote work', runId: run.id })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      federation: {
        environmentId: 'environment_m1',
        environmentName: 'm1',
        peerFingerprint: 'm1_peer_fingerprint',
        protocolVersion: 3
      }
    })
    db.recordWorkerStage({ dispatchId: dispatch.id, stage: 'ready', state: 'ready' })
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'resolveOrchestrationWorkerServer').mockReturnValue({
      peerFingerprint: 'm1_peer_fingerprint'
    } as never)
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockImplementation(
      async (_environmentId, method) => {
        if (method === 'orchestration.federationPull') {
          return {
            runtimeEpoch: 'remote_epoch_1',
            items: [
              {
                dispatch_id: dispatch.id,
                direction: 'to_home',
                sequence: 1,
                message_id: 'relay_long',
                kind: 'escalation',
                payload: JSON.stringify({ subject: 'Blocked', body, type: 'escalation' })
              }
            ]
          }
        }
        if (method === 'orchestration.federationAck') {
          return { acknowledgedThrough: 1 }
        }
        throw new Error(`Unexpected method ${method}`)
      }
    )

    await syncFederatedDispatch(runtime, dispatch.id)
    const delivery = db.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })!
    const check = {
      messages: delivery.messages,
      count: delivery.messages.length,
      deliveryId: delivery.delivery.id
    }
    const json = JSON.stringify(
      { id: 'rpc_1', ok: true, result: prepareOrchestrationCheckOutput(check, 'term_lead', false) },
      null,
      2
    )
    const read = /orca orchestration inbox --terminal ([\w:.-]+) --id ([\w.-]+)/.exec(
      seenInWatch(json)
    )
    expect(read).not.toBeNull()
    const inbox = ORCHESTRATION_METHODS.find((method) => method.name === 'orchestration.inbox')!
    const printed = (await inbox.handler(
      inbox.params!.parse({ terminal: read![1], id: read![2] }),
      {
        runtime
      } as never
    )) as { messages: { body: string }[] }
    expect(printed.messages.map((one) => one.body)).toEqual([body])
    const text = formatOrchestrationCheckText(check, 'term_lead')
    expect(seenInWatch(text)).toContain(`--id ${read![2]}`)
    const [leadInbox] = gameInboxesOf(
      gameInboxSourceOf(db, { handle: 'term_lead', paneKey: run.coordinator_pane_key }),
      {}
    )
    expect(leadInbox.messages.map((one) => one.body)).toEqual([body])
    db.close()
  })
})
