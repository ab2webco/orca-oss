import type { On } from 'claude-code'

import { logDecisions, observeAdvisor } from './advisor-state'
import { quest } from './quest-runtime'

export const registerAdvisor = (on: On): void => {
  // Why here and not only while drawing: a decision is logged once, the moment Jev writes it.
  on('state.set', { plugin: 'orca-jev-mod-skills', key: 'advisor' }, async ($, e, next) => {
    const written = await next(e)
    const decisions = observeAdvisor(e.value, quest.tick)
    await logDecisions($, decisions, await $.clock.now())
    return written
  })
}
