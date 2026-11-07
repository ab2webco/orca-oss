import { describe, expect, it } from 'vitest'
import type { OrchestratorGameState } from './orchestrator-game-state'
import { teamMetricsOf } from './team-panel-metrics'

const stateWith = (metrics: unknown): OrchestratorGameState =>
  ({ agents: [], metrics }) as unknown as OrchestratorGameState

describe('teamMetricsOf', () => {
  it('is unavailable when the host publishes no metrics', () => {
    expect(teamMetricsOf(stateWith(undefined))).toEqual({ kind: 'unavailable' })
  })

  it('carries merges, lead time and account use as published, and no figure Orca does not have', () => {
    const metrics = {
      computedAt: '2026-11-06T12:00:00.000Z',
      timezone: 'America/Bogota',
      mergedPerDay: [
        { day: '2026-11-05', merged: 3 },
        { day: '2026-11-06', merged: 2 }
      ],
      leadTime: { medianMs: 6_120_000, measured: 5 },
      claudeAccounts: [
        { email: 'a@x.test', active: true, sessionPercent: 6, weeklyPercent: 31 },
        { email: 'b@x.test', active: false, sessionPercent: null, weeklyPercent: 88 }
      ]
    }

    expect(teamMetricsOf(stateWith(metrics))).toEqual({
      kind: 'ready',
      value: {
        timezone: 'America/Bogota',
        mergedPerDay: metrics.mergedPerDay,
        mergedPerHour24h: null,
        leadTimeMedianMs: 6_120_000,
        ciGreenPercent: null,
        ciGreenPerDay: null,
        flakyChecks: null,
        accounts: [
          { email: 'a@x.test', sessionPercent: 6, weeklyPercent: 31 },
          { email: 'b@x.test', sessionPercent: null, weeklyPercent: 88 }
        ],
        costPerDay: null
      }
    })
  })

  it('reads a host with no account services as no accounts', () => {
    const metrics = {
      computedAt: 'x',
      timezone: 'UTC',
      mergedPerDay: [],
      leadTime: { medianMs: null, measured: 0 }
    }

    expect(teamMetricsOf(stateWith(metrics))).toMatchObject({
      kind: 'ready',
      value: { accounts: [], leadTimeMedianMs: null }
    })
  })
})
