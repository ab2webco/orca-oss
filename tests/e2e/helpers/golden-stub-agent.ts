import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { focusActiveTerminalInput, getTerminalContent, waitForTerminalOutput } from './terminal'
import {
  classifyGoldenStubExit,
  composerLineFor,
  type GoldenStubExitVerdict
} from '../golden-stub-exit-verdict'

export const GOLDEN_STUB_READY_MARKER = 'GOLDEN_STUB_AGENT_READY'
export const GOLDEN_STUB_EXIT_MARKER = 'GOLDEN_STUB_AGENT_EXITED'

const fixtureDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'golden-stub-agent')

export function getGoldenStubAgentLaunchEnv(): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  return {
    [pathKey]: [fixtureDir, process.env[pathKey] ?? ''].filter(Boolean).join(path.delimiter)
  }
}

export async function configureGoldenStubAgent(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Orca store is unavailable')
    }
    await store.getState().updateSettings({
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: 'golden-stub-agent' },
      agentDefaultArgs: { codex: '' }
    })
  })
}

export async function launchGoldenStubAgentFromNewTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New tab' }).click({ force: true })
  const launchOption = page.getByRole('menuitem', { name: /^Codex(?:\s|$)/i }).first()
  await expect(launchOption).toBeVisible({ timeout: 15_000 })
  await launchOption.click({ force: true })
  await focusActiveTerminalInput(page)
  await waitForTerminalOutput(page, GOLDEN_STUB_READY_MARKER, 20_000)
}

// Why the handshake: the ready marker only proves the stub's OUTPUT reached
// xterm. Typing straight after it races the pane's input transport, and a
// dropped "exit" left the run blaming a missing exit marker 15s later.
export async function submitGoldenStubExit(page: Page, timeoutMs = 15_000): Promise<void> {
  await focusActiveTerminalInput(page)
  await page.keyboard.type('exit')
  // The stub runs raw-mode in the alt screen, so this line is rendered by the
  // process itself — not terminal echo — and proves it consumed the keystrokes.
  await waitForTerminalOutput(page, composerLineFor('exit'), timeoutMs)
  await page.keyboard.press('Enter')

  let verdict: GoldenStubExitVerdict = { kind: 'exited' }
  await expect
    .poll(
      async () => {
        verdict = classifyGoldenStubExit({
          terminalText: await getTerminalContent(page, 4000),
          command: 'exit',
          exitMarker: GOLDEN_STUB_EXIT_MARKER
        })
        return verdict.kind
      },
      { timeout: timeoutMs, message: 'golden stub agent never exited' }
    )
    .toBe('exited')
    .catch((error) => {
      throw new Error(
        `golden stub agent never exited: ${verdict.kind === 'exited' ? '' : verdict.reason}`,
        { cause: error }
      )
    })
}
