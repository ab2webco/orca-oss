import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

const PROBE_FIXTURE_PATH = path.join(process.cwd(), 'tests/e2e/fixtures/raw-tty-colour-probe.cjs')

type ProbeResult = { order: string[]; trailing: string; received: string }

function readProbeResult(resultPath: string): ProbeResult | null {
  if (!fs.existsSync(resultPath)) {
    return null
  }
  const line = fs.readFileSync(resultPath, 'utf8').trim()
  return line.startsWith('PROBE_RESULT ')
    ? (JSON.parse(line.slice('PROBE_RESULT '.length)) as ProbeResult)
    : null
}

// ORCA-532: gh 2.101 stops reading at the CPR, so a colour reply that lands after it is
// left in stdin and gh dies with "unexpected escape sequence from terminal".
test('a raw-mode OSC 11 + CPR probe gets the colour reply before the CPR and nothing after', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)

  const ptyId = await waitForActivePanePtyId(orcaPage)
  const resultPath = testInfo.outputPath('probe-result.txt')
  await execInTerminal(
    orcaPage,
    ptyId,
    `node ${JSON.stringify(PROBE_FIXTURE_PATH)} --result ${JSON.stringify(resultPath)}`
  )

  await expect
    .poll(() => readProbeResult(resultPath) !== null, {
      timeout: 20_000,
      message: 'the colour probe never reported a result'
    })
    .toBe(true)
  const result = readProbeResult(resultPath)
  if (!result) {
    throw new Error('probe result vanished after it was reported')
  }

  const { order, trailing, received } = result
  expect({ order, trailing }, `probe stdin, JSON-escaped: ${JSON.stringify(received)}`).toEqual({
    order: ['osc11', 'cpr'],
    trailing: ''
  })
})
