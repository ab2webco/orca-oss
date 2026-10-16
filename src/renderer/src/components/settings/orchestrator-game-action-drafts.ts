import {
  parseGameActions,
  type OrchestratorGameAction
} from '../../../../shared/orchestrator-game-actions'
import { GAME_LEAD_ACTIONS } from '../../../../shared/orchestrator-game-lead-actions'

/** One editable row of the project's actions: every field as typed, MCP arguments as JSON text. */
export type ActionDraft = {
  label: string
  command: string
  kind: 'prompt' | 'mcp'
  prompt: string
  server: string
  tool: string
  args: string
}

export type ActionDraftProblem = 'label' | 'command' | 'commandTaken' | 'prompt' | 'mcp' | 'args'

export const EMPTY_ACTION_DRAFT: ActionDraft = {
  label: '',
  command: '',
  kind: 'prompt',
  prompt: '',
  server: '',
  tool: '',
  args: ''
}

const LEAD_COMMANDS: ReadonlySet<string> = new Set(
  GAME_LEAD_ACTIONS.flatMap((one) => (one.command === undefined ? [] : [one.command]))
)

export function actionDraftOf(action: OrchestratorGameAction): ActionDraft {
  const head = { ...EMPTY_ACTION_DRAFT, label: action.label, command: action.command ?? '' }
  if ('prompt' in action) {
    return { ...head, prompt: action.prompt }
  }
  return {
    ...head,
    kind: 'mcp',
    server: action.mcp.server,
    tool: action.mcp.tool,
    args: action.mcp.args === undefined ? '' : JSON.stringify(action.mcp.args)
  }
}

// Why read the parser's warning: the shared parser is the one rule orca.yaml and Orca apply.
const problemOfWarning = (warning: string): ActionDraftProblem => {
  if (warning.includes('.label ')) {
    return 'label'
  }
  if (warning.includes('.command ')) {
    return 'command'
  }
  if (warning.includes('.mcp.args ')) {
    return 'args'
  }
  return warning.includes('.mcp ') ? 'mcp' : 'prompt'
}

function rawOf(draft: ActionDraft): Record<string, unknown> | 'args' {
  const command = draft.command.trim()
  const head = { label: draft.label, ...(command === '' ? {} : { command }) }
  if (draft.kind === 'prompt') {
    return { ...head, prompt: draft.prompt }
  }
  const text = draft.args.trim()
  let args: unknown
  if (text !== '') {
    try {
      args = JSON.parse(text)
    } catch {
      return 'args'
    }
  }
  return {
    ...head,
    mcp: { server: draft.server, tool: draft.tool, ...(args === undefined ? {} : { args }) }
  }
}

/** The list Settings saves, or null while any row has a problem; one problem per row. */
export function actionsOfDrafts(drafts: readonly ActionDraft[]): {
  actions: OrchestratorGameAction[] | null
  problems: (ActionDraftProblem | null)[]
} {
  const actions: OrchestratorGameAction[] = []
  const seen = new Set<string>()
  const problems = drafts.map((draft): ActionDraftProblem | null => {
    const raw = rawOf(draft)
    if (raw === 'args') {
      return 'args'
    }
    const parsed = parseGameActions([raw])
    const action = parsed.value?.[0]
    if (action === undefined) {
      return problemOfWarning(parsed.warnings[0] ?? '')
    }
    if (action.command !== undefined) {
      if (LEAD_COMMANDS.has(action.command) || seen.has(action.command)) {
        return 'commandTaken'
      }
      seen.add(action.command)
    }
    actions.push(action)
    return null
  })
  return { actions: problems.every((one) => one === null) ? actions : null, problems }
}
