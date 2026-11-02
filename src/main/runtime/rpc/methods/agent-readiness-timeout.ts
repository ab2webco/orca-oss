import type { RuntimeTerminalWait } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'

const BANNER_VERSION_RE = /\bv(\d+\.\d+\.\d+(?:[-+][0-9a-z.]+)?)\b/i
const BANNER_SCAN_LINES = 200

/** First `vX.Y.Z` in an agent's startup output, e.g. Codex's `OpenAI Codex (v0.166.0)`. */
export function readAgentBannerVersion(text: string): string | null {
  return BANNER_VERSION_RE.exec(text)?.[1] ?? null
}

type ReadinessRuntime = Pick<
  OrcaRuntimeService,
  'waitForTerminal' | 'isTerminalRunningAgent' | 'readTerminal'
>

/** The worker-start `tui-idle` wait, with its `timeout` explained when an agent did start. */
export async function waitForAgentTuiIdle(
  runtime: ReadinessRuntime,
  terminalHandle: string,
  agent: string | null | undefined,
  budgetMs: number
): Promise<RuntimeTerminalWait> {
  try {
    return await runtime.waitForTerminal(terminalHandle, {
      condition: 'tui-idle',
      timeoutMs: budgetMs
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'timeout') {
      const args = { runtime, terminalHandle, agent: agent ?? null, budgetMs }
      throw (await explainAgentReadinessTimeout(args)) ?? error
    }
    throw error
  }
}

/**
 * Turns a readiness `timeout` into `agent_not_recognized` when an agent does own the pane, so a
 * launch says Orca missed the ready prompt instead of implying the agent never started (ORCA-936).
 * Returns null when no agent is running there; the plain timeout is then the accurate answer.
 */
export async function explainAgentReadinessTimeout(args: {
  runtime: Pick<OrcaRuntimeService, 'isTerminalRunningAgent' | 'readTerminal'>
  terminalHandle: string
  agent: string | null
  budgetMs: number
}): Promise<OrchestrationError | null> {
  if (!(await args.runtime.isTerminalRunningAgent(args.terminalHandle))) {
    return null
  }
  const version = await readTerminalBannerVersion(args.runtime, args.terminalHandle)
  const name = args.agent ?? 'the agent'
  const seconds = Math.round(args.budgetMs / 1000)
  return new OrchestrationError(
    'agent_not_recognized',
    `agent_not_recognized: ${name} started${version ? ` (v${version})` : ''} but Orca did not ` +
      `recognize its ready prompt within ${seconds}s. Nothing was typed into the terminal.`
  )
}

async function readTerminalBannerVersion(
  runtime: Pick<OrcaRuntimeService, 'readTerminal'>,
  terminalHandle: string
): Promise<string | null> {
  try {
    const read = await runtime.readTerminal(terminalHandle, { limit: BANNER_SCAN_LINES })
    return readAgentBannerVersion(read.tail.join('\n'))
  } catch {
    // Why: the version only enriches the message; an unreadable pane must not mask the diagnosis.
    return null
  }
}
