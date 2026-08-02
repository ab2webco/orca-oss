import type { Page } from '@stablyai/playwright-test'
import { writeFileSync } from 'node:fs'

async function setCustomGenerator(page: Page, scriptPath: string): Promise<void> {
  await page.evaluate(async (scriptPath) => {
    const store =
      window.__store ??
      (() => {
        throw new Error('window.__store is not available')
      })()
    const currentSettings = store.getState().settings
    if (!currentSettings) {
      throw new Error('Settings were not loaded')
    }
    await store.getState().updateSettings({
      activeRuntimeEnvironmentId: null,
      commitMessageAi: {
        ...currentSettings.commitMessageAi,
        enabled: true,
        agentId: 'custom' as const,
        selectedModelByAgent: {},
        selectedThinkingByModel: {},
        customPrompt: '',
        customAgentCommand: `node ${JSON.stringify(scriptPath)}`
      }
    })
  }, scriptPath)
}

/**
 * Writes a generator that echoes back whichever issue number reached the prompt, so the
 * assertion covers the whole chain (renderer → IPC → worktree meta → template render →
 * agent stdin) rather than any single hop. `emitPayload` lines run with a captured `issue`
 * const in scope and must write the payload the caller's generation path expects.
 */
export function writeLinkedIssueEchoGenerator(scriptPath: string, emitPayload: string[]): void {
  writeFileSync(
    scriptPath,
    [
      'const chunks = []',
      "process.stdin.on('data', (chunk) => chunks.push(chunk))",
      "process.stdin.on('end', () => {",
      "  const prompt = Buffer.concat(chunks).toString('utf8')",
      // Why: capture the whole line, not `\d*` — a `\d*` capture matches zero digits before
      // an unexpanded `{linkedIssue}` and reports it as `empty`, hiding a literal token.
      '  const match = prompt.match(/ORCA_E2E_ISSUE=([^\\r\\n]*)/)',
      "  const issue = match ? match[1] || 'empty' : 'missing'",
      ...emitPayload,
      '})'
    ].join('\n')
  )
}

export type ReleaseGatedGenerator = {
  /** Lets the installed generator emit its payload and exit. */
  release: () => void
}

const RELEASE_POLL_INTERVAL_MS = 25
const RELEASE_TIMEOUT_MS = 60_000

/**
 * Why: a fixed `setTimeout` turns "generation is still pending" into a
 * wall-clock race. On a loaded runner the arrange steps before the worktree
 * switch can outlast the timer, so the switch happens after the generation
 * already finished and the test silently stops covering the pending path.
 * Gating the emit on a file the test writes makes the pending window measured:
 * it stays open until the caller releases it, and the generator fails loudly
 * instead of hanging if a test forgets.
 */
function buildReleaseGatedGeneratorScript(
  callLogPath: string,
  releasePath: string,
  emitLines: string[]
): string {
  return [
    "const fs = require('fs')",
    `fs.appendFileSync(${JSON.stringify(callLogPath)}, 'start\\n')`,
    'const startedAt = Date.now()',
    'const waitForRelease = () => {',
    `  if (fs.existsSync(${JSON.stringify(releasePath)})) {`,
    ...emitLines.map((line) => `    ${line}`),
    `    fs.appendFileSync(${JSON.stringify(callLogPath)}, 'finish\\n')`,
    '    return',
    '  }',
    `  if (Date.now() - startedAt > ${RELEASE_TIMEOUT_MS}) {`,
    `    fs.appendFileSync(${JSON.stringify(callLogPath)}, 'release-timeout\\n')`,
    '    process.exit(1)',
    '  }',
    `  setTimeout(waitForRelease, ${RELEASE_POLL_INTERVAL_MS})`,
    '}',
    'waitForRelease()'
  ].join('\n')
}

export async function installReleaseGatedPrGenerator(
  page: Page,
  generatorScriptPath: string,
  callLogPath: string,
  releasePath: string,
  base: string
): Promise<ReleaseGatedGenerator> {
  writeFileSync(
    generatorScriptPath,
    buildReleaseGatedGeneratorScript(callLogPath, releasePath, [
      'console.log(JSON.stringify({',
      `  base: ${JSON.stringify(base)},`,
      "  title: 'Generated PR title after switch',",
      "  body: 'Generated PR body after switch',",
      '  draft: false',
      '}))'
    ])
  )
  await setCustomGenerator(page, generatorScriptPath)
  return { release: () => writeFileSync(releasePath, 'release\n') }
}

export async function installReleaseGatedCommitMessageGenerator(
  page: Page,
  generatorScriptPath: string,
  callLogPath: string,
  releasePath: string
): Promise<ReleaseGatedGenerator> {
  writeFileSync(
    generatorScriptPath,
    buildReleaseGatedGeneratorScript(callLogPath, releasePath, [
      "console.log('Generated commit message after switch')",
      "console.log('')",
      "console.log('Generated from staged e2e-commit-message-generation.txt after switching worktrees')"
    ])
  )
  await setCustomGenerator(page, generatorScriptPath)
  return { release: () => writeFileSync(releasePath, 'release\n') }
}
