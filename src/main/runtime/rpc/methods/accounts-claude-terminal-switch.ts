import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'
import {
  ClaudeTerminalAccountSwitchRefusal,
  getClaudeTerminalAccountSwitchStatus,
  startClaudeTerminalAccountSwitch
} from '../../claude-terminal-account-switch-service'
import {
  claudeTerminalAccountSwitchFailureMessage,
  type ClaudeTerminalAccountSwitchResult
} from '../../../../shared/claude-terminal-account-switch'

// Why: exactly one selector — a handle from the CLI/skill, or the pane's ptyId
// from the desktop adapter. Never a focused-pane fallback; the switch must hit
// the terminal the caller proved it owns.
const SwitchClaudeTerminalParams = z
  .object({
    terminal: z.string().trim().min(1).max(512).optional(),
    ptyId: z.string().trim().min(1).max(512).optional(),
    /** Remint-stable pane identity; with launchToken it outranks the claimed handle. */
    paneKey: z.string().trim().min(1).max(512).optional(),
    launchToken: z.string().trim().min(1).max(512).optional(),
    targetAccountId: z.string().trim().min(1).max(512),
    continuationPrompt: z.string().trim().min(1).max(4_096).optional(),
    /** How long to hold the response open for the terminal result; the operation outlives it. */
    awaitMs: z.number().int().min(0).max(600_000).optional()
  })
  .strict()
  .refine(
    (value) => (value.terminal === undefined) !== (value.ptyId === undefined),
    'Provide exactly one of terminal or ptyId'
  )

const ClaudeTerminalSwitchStatusParams = z
  .object({ operationId: z.string().trim().min(1).max(512) })
  .strict()

const DEFAULT_SWITCH_AWAIT_MS = 180_000

async function waitForSwitchResult(
  settled: Promise<ClaudeTerminalAccountSwitchResult>,
  fallback: ClaudeTerminalAccountSwitchResult,
  awaitMs: number
): Promise<ClaudeTerminalAccountSwitchResult> {
  if (awaitMs <= 0) {
    return fallback
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ClaudeTerminalAccountSwitchResult>((resolve) => {
    timer = setTimeout(() => resolve(fallback), awaitMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([settled, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/** Atomic per-terminal Claude account switch, kept out of the accounts method list it joins. */
export const CLAUDE_TERMINAL_SWITCH_METHODS: readonly RpcAnyMethod[] = [
  defineMethod({
    // Why: the whole switch runs on the runtime that owns the PTY and is
    // detached from this call, so a self-switching agent's dying tool
    // subprocess (or a dropped CLI socket) cannot cancel an accepted
    // operation. Renderer, CLI and the bundled skill are adapters over this.
    name: 'accounts.switchClaudeTerminal',
    params: SwitchClaudeTerminalParams,
    handler: async (params, { runtime, clientKind }) => {
      // Why: this stops a running agent and writes to its PTY. A paired phone
      // must not be able to kill a worker's turn; desktop (undefined) and
      // remote-runtime clients own the terminals they are driving.
      if (clientKind === 'mobile') {
        throw new Error(
          'Switching a terminal’s Claude account is not available from a paired device.'
        )
      }
      // Why: what the runtime can prove about the pane outranks the handle the
      // caller claims. A pane that holds a launch token on record must present
      // it, which is what stops one agent from switching another's account.
      const provenHandle =
        params.paneKey !== undefined
          ? runtime.authenticateOrchestrationSender({
              ...(params.terminal !== undefined ? { claimedHandle: params.terminal } : {}),
              paneKey: params.paneKey,
              ...(params.launchToken !== undefined ? { launchToken: params.launchToken } : {})
            }).handle
          : params.terminal
      const target =
        provenHandle !== undefined
          ? ({ kind: 'handle', terminal: provenHandle } as const)
          : ({ kind: 'pty', ptyId: params.ptyId! } as const)
      try {
        const { acceptance, settled } = await startClaudeTerminalAccountSwitch(runtime, {
          target,
          targetAccountId: params.targetAccountId,
          ...(params.continuationPrompt ? { continuationPrompt: params.continuationPrompt } : {})
        })
        const pending: ClaudeTerminalAccountSwitchResult = {
          operationId: acceptance.operationId,
          state: acceptance.state,
          terminal: acceptance.terminal,
          ptyId: acceptance.ptyId,
          sourceAccountId: acceptance.sourceAccountId,
          targetAccountId: acceptance.targetAccountId,
          sessionId: acceptance.sessionId
        }
        const result = await waitForSwitchResult(
          settled,
          pending,
          params.awaitMs ?? DEFAULT_SWITCH_AWAIT_MS
        )
        return { accepted: true, acceptance, result }
      } catch (error) {
        if (!(error instanceof ClaudeTerminalAccountSwitchRefusal)) {
          throw error
        }
        // Why structured instead of thrown: nothing was mutated, and every
        // adapter needs the typed reason to render one actionable message.
        return {
          accepted: false,
          acceptance: null,
          result: {
            operationId: '',
            state: 'preflighting',
            terminal: params.terminal ?? '',
            ptyId: params.ptyId ?? '',
            sourceAccountId: null,
            targetAccountId: params.targetAccountId,
            sessionId: null,
            failure: {
              reason: error.reason,
              message: claudeTerminalAccountSwitchFailureMessage(error.reason)
            }
          } satisfies ClaudeTerminalAccountSwitchResult
        }
      }
    }
  }),
  defineMethod({
    // Why: a caller that lost the socket mid-switch reads the outcome here
    // instead of re-running a transaction that is already in flight.
    name: 'accounts.claudeTerminalSwitchStatus',
    params: ClaudeTerminalSwitchStatusParams,
    handler: async (params) => ({
      result: getClaudeTerminalAccountSwitchStatus(params.operationId)
    })
  })
]
