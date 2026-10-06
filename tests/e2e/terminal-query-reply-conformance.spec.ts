import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  shellQuote,
  startDockerSshRelayTarget,
  writeDockerSshRelayTargetFile,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

const PROBE_FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/e2e/fixtures/terminal-query-burst-probe.cjs'
)
const ESC = '\x1b'
const ST = `${ESC}\\`
const BEL = '\x07'

type ReplyKind = string
// A query and the reply kind a visible local Orca pane answers it with, or null when Orca
// intentionally leaves it unanswered.
type Query = { bytes: string; reply: ReplyKind | null }

const Q = {
  osc10St: { bytes: `${ESC}]10;?${ST}`, reply: 'osc10' },
  osc10Bel: { bytes: `${ESC}]10;?${BEL}`, reply: 'osc10' },
  osc11St: { bytes: `${ESC}]11;?${ST}`, reply: 'osc11' },
  osc11Bel: { bytes: `${ESC}]11;?${BEL}`, reply: 'osc11' },
  osc12St: { bytes: `${ESC}]12;?${ST}`, reply: 'osc12' },
  osc4Bel: { bytes: `${ESC}]4;0;?${BEL}`, reply: 'osc4;0' },
  da1: { bytes: `${ESC}[c`, reply: 'da1' },
  da2: { bytes: `${ESC}[>c`, reply: 'da2' },
  dsr5: { bytes: `${ESC}[5n`, reply: 'dsr5' },
  cpr: { bytes: `${ESC}[6n`, reply: 'cpr' },
  xtversion: { bytes: `${ESC}[>q`, reply: 'xtversion' },
  decrqm69: { bytes: `${ESC}[?69$p`, reply: 'decrpm:69' },
  decrqm2026: { bytes: `${ESC}[?2026$p`, reply: 'decrpm:2026' },
  decrqm2027: { bytes: `${ESC}[?2027$p`, reply: 'decrpm:2027' },
  decrqm2031: { bytes: `${ESC}[?2031$p`, reply: 'decrpm:2031' },
  decrqm2032: { bytes: `${ESC}[?2032$p`, reply: 'decrpm:2032' },
  kitty: { bytes: `${ESC}[?u`, reply: 'kitty' },
  colorScheme: { bytes: `${ESC}[?996n`, reply: 'colorscheme' },
  // Answered by Orca's raw-data scanner, not xterm (terminal-capability-replies.ts:79).
  winPx: { bytes: `${ESC}[14t`, reply: 'winpx' },
  cellPx: { bytes: `${ESC}[16t`, reply: 'cellpx' },
  // xterm gates 18t on windowOptions.getWinSizeChars, which Orca never sets.
  winChars: { bytes: `${ESC}[18t`, reply: null }
} satisfies Record<string, Query>

type Mode = 'raw' | 'cooked'

// Reply kinds Orca holds back while the tty still echoes (ORCA-537 scope).
const CONTAINED_WHILE_ECHO = new Set(['osc10', 'osc11', 'osc12', 'osc4;0', 'colorscheme'])

function cookedFailureReason(queries: Query[]): string | null {
  if (process.platform === 'darwin') {
    return 'ORCA-537: on macOS a cooked probe reads no reply at all, colour included'
  }
  return queries.some((query) => query.reply !== null && !CONTAINED_WHILE_ECHO.has(query.reply))
    ? 'ORCA-537: replies other than OSC colour are not contained while ECHO is on'
    : null
}
type Scenario = {
  name: string
  queries: Query[]
  modes: Mode[]
  runs?: number
  delayBeforeMs?: number
}

const SINGLES: Scenario[] = Object.entries(Q).map(([name, query]) => ({
  name: `single ${name}`,
  queries: [query],
  modes: ['raw']
}))

// Same bytes as the codex burst pinned in pty-connection.test.ts.
const CODEX_BURST = [Q.da1, Q.osc11St, Q.xtversion, Q.winPx, Q.cellPx]

// Orders as each library writes them (sources cited per burst).
const BURSTS: Scenario[] = [
  // muesli/termenv termStatusReport: OSC 11;? ST then CSI 6n, stops reading at the CPR (gh).
  { name: 'termenv/gh ST', queries: [Q.osc11St, Q.cpr], modes: ['raw', 'cooked'] },
  { name: 'termenv/gh BEL', queries: [Q.osc11Bel, Q.cpr], modes: ['raw', 'cooked'] },
  // lipgloss v2: RequestBackgroundColor + RequestPrimaryDeviceAttributes, DA1 as sentinel.
  { name: 'lipgloss v2', queries: [Q.osc11Bel, Q.da1], modes: ['raw', 'cooked'] },
  // crossterm query_keyboard_enhancement_flags: "\x1B[?u\x1B[c".
  { name: 'crossterm', queries: [Q.kitty, Q.da1], modes: ['raw', 'cooked'] },
  // neovim tui.c startup: DECRQM set, kitty ?u + DA1, then OSC 11 BEL + DSR 5n.
  {
    name: 'neovim',
    queries: [
      Q.decrqm69,
      Q.decrqm2026,
      Q.decrqm2027,
      Q.decrqm2031,
      Q.decrqm2032,
      Q.kitty,
      Q.da1,
      Q.osc11Bel,
      Q.dsr5
    ],
    modes: ['raw', 'cooked']
  },
  // vim termresponse: t_u7 (CPR), t_RV (DA2), t_RF/t_RB (OSC 10/11 BEL).
  { name: 'vim', queries: [Q.cpr, Q.da2, Q.osc10Bel, Q.osc11Bel], modes: ['raw', 'cooked'] },
  // fzf --height: the light renderer asks for the cursor position.
  { name: 'fzf', queries: [Q.cpr], modes: ['raw', 'cooked'] },
  { name: 'codex', queries: CODEX_BURST, modes: ['raw', 'cooked'] },
  // Same bytes as OPENCODE_STARTUP_QUERY_BURST in the issue-12112 repro test.
  { name: 'opencode', queries: [Q.osc10Bel, Q.osc11Bel, Q.osc4Bel], modes: ['raw', 'cooked'] }
]

const LIFECYCLE: Scenario[] = [
  {
    name: 'termenv/gh ST twice in one process',
    queries: [Q.osc11St, Q.cpr],
    modes: ['raw'],
    runs: 2
  },
  { name: 'codex twice in one process', queries: CODEX_BURST, modes: ['raw'], runs: 2 },
  // Containment stays live for the whole session, not only while the shell starts.
  {
    name: 'termenv/gh ST long after startup',
    queries: [Q.osc11St, Q.cpr],
    modes: ['raw', 'cooked'],
    delayBeforeMs: 15_000
  }
]

type ProbeRun = { observedOrder: string[]; trailing: string; received: string }

// Where the probe runs: the local disk, or an SSH host whose files the test reaches another way.
type ProbeHost = {
  fixturePath: string
  configPath: string
  resultPath: string
  writeFile: (filePath: string, contents: string) => void
  readFile: (filePath: string) => string | null
}

function localProbeHost(outputPath: (name: string) => string): ProbeHost {
  return {
    fixturePath: PROBE_FIXTURE_PATH,
    configPath: outputPath('probe-config.json'),
    resultPath: outputPath('probe-result.txt'),
    writeFile: (filePath, contents) => fs.writeFileSync(filePath, contents),
    readFile: (filePath) => (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null)
  }
}

function readProbeRuns(host: ProbeHost): ProbeRun[] | null {
  const line = host.readFile(host.resultPath)?.trim() ?? ''
  return line.startsWith('PROBE_RESULT ')
    ? (JSON.parse(line.slice('PROBE_RESULT '.length)) as { runs: ProbeRun[] }).runs
    : null
}

function expectedReplies(queries: Query[]): ReplyKind[] {
  return queries.flatMap((query) => (query.reply ? [query.reply] : []))
}

function countBy(kinds: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const kind of kinds) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return counts
}

function diffReplies(
  expected: string[],
  observed: string[]
): {
  missing: string[]
  duplicates: string[]
} {
  const want = countBy(expected)
  const got = countBy(observed)
  const missing = [...want].flatMap(([kind, n]) =>
    Array<string>(Math.max(0, n - (got.get(kind) ?? 0))).fill(kind)
  )
  const duplicates = [...got].flatMap(([kind, n]) =>
    Array<string>(Math.max(0, n - (want.get(kind) ?? 0))).fill(kind)
  )
  return { missing, duplicates }
}

async function openProbeTerminal(page: Page): Promise<string> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  return waitForActivePanePtyId(page)
}

async function runProbe(
  page: Page,
  ptyId: string,
  scenario: Scenario,
  mode: Mode,
  host: ProbeHost
): Promise<void> {
  const expectedOrder = expectedReplies(scenario.queries)
  const runs = scenario.runs ?? 1
  host.writeFile(
    host.configPath,
    JSON.stringify({
      burst: scenario.queries.map((query) => query.bytes).join(''),
      mode,
      runs,
      expectedCount: expectedOrder.length,
      delayBeforeMs: scenario.delayBeforeMs ?? 0,
      reorderForOracleCheck: process.env.ORCA_E2E_REPLY_ORACLE_REORDER === '1'
    })
  )
  await execInTerminal(
    page,
    ptyId,
    `node ${JSON.stringify(host.fixturePath)} --config ${JSON.stringify(host.configPath)} --result ${JSON.stringify(host.resultPath)}`
  )

  const perRunBudgetMs = 12_000
  await expect
    .poll(() => readProbeRuns(host) !== null, {
      timeout: (scenario.delayBeforeMs ?? 0) + runs * perRunBudgetMs,
      message: 'the query probe never reported a result'
    })
    .toBe(true)
  const probeRuns = readProbeRuns(host)
  if (!probeRuns) {
    throw new Error('probe result vanished after it was reported')
  }

  const observed = probeRuns.map((run) => ({
    observedOrder: run.observedOrder,
    trailing: run.trailing,
    ...diffReplies(expectedOrder, run.observedOrder)
  }))
  expect(
    observed,
    `probe stdin per run, JSON-escaped: ${JSON.stringify(probeRuns.map((run) => run.received))}`
  ).toEqual(
    Array.from({ length: runs }, () => ({
      observedOrder: expectedOrder,
      trailing: '',
      missing: [],
      duplicates: []
    }))
  )

  // Why: a reply echoed by a cooked tty paints as ^[]11;rgb:… on the user's screen.
  const screen = await getTerminalContent(page, 20_000)
  expect(
    screen.includes('^['),
    `pane shows an echoed reply: ${JSON.stringify(screen.slice(-600))}`
  ).toBe(false)
}

for (const scenario of [...SINGLES, ...BURSTS, ...LIFECYCLE]) {
  for (const mode of scenario.modes) {
    test(`terminal replies to ${scenario.name} (${mode}) arrive once, in order, with nothing after`, async ({
      orcaPage
    }, testInfo) => {
      // Why: known ORCA-537 gaps; test.fail flips red once containment covers them.
      const knownFailure = mode === 'cooked' ? cookedFailureReason(scenario.queries) : null
      test.fail(knownFailure !== null, knownFailure ?? '')
      if (scenario.delayBeforeMs) {
        test.slow()
      }
      const ptyId = await openProbeTerminal(orcaPage)
      await runProbe(
        orcaPage,
        ptyId,
        scenario,
        mode,
        localProbeHost((name) => testInfo.outputPath(name))
      )
    })
  }
}

test('terminal replies in a folder workspace arrive once, in order, with nothing after', async ({
  orcaPage
}, testInfo) => {
  const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-reply-folder-'))
  await waitForSessionReady(orcaPage)
  const workspaceId = await orcaPage.evaluate(async (folder) => {
    const store = window.__store!.getState()
    const group = await store.createProjectGroup('reply-conformance')
    if (!group) {
      throw new Error('could not create a project group')
    }
    const workspace = await store.createFolderWorkspace({
      projectGroupId: group.id,
      name: 'reply-folder',
      folderPath: folder
    })
    if (!workspace) {
      throw new Error('could not create a folder workspace')
    }
    window.__store!.getState().setActiveFolderWorkspace(workspace.id)
    return workspace.id
  }, folderPath)
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId ?? ''))
    .toContain(workspaceId)
  const ptyId = await openProbeTerminal(orcaPage)
  await runProbe(
    orcaPage,
    ptyId,
    BURSTS[0],
    'raw',
    localProbeHost((name) => testInfo.outputPath(name))
  )
  fs.rmSync(folderPath, { recursive: true, force: true })
})

test.describe('terminal query replies over SSH', () => {
  test.skip(
    process.env.ORCA_E2E_SSH_DOCKER !== '1',
    'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.'
  )
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')

  for (const scenario of [BURSTS[0], { ...BURSTS[0], name: 'termenv/gh ST twice', runs: 2 }]) {
    test(`terminal replies to ${scenario.name} over SSH arrive once, in order, with nothing after`, async ({
      orcaPage
    }, testInfo) => {
      test.slow()
      let target: DockerSshRelayTarget | null = null
      try {
        target = startDockerSshRelayTarget(testInfo)
        const remote = target
        await waitForSessionReady(orcaPage)
        await waitForActiveWorktree(orcaPage)
        await connectDockerSshRelayTarget(orcaPage, remote)
        await ensureTerminalVisible(orcaPage, 45_000)
        await waitForActiveTerminalManager(orcaPage, 60_000)
        const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)
        const host: ProbeHost = {
          fixturePath: '/tmp/orca-e2e-query-burst-probe.cjs',
          configPath: '/tmp/orca-e2e-query-burst-config.json',
          resultPath: '/tmp/orca-e2e-query-burst-result.txt',
          writeFile: (filePath, contents) =>
            writeDockerSshRelayTargetFile(remote, filePath, contents),
          readFile: (filePath) =>
            execDockerSshRelayTargetCommand(
              remote,
              `cat ${shellQuote(filePath)} 2>/dev/null || true`
            ) || null
        }
        host.writeFile(host.fixturePath, fs.readFileSync(PROBE_FIXTURE_PATH, 'utf8'))
        await runProbe(orcaPage, ptyId, scenario, 'raw', host)
      } finally {
        cleanupDockerSshRelayTarget(target)
      }
    })
  }
})
