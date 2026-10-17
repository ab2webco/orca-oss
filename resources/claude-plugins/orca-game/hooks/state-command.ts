import type { EngineInterface, On } from 'claude-code'

import { readGameStateOutput } from './fleet-sync'
import { STATE_COMMAND } from './game-commands'
import { gameLocale } from './game-strings'
import { quest, ready } from './quest-runtime'
import { stateReportOf, type SessionOverrides } from './state-report'
import { stateReportWordsOf } from './state-report-words'

async function stateText($: EngineInterface): Promise<string> {
  await ready($)
  const words = stateReportWordsOf(gameLocale())
  const out = await readGameStateOutput($)
  if (out.kind === 'missing') {
    return words.notGamePane
  }
  if (out.kind === 'failed') {
    return words.failed(out.reason)
  }
  const session: SessionOverrides = {
    mode: quest.isDemo ? 'demo' : quest.modeOverride,
    render: quest.renderOverride
  }
  return stateReportOf(out.stdout, session, words) ?? words.failed(words.notState)
}

export const registerStateCommand = (on: On): void => {
  // Why the mod answers: no model turn runs and no shell is involved, so every Windows pane shell works.
  on('command.run', { command: STATE_COMMAND }, async ($) => {
    const text = await stateText($)
    return { text, context: [text] }
  })
}
