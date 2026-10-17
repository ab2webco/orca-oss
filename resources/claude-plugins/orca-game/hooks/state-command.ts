import type { EngineInterface, On } from 'claude-code'

import { readGameStateOutput } from './fleet-sync'
import { gameLocale } from './game-strings'
import { quest, ready } from './quest-runtime'
import { stateReportOf } from './state-report'
import { stateReportWordsOf } from './state-report-words'

/** The plugin skill the mod answers itself, so no model turn runs and no shell is involved. */
export const STATE_SKILL = 'orca-game:state'

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
  const session = { mode: quest.isDemo ? 'demo' : quest.modeOverride, render: quest.renderOverride }
  return stateReportOf(out.stdout, session, words) ?? words.failed(words.notState)
}

export const registerStateCommand = (on: On): void => {
  on('command.run', { command: STATE_SKILL }, async ($) => {
    const text = await stateText($)
    return { text, context: [text] }
  })
}
