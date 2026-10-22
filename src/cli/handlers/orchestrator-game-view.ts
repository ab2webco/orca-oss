import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  isOrchestratorGameViewId,
  ORCHESTRATOR_GAME_VIEW_SCOPES,
  ORCHESTRATOR_GAME_VIEWS,
  type OrchestratorGameViewScope
} from '../../shared/orchestrator-game-view'
import type { OrchestratorGameViewWrite } from '../../shared/orchestrator-game-view-settings'

const wordOf = (raw: string | boolean | undefined): string =>
  typeof raw === 'string' ? raw.trim().toLowerCase() : ''

const isScope = (value: string): value is OrchestratorGameViewScope =>
  (ORCHESTRATOR_GAME_VIEW_SCOPES as readonly string[]).includes(value)

const SCOPE_NAMES: Record<OrchestratorGameViewScope, string> = {
  project: 'this project (this machine)',
  global: 'every project'
}

export const ORCHESTRATOR_GAME_VIEW_HANDLERS: Record<string, CommandHandler> = {
  'game view': async ({ flags, client, json }) => {
    const view = wordOf(flags.get('view'))
    const scope = wordOf(flags.get('scope'))
    if (!isOrchestratorGameViewId(view)) {
      const ids = ORCHESTRATOR_GAME_VIEWS.map((one) => one.id).join(', ')
      throw new RuntimeClientError('invalid_argument', `Name a view: ${ids}.`)
    }
    if (!isScope(scope)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name where to store it with --scope project or global; one pane alone changes with /orca-game:view.'
      )
    }
    // Why the pane's env: the game mod runs this from its pane, whose worktree names the project.
    const result = await client.call<OrchestratorGameViewWrite>('game.setView', {
      view,
      scope,
      worktreeId: process.env.ORCA_WORKTREE_ID,
      terminalHandle: process.env.ORCA_TERMINAL_HANDLE
    })
    printResult(result, json, (one) => `Game view ${one.view} saved for ${SCOPE_NAMES[one.scope]}`)
  }
}
