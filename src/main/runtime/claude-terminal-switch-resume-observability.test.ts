import { afterEach, describe, expect, it } from 'vitest'
import { AgentHookServer } from '../agent-hooks/server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { applyManagedHooks } from '../claude/hook-settings'
import {
  selectExactWorkerProviderSession,
  selectExactWorkerProviderSessionIdentity
} from './orchestration/worker-provider-session'

/**
 * ORCA-168: the switch relaunched Claude with `--resume <captured id>` and the
 * session really did come back — the fabiana vault recorded a session-env entry
 * for it — but verification waited 90 s for a hook observation that no resumed,
 * idle Claude ever emits. Orca registered no SessionStart hook, so the only
 * events that carry a provider session id are turn events the user has to
 * trigger. These cases pin the whole chain that was broken: the managed hook
 * set, the listener, the live hook POST, and the selector the switch reads.
 */
const PANE_KEY = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const RESUMED_SESSION_ID = '001c9ef5-69f9-4b1b-809f-7f8dc17e73b3'
const MANAGED_COMMAND = "/bin/sh '/home/user/.orca/agent-hooks/claude-hook.sh'"

const servers: AgentHookServer[] = []

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.stop()
  }
})

async function startHookServer(): Promise<AgentHookServer> {
  const server = new AgentHookServer()
  servers.push(server)
  await server.start({ env: 'production' })
  return server
}

async function postClaudeHook(
  server: AgentHookServer,
  payload: Record<string, unknown>
): Promise<number> {
  const env = server.buildPtyEnv()
  const response = await fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/claude`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
    },
    body: JSON.stringify({
      paneKey: PANE_KEY,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      env: 'production',
      payload
    })
  })
  return response.status
}

describe('managed Claude hook events', () => {
  it('registers SessionStart so a resumed session reports its id before any turn', () => {
    // Why the default event set: vault instrumentation injects it ungated, which
    // is what a switched terminal's CLAUDE_CONFIG_DIR actually reads.
    const config = applyManagedHooks({}, MANAGED_COMMAND)

    const sessionStart = config.hooks?.SessionStart
    expect(sessionStart).toBeDefined()
    expect(JSON.stringify(sessionStart)).toContain(MANAGED_COMMAND)
    // A resume that never matched would leave the switch exactly as broken.
    expect(String(sessionStart?.[0]?.matcher ?? 'resume')).toContain('resume')
  })
})

describe('resumed-session observability over the live hook endpoint', () => {
  it('reports the resumed provider session to the switch before the user types', async () => {
    const server = await startHookServer()

    await expect(
      postClaudeHook(server, {
        hook_event_name: 'SessionStart',
        source: 'resume',
        session_id: RESUMED_SESSION_ID,
        transcript_path: `/store/projects/repo/${RESUMED_SESSION_ID}.jsonl`,
        cwd: '/repo'
      })
    ).resolves.toBe(204)

    const observed = selectExactWorkerProviderSessionIdentity({
      paneKey: PANE_KEY,
      processIncarnation: 'pty-1:inc-1',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: server.getStatusSnapshot()
    })

    expect(observed?.providerSession.id).toBe(RESUMED_SESSION_ID)
    expect(observed?.agent).toBe('claude')
  })

  it('keeps the resume-identity row out of the live-agent selector', async () => {
    const server = await startHookServer()

    await postClaudeHook(server, {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: RESUMED_SESSION_ID,
      cwd: '/repo'
    })

    // Why: "which session is in this pane" and "what is this worker doing" are
    // different questions; only the first may be answered by an idle resume.
    expect(
      selectExactWorkerProviderSession({
        paneKey: PANE_KEY,
        processIncarnation: 'pty-1:inc-1',
        connectionId: null,
        launchToken: undefined,
        observedAfter: 0,
        statuses: server.getStatusSnapshot()
      })
    ).toBeNull()
    expect(server.getStatusSnapshot().filter((entry) => !entry.providerSessionOnly)).toEqual([])
  })

  it('still reports a real turn after the resume identity row', async () => {
    const server = await startHookServer()

    await postClaudeHook(server, {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: RESUMED_SESSION_ID,
      cwd: '/repo'
    })
    await postClaudeHook(server, {
      hook_event_name: 'UserPromptSubmit',
      session_id: RESUMED_SESSION_ID,
      prompt: 'continue where you left off'
    })

    const live = selectExactWorkerProviderSession({
      paneKey: PANE_KEY,
      processIncarnation: 'pty-1:inc-1',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: server.getStatusSnapshot()
    })
    expect(live?.providerSession.id).toBe(RESUMED_SESSION_ID)
    expect(live?.agent).toBe('claude')
  })
})
