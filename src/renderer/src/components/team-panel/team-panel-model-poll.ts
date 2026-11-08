import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-result'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import type { TeamLeadCaller, TeamLeadRoster } from './team-panel-lead-read'
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
  readLeads: (target: RuntimeClientTarget) => Promise<TeamLeadRoster>
  findCaller: (roster: TeamLeadRoster, scope: TeamPanelScope) => TeamLeadCaller | 'restoring' | null
  readState: (
    target: RuntimeClientTarget,
    caller: TeamLeadCaller
  ) => Promise<OrchestratorGameState | null>
  readQuestions: (
    target: RuntimeClientTarget,
    caller: TeamLeadCaller
  ) => Promise<GameOwnerQuestion[] | null>
  /** The project's characters XP summed; null when the host keeps no list. */
  readXp: (target: RuntimeClientTarget, caller: TeamLeadCaller) => Promise<number | null>
  modelOf: (args: {
    repoId: string
    projectName: string
    state: OrchestratorGameState
    questions: GameOwnerQuestion[] | null
    xp: number | null
  }) => TeamPanelGameModel | null
  /** `scope` is the one the source was read for. */
  publish: (source: TeamPanelModelSource, scope: TeamPanelScope) => void
}

// Why 1 s: a restarted host restores the lead's pane within seconds, and 20 s of loading reads as stuck.
const RESTORING_RETRY_MS = 1_000

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Why one poller: the activity bar and the panel both read the model, and two polls would
// double game.state's load on a host that also serves the lead's mod.
export function createTeamPanelModelPoller(deps: TeamPanelPollDeps, intervalMs: number) {
  let active: {
    scope: TeamPanelScope
    refs: number
    timer: ReturnType<typeof setInterval>
    soon: ReturnType<typeof setTimeout> | null
    reading: boolean
    again: boolean
  } | null = null
  let generation = 0
  // Why outside the run: leaving the panel ends the run, and a sick host must not cost the team.
  const lastTeams = new Map<string, TeamPanelGameModel>()

  const publishNoTeam = (scope: TeamPanelScope): void => {
    lastTeams.delete(scope.key)
    deps.publish({ section: { kind: 'unavailable' }, retry: null }, scope)
  }

  const read = async (): Promise<void> => {
    const run = active
    if (!run) {
      return
    }
    const mine = ++generation
    const { scope } = run
    const retry = (): void => void refresh()
    try {
      const found = deps.findCaller(await deps.readLeads(scope.target), scope)
      if (found === 'restoring') {
        if (mine === generation && active === run) {
          const team = lastTeams.get(scope.key)
          deps.publish(
            { section: team ? { kind: 'ready', value: team } : { kind: 'loading' }, retry: null },
            scope
          )
          run.soon ??= setTimeout(() => {
            run.soon = null
            void refresh()
          }, RESTORING_RETRY_MS)
        }
        return
      }
      const caller = found
      const state = caller ? await deps.readState(scope.target, caller) : null
      const [questions, xp] =
        caller && state
          ? await Promise.all([
              deps.readQuestions(scope.target, caller).catch(() => null),
              deps.readXp(scope.target, caller).catch(() => null)
            ])
          : [null, null]
      const model = state
        ? deps.modelOf({
            repoId: scope.repoId,
            projectName: scope.projectName,
            state,
            questions,
            xp
          })
        : null
      if (mine !== generation || active !== run) {
        return
      }
      if (!model) {
        publishNoTeam(scope)
        return
      }
      lastTeams.set(scope.key, model)
      deps.publish({ section: { kind: 'ready', value: model }, retry: null }, scope)
    } catch (error) {
      if (mine !== generation || active !== run) {
        return
      }
      // Why: a host older than the game has nothing to read, which is no team and not a failure.
      if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
        publishNoTeam(scope)
        return
      }
      // Why keep the last team: one failed read says nothing about the team, only about the host.
      const team = lastTeams.get(scope.key)
      deps.publish(
        {
          section: team
            ? { kind: 'ready', value: team }
            : { kind: 'error', message: messageOf(error) },
          retry
        },
        scope
      )
    }
  }

  // Why per run: a read for the old project must not hold back the new one's first read.
  const refresh = async (): Promise<void> => {
    const run = active
    if (!run) {
      return
    }
    if (run.reading) {
      run.again = true
      return
    }
    run.reading = true
    try {
      await read()
    } finally {
      run.reading = false
    }
    if (run.again && active === run) {
      run.again = false
      await refresh()
    }
  }

  const stop = (): void => {
    if (active) {
      clearInterval(active.timer)
      if (active.soon) {
        clearTimeout(active.soon)
      }
      active = null
      generation += 1
    }
  }

  return {
    /** Re-reads now, or once after the read in flight; nothing without a subscriber. */
    refresh(): void {
      void refresh()
    },
    subscribe(scope: TeamPanelScope): () => void {
      if (active?.scope.key !== scope.key) {
        stop()
        deps.publish({ section: { kind: 'loading' }, retry: null }, scope)
        active = {
          scope,
          refs: 0,
          soon: null,
          reading: false,
          again: false,
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
