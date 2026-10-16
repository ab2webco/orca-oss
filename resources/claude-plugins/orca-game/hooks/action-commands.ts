import type { EngineInterface, On } from 'claude-code'

import type { GameAction } from '../types'
import { runAction } from './game-actions'
import { gameStrings } from './game-strings'
import { actionLabelOf } from './lead-actions'
import { quest } from './quest-runtime'

// Why module state: the engine keeps a registered name for the session, with no way to drop it.
const registered = new Map<string, string>()
const refused = new Set<string>()
let current: readonly GameAction[] = []

/** Registers each action's slash command after a refresh; a name the engine refuses is noted once. */
export async function syncActionCommands(
  $: EngineInterface,
  actions: readonly GameAction[]
): Promise<void> {
  current = actions
  const text = gameStrings().text
  for (const action of actions) {
    const name = action.command
    if (name === undefined || refused.has(name)) {
      continue
    }
    const description = text.actionCommandDescription(actionLabelOf(action))
    if (registered.get(name) === description) {
      continue
    }
    try {
      await $.command.register({ name, description, argumentHint: '[text]' })
      registered.set(name, description)
    } catch {
      refused.add(name)
      $.ui.toast(text.actionCommandRefused(name))
    }
  }
}

/** Serves `/<command>`: a prompt goes to the lead with what was typed after it, MCP answers here. */
export const registerActionCommands = (on: On): void => {
  on('command.run', async ($, e, next) => {
    if (!registered.has(e.command)) {
      return next(e)
    }
    const action = current.find((one) => one.command === e.command)
    if (action === undefined) {
      return { text: gameStrings().text.actionCommandGone(e.command) }
    }
    // Why on the clock: the engine refuses a prompt submitted from inside a hook the turn waits on.
    if ('prompt' in action) {
      $.clock.after(0, () => void runAction($, action, quest.isDemo, e.args).catch(() => undefined))
      return {}
    }
    const outcome = await runAction($, action, quest.isDemo).catch(() => undefined)
    return outcome === undefined ? {} : { text: outcome.lines.join('\n') }
  })
}
