import { afterEach, describe, expect, it } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const PANE = makePaneKey('tab-relaunch', '11111111-1111-4111-8111-111111111111')
const SESSION_ID = '7ad4b87c-d538-4e20-8a12-371798492200'

/**
 * ORCA-169: an in-place account switch stops the source CLI, which retires the pane's launch
 * authority, and then relaunches Claude in that same live pane. If retiring also marks the pane
 * closed, every later hook post is dropped at ingest and the switch can only time out waiting
 * for its own relaunch.
 */
describe('AgentHookServer pane observability after an agent exits', () => {
  const servers: AgentHookServer[] = []

  afterEach(() => {
    for (const server of servers) {
      server.stop()
    }
    servers.length = 0
  })

  const startServer = async (): Promise<{
    server: AgentHookServer
    postSessionStart: () => Promise<number>
  }> => {
    const server = new AgentHookServer()
    servers.push(server)
    await server.start({ env: 'production' })
    const env = server.buildPtyEnv()
    const postSessionStart = async (): Promise<number> => {
      const response = await fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/claude`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
        },
        body: JSON.stringify({
          paneKey: PANE,
          tabId: 'tab-relaunch',
          worktreeId: 'wt-1',
          env: 'production',
          payload: {
            hook_event_name: 'SessionStart',
            source: 'resume',
            session_id: SESSION_ID,
            transcript_path: `/vault/projects/repo/${SESSION_ID}.jsonl`
          }
        })
      })
      return response.status
    }
    return { server, postSessionStart }
  }

  it('still reports a resumed session after the exited agent released its authority', async () => {
    const { server, postSessionStart } = await startServer()

    expect(await postSessionStart()).toBe(204)
    expect(server.getStatusSnapshot()).toEqual([
      expect.objectContaining({
        paneKey: PANE,
        providerSessionOnly: true,
        providerSession: expect.objectContaining({ id: SESSION_ID })
      })
    ])

    // The source CLI exited; the pane itself stays live for the relaunch.
    server.retirePaneAuthority(PANE, 'agent-exited')
    expect(server.getStatusSnapshot()).toEqual([])

    expect(await postSessionStart()).toBe(204)
    expect(server.getStatusSnapshot()).toEqual([
      expect.objectContaining({
        paneKey: PANE,
        providerSessionOnly: true,
        providerSession: expect.objectContaining({ id: SESSION_ID })
      })
    ])
  })

  it('keeps silencing a pane whose tab actually closed', async () => {
    const { server, postSessionStart } = await startServer()

    expect(await postSessionStart()).toBe(204)
    server.retirePaneAuthority(PANE)

    expect(await postSessionStart()).toBe(204)
    expect(server.getStatusSnapshot()).toEqual([])
  })
})
