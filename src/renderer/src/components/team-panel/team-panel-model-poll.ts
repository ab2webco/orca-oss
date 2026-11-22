import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { CrashReportBreadcrumbData } from '../../../../shared/crash-reporting'
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
  /** `fresh`: the host re-reads the project's PRs and queue instead of its cached lists. */
  readState: (
    target: RuntimeClientTarget,
    caller: TeamLeadCaller,
    options: { fresh: boolean }
  ) => Promise<OrchestratorGameState | null>
  readQuestions: (
    target: RuntimeClientTarget,
    caller: TeamLeadCaller
  ) => Promise<GameOwnerQuestion[] | null>
  /** The project's characters XP summed, for a host older than `teamXp`; null when it keeps no list. */
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
  /** Notes a failure streak's start, its turn to sustained, and its end. */
  record?: (name: string, data: CrashReportBreadcrumbData) => void
}

/**
 * How long reads must keep failing before the panel shows the error over the last team.
 * Why 60 s: three missed 20 s polls; one slow read while a paired host hangs is not news (ORCA-1199).
 */
export const TEAM_READ_SUSTAINED_FAILURE_MS = 60_000

// Why 1 s: a restarted host restores the lead's pane within seconds, and 20 s of loading reads as stuck.
const RESTORING_RETRY_MS = 1_000

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const failureOf = (error: unknown): 'timeout' | 'error' =>
  hasRuntimeRpcErrorCode(error, 'runtime_timeout') || /timed out/i.test(messageOf(error))
    ? 'timeout'
    : 'error'

type ReadStage = 'game.leads' | 'game.state'

// Why one poller: the activity bar and the panel both read the model, and two polls would
// double game.state's load on a host that also serves the lead's mod.
export function createTeamPanelModelPoller(deps: TeamPanelPollDeps, intervalMs: number) {
  let active: {
    scope: TeamPanelScope
    refs: number
    /** Holders that show the model, unlike the sidebar's rows. */
    shown: number
    timer: ReturnType<typeof setInterval>
    soon: ReturnType<typeof setTimeout> | null
    reading: boolean
    again: boolean
    /** Retry now's waiters; the next read is fresh and settles them. */
    fresh: (() => void)[]
    /** The panel still shows the opening's loading view; no game.state read has settled since. */
    opening: boolean
  } | null = null
  let generation = 0
  // Why outside the run: leaving the panel ends the run, and a sick host must not cost the team.
  const lastTeams = new Map<string, TeamPanelGameModel>()
  // Why per scope and outside the run: reopening the panel mid-streak must not restart the clock.
  const failingSince = new Map<string, { at: number; last: number; sustained: boolean }>()
  // Why two polls: a longer gap means nobody read in between, so the streak proves nothing.
  const streakGapMs = intervalMs * 2

  const endStreak = (scope: TeamPanelScope, recovered: boolean): void => {
    const streak = failingSince.get(scope.key)
    failingSince.delete(scope.key)
    if (streak && recovered) {
      deps.record?.('team_panel_read_recovered', { failedForMs: Date.now() - streak.at })
    }
  }

  /** Whether reads for `scope` have now failed for the sustained window. */
  const noteFailure = (scope: TeamPanelScope, stage: ReadStage, error: unknown): boolean => {
    const now = Date.now()
    const streak = failingSince.get(scope.key)
    if (!streak || now - streak.last > streakGapMs) {
      failingSince.set(scope.key, { at: now, last: now, sustained: false })
      deps.record?.('team_panel_read_failed', {
        stage,
        failure: failureOf(error),
        sustained: false
      })
      return false
    }
    streak.last = now
    if (!streak.sustained && now - streak.at >= TEAM_READ_SUSTAINED_FAILURE_MS) {
      streak.sustained = true
      deps.record?.('team_panel_read_failed', { stage, failure: failureOf(error), sustained: true })
    }
    return streak.sustained
  }

  const publishNoTeam = (scope: TeamPanelScope): void => {
    lastTeams.delete(scope.key)
    endStreak(scope, false)
    deps.publish({ section: { kind: 'unavailable' }, retry: null }, scope)
  }

  const read = async (): Promise<void> => {
    const run = active
    const waiters = run?.fresh.splice(0) ?? []
    await (run && readOnce(run, waiters.length > 0))?.finally(() => waiters.forEach((one) => one()))
  }

  const readOnce = async (run: NonNullable<typeof active>, fresh: boolean): Promise<void> => {
    const mine = ++generation
    const current = (): boolean => mine === generation && active === run
    const { scope } = run
    const retry = (): void => void refresh()
    let stage: ReadStage = 'game.leads'
    try {
      const found = deps.findCaller(await deps.readLeads(scope.target), scope)
      if (found === 'restoring') {
        if (current()) {
          endStreak(scope, false)
          const team = lastTeams.get(scope.key)
          deps.publish(
            team
              ? { section: { kind: 'ready', value: team }, retry: null, updating: true }
              : { section: { kind: 'loading' }, retry: null },
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
      // Why only while opening: a later poll would swap an error or the no-team view for it (review N4).
      if (caller && run.opening && !lastTeams.has(scope.key) && current()) {
        deps.publish({ section: { kind: 'loading', team: true }, retry: null }, scope)
      }
      stage = 'game.state'
      let state: OrchestratorGameState | null = null
      try {
        state = caller ? await deps.readState(scope.target, caller, { fresh }) : null
      } finally {
        run.opening = false
      }
      const [questions, xp] =
        caller && state
          ? await Promise.all([
              deps.readQuestions(scope.target, caller).catch(() => null),
              // Why the state's first: it counts every reward the mod toasted; an older host sends none.
              state.teamXp
                ? state.teamXp.total
                : deps.readXp(scope.target, caller).catch(() => null)
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
      if (!current()) {
        return
      }
      if (!model) {
        publishNoTeam(scope)
        return
      }
      lastTeams.set(scope.key, model)
      endStreak(scope, true)
      // Why: a panel opening draws the sidebar's read before re-reading, so it is the last team, not news.
      deps.publish(
        {
          section: { kind: 'ready', value: model },
          retry: null,
          ...(run.shown === 0 ? { updating: true } : {})
        },
        scope
      )
    } catch (error) {
      // Why: a failed game.leads read shows its error too, which a later skeleton must not replace.
      run.opening = false
      if (!current()) {
        return
      }
      // Why: a host older than the game has nothing to read, which is no team and not a failure.
      if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
        publishNoTeam(scope)
        return
      }
      const sustained = noteFailure(scope, stage, error)
      // Why keep the last team: one failed read says nothing about the team, only about the host.
      const team = lastTeams.get(scope.key)
      if (team && !sustained) {
        deps.publish(
          { section: { kind: 'ready', value: team }, retry: null, updating: true },
          scope
        )
        return
      }
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

  // Why the last team: the loader stood until a fresh read landed, which took up to 16 s (ORCA-1199).
  const publishOpening = (scope: TeamPanelScope): void => {
    const team = lastTeams.get(scope.key)
    deps.publish(
      team
        ? { section: { kind: 'ready', value: team }, retry: null, updating: true }
        : { section: { kind: 'loading' }, retry: null },
      scope
    )
  }

  // Why: a panel opening on the sidebar's run reads fresh, as it did with a run of its own.
  const restart = (run: NonNullable<typeof active>): void => {
    generation += 1
    clearInterval(run.timer)
    run.timer = setInterval(() => void refresh(), intervalMs)
    run.reading = false
    run.again = false
    run.opening = true
    publishOpening(run.scope)
    void refresh()
  }

  const stop = (): void => {
    if (active) {
      active.fresh.splice(0).forEach((settle) => settle())
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
    /** Re-reads with the host's lists fresh; settles once that read lands, or the run ends. */
    refreshFresh(): Promise<void> {
      const run = active
      if (!run) {
        return Promise.resolve()
      }
      return new Promise<void>((settle) => {
        run.fresh.push(settle)
        void refresh()
      })
    },
    /** `background`: the holder keeps the run going without showing it, so it never re-reads on join. */
    subscribe(scope: TeamPanelScope, options: { background?: boolean } = {}): () => void {
      const shows = options.background !== true
      if (active?.scope.key !== scope.key) {
        stop()
        publishOpening(scope)
        active = {
          scope,
          refs: 0,
          shown: 0,
          soon: null,
          reading: false,
          again: false,
          fresh: [],
          opening: true,
          timer: setInterval(() => void refresh(), intervalMs)
        }
        void refresh()
      } else if (shows && active.shown === 0 && active.refs > 0) {
        restart(active)
      }
      const run = active
      if (!run) {
        return () => {}
      }
      run.refs += 1
      run.shown += shows ? 1 : 0
      return () => {
        run.refs -= 1
        run.shown -= shows ? 1 : 0
        if (run.refs === 0 && active === run) {
          stop()
        }
      }
    }
  }
}
