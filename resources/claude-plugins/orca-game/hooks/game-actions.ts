import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ActionRun, ActionRuns, GameAction, GameMcpCall, GameProjectItem } from '../types'
import { actionErrorOf, actionResultOf } from './action-results'
import { gameStrings } from './game-strings'
import { actionLabelOf, commandPromptOf } from './lead-actions'

const actionRuns = atom({ plugin: 'orca-game', key: 'actions' } as const, {} as ActionRuns)

/** Each MCP action's last run; reading it while the Panel draws redraws it when a call finishes. */
export async function actionRunsOf($: EngineInterface): Promise<ActionRuns> {
  return read($, actionRuns).catch((): ActionRuns => ({}))
}

/** What an MCP action runs, as the Panel shows it beside the label. */
export const mcpCallTextOf = (mcp: GameMcpCall): string => `${mcp.server}·${mcp.tool}`

// Why toast before the result: submit resolves only once the lead's turn starts.
async function submitToLead($: EngineInterface, text: string, label: string): Promise<void> {
  const strings = gameStrings().text
  $.ui.toast(strings.sentToLead(label))
  const result = await $.prompt.submit({ text }).catch(() => undefined)
  if (result === undefined || result.drop !== undefined) {
    $.ui.toast(strings.couldNotSend(label))
  }
}

async function runMcp($: EngineInterface, id: string, mcp: GameMcpCall): Promise<ActionRun> {
  const call = mcpCallTextOf(mcp)
  let run = 0
  await update($, actionRuns, (runs): ActionRuns => {
    run = (runs[id]?.run ?? 0) + 1
    return { ...runs, [id]: { status: 'running', lines: [], call, run } }
  })
  const outcome = await $.mcp
    .call(mcp.server, mcp.tool, mcp.args)
    .then(actionResultOf, actionErrorOf)
  // A press made while this one ran owns the slot now; its result is the one to keep.
  await update(
    $,
    actionRuns,
    (runs): ActionRuns =>
      runs[id]?.run === run ? { ...runs, [id]: { ...outcome, call, run } } : runs
  )
  return outcome
}

/** Runs an action, `typed` appended to its prompt; during /quest demo it only says so. */
export async function runAction(
  $: EngineInterface,
  action: GameAction,
  isDemo: boolean,
  typed = ''
): Promise<ActionRun | undefined> {
  const label = actionLabelOf(action)
  if (isDemo) {
    $.ui.toast(gameStrings().text.demoAction(label))
    return undefined
  }
  if ('prompt' in action) {
    await submitToLead($, commandPromptOf(action.prompt, typed), label)
    return undefined
  }
  return runMcp($, action.id, action.mcp)
}

/** Sends the lead a To Do ticket's work prompt; during /quest demo it only says so. */
export async function workOn(
  $: EngineInterface,
  item: GameProjectItem,
  isDemo: boolean
): Promise<void> {
  const label = gameStrings().text.workOn(item.id)
  if (item.prompt === undefined) {
    return
  }
  if (isDemo) {
    $.ui.toast(gameStrings().text.demoAction(label))
    return
  }
  await submitToLead($, item.prompt, label)
}
