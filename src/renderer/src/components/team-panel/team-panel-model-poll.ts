import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import type { TeamLeadCaller } from './team-panel-lead-read'
import type { TeamPanelModelSource } from './use-team-panel-model'

/** One project on one host; `key` changes whenever either does. */
export type TeamPanelScope = {
  key: string
  target: RuntimeClientTarget
  repoId: string
  projectName: string
  worktreeIds: ReadonlySet<string>
}

export type TeamPanelPollDeps = {
  readLeads: (target: RuntimeClientTarget) => Promise<{ handle: string }[]>
  findCaller: (leads: { handle: string }[], scope: TeamPanelScope) => TeamLeadCaller | null
  readState: (
    target: RuntimeClientTarget,
    caller: TeamLeadCaller
  ) => Promise<OrchestratorGameState | null>
  readQuestions: (
    target: RuntimeClientTarget,
    caller: TeamLeadCaller
  ) => Promise<GameOwnerQuestion[] | null>
  modelOf: (args: {
    repoId: string
    projectName: string
    state: OrchestratorGameState
    questions: GameOwnerQuestion[] | null
  }) => TeamPanelGameModel | null
  publish: (source: TeamPanelModelSource) => void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Why one poller: the activity bar and the panel both read the model, and two polls would
// double game.state's load on a host that also serves the lead's mod.
export function createTeamPanelModelPoller(deps: TeamPanelPollDeps, intervalMs: number) {
  let active: {
    scope: TeamPanelScope
    refs: number
    timer: ReturnType<typeof setInterval>
    ready: boolean
  } | null = null
  let generation = 0

  const refresh = async (): Promise<void> => {
    const run = active
    if (!run) {
      return
    }
    const mine = ++generation
    const { scope } = run
    const retry = (): void => void refresh()
    try {
      const caller = deps.findCaller(await deps.readLeads(scope.target), scope)
      const state = caller ? await deps.readState(scope.target, caller) : null
      const questions =
        caller && state ? await deps.readQuestions(scope.target, caller).catch(() => null) : null
      const model = state
        ? deps.modelOf({ repoId: scope.repoId, projectName: scope.projectName, state, questions })
        : null
      if (mine !== generation || active !== run) {
        return
      }
      run.ready = model !== null
      deps.publish({
        section: model ? { kind: 'ready', value: model } : { kind: 'unavailable' },
        retry: null
      })
    } catch (error) {
      // Why keep the last team: one failed read says nothing about the team.
      if (mine !== generation || active !== run || run.ready) {
        return
      }
      deps.publish({ section: { kind: 'error', message: messageOf(error) }, retry })
    }
  }

  const stop = (): void => {
    if (active) {
      clearInterval(active.timer)
      active = null
      generation += 1
    }
  }

  return {
    subscribe(scope: TeamPanelScope): () => void {
      if (active?.scope.key !== scope.key) {
        stop()
        deps.publish({ section: { kind: 'loading' }, retry: null })
        active = {
          scope,
          refs: 0,
          ready: false,
          timer: setInterval(() => void refresh(), intervalMs)
        }
        void refresh()
      }
      const run = active
      if (!run) {
        return () => {}
      }
      run.refs += 1
      return () => {
        run.refs -= 1
        if (run.refs === 0 && active === run) {
          stop()
        }
      }
    }
  }
}
