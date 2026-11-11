import { describe, expect, it } from 'vitest'
import type {
  TeamAgentFacts,
  TeamLeadCard,
  TeamMemberCard,
  TeamPullRequest
} from '../team-panel-model-types'
import { teamSceneInputOf } from './team-scene-input'
import { teamSceneActors } from './team-scene-actors'
import { applyTeamSceneInput, createTeamSceneWorld, stepTeamScene } from './team-scene-director'

const facts = (paneKey: string, extra: Partial<TeamAgentFacts> = {}): TeamAgentFacts => ({
  paneKey,
  terminalHandle: null,
  worktreeId: null,
  host: { kind: 'local' },
  name: paneKey,
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  account: null,
  ...extra
})
const lead = (extra: Partial<TeamLeadCard> = {}): TeamLeadCard => ({
  ...facts('lead-pane'),
  characterKey: 'king',
  branch: null,
  ownerAsk: null,
  ...extra
})
const card = (paneKey: string, extra: Partial<TeamMemberCard> = {}): TeamMemberCard => ({
  ...facts(paneKey),
  characterKey: null,
  ticket: null,
  flowPhase: null,
  summary: null,
  pr: null,
  needsYou: false,
  limitResetsAt: null,
  found: false,
  ...extra
})
const pr = (number: number, state: TeamPullRequest['state']): TeamPullRequest => ({
  provider: 'github',
  number,
  title: 't',
  url: 'u',
  state,
  ci: 'none',
  verdict: null,
  perfectMerge: null
})

describe('teamSceneInputOf in the Office', () => {
  // The owner's live team: two cards planning, one in PR, the lead finished.
  it('keeps planning and PR cards seated, each at its own desk', () => {
    const open = { ...pr(722, 'open'), ci: 'pending' as const }
    const model = {
      lead: lead({ status: 'done', condition: 'done' }),
      advisor: null,
      members: [
        card('NETSA-121', { flowPhase: 'plan' }),
        card('NETSA-222', { flowPhase: 'pr', pr: open }),
        card('NETSA-80', { flowPhase: 'plan' })
      ]
    }
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, teamSceneInputOf(model), { rowSize: 5, workSeated: true })
    const keys = model.members.map((m) => m.paneKey)
    expect(new Set(keys.map((k) => world.bodies.get(k)!.home.x)).size).toBe(3)
    let strayed: string | null = null
    for (let t = 0; t < 20 && !strayed; t += 1 / 30) {
      stepTeamScene(world, 1 / 30, { width: 390 })
      const actors = teamSceneActors(world)
      for (const k of keys) {
        const a = actors.find((one) => one.key === k)!
        if (a.x !== world.bodies.get(k)!.home.x || a.pose !== 'work') {
          strayed = `${k} at ${t.toFixed(1)}s: ${a.pose}`
        }
      }
    }
    expect(strayed).toBeNull()
  })
})

describe('teamSceneInputOf', () => {
  it('maps each member to what the scene acts out', () => {
    const input = teamSceneInputOf({
      lead: lead(),
      advisor: null,
      members: [
        card('ask', { needsYou: true, status: 'attention' }),
        card('busy', { characterKey: 'arthur', summary: 'Opened #12', pr: pr(12, 'open') }),
        card('done', { status: 'done', condition: 'done', pr: pr(9, 'merged') }),
        card('failed', { status: 'attention', condition: 'startFailed' })
      ]
    })
    expect(input.members).toEqual([
      {
        key: 'ask',
        name: 'ask',
        characterKey: null,
        activity: 'needsYou',
        reportId: null,
        mergedPr: null,
        site: { stage: 0, broken: false }
      },
      {
        key: 'busy',
        name: 'busy',
        characterKey: 'arthur',
        activity: 'working',
        reportId: 'Opened #12',
        mergedPr: null,
        site: { stage: 2, broken: false }
      },
      {
        key: 'done',
        name: 'done',
        characterKey: null,
        activity: 'done',
        reportId: null,
        mergedPr: 9,
        site: { stage: 4, broken: false }
      },
      {
        key: 'failed',
        name: 'failed',
        characterKey: null,
        activity: 'blocked',
        away: true,
        reportId: null,
        mergedPr: null,
        site: { stage: 0, broken: false }
      }
    ])
  })

  it('marks a member that cannot work as blocked, as its card does', () => {
    const input = teamSceneInputOf({
      lead: lead(),
      advisor: null,
      members: [
        card('limit', { status: 'risk', condition: 'limited' }),
        card('out', { status: 'attention', condition: 'loggedOut' }),
        card('paused', { status: 'risk', condition: 'paused' })
      ]
    })
    expect(input.members.map((m) => m.activity)).toEqual(['blocked', 'blocked', 'blocked'])
  })

  it('raises the lead hand only while it asks the user', () => {
    const asking = lead({ liveAction: { kind: 'question', text: 'Merge?', options: [] } })
    expect(teamSceneInputOf({ lead: asking, advisor: null, members: [] }).lead).toEqual({
      key: 'lead-pane',
      name: 'lead-pane',
      characterKey: 'king',
      activity: 'needsYou'
    })
    const idle = lead({ status: 'idle', condition: 'idle' })
    expect(teamSceneInputOf({ lead: idle, advisor: null, members: [] }).lead.activity).toBe(
      'resting'
    )
  })

  // ORCA-1139: a finished turn reads idle on the card unless merged, yet the scene shows it done.
  it('acts out a finished turn as done, apart from an idle agent', () => {
    const finished = card('m', { status: 'idle', condition: 'done' })
    const idle = card('i', { status: 'idle', condition: 'idle' })
    const scene = teamSceneInputOf({
      lead: lead({ status: 'idle', condition: 'done' }),
      advisor: null,
      members: [finished, idle]
    })
    expect(scene.members.map((m) => m.activity)).toEqual(['done', 'resting'])
    expect(scene.lead.activity).toBe('done')
  })

  it("hands the scene Jev's decisions in the lead's and each member's pane", () => {
    const mine = [{ id: 'l1', verdict: 'allow', gesture: 'approved' }]
    const theirs = [{ id: 'm1', verdict: 'deny', gesture: 'escalated' }]
    const input = teamSceneInputOf({
      lead: lead({ decisions: mine }),
      advisor: null,
      members: [card('a', { decisions: theirs }), card('b')]
    })
    expect(input.lead.decisions).toEqual(mine)
    expect(input.members[0]!.decisions).toEqual(theirs)
    expect(input.members[1]).not.toHaveProperty('decisions')
  })

  it('passes the advisor line only when the plugin row exists', () => {
    const advisor = {
      model: null,
      effort: null,
      pinned: { model: false, effort: false },
      line: 'Raised effort',
      previous: null,
      calls: []
    }
    expect(teamSceneInputOf({ lead: lead(), advisor, members: [] }).advisor).toEqual({
      line: 'Raised effort'
    })
    expect(teamSceneInputOf({ lead: lead(), advisor: null, members: [] }).advisor).toBeNull()
  })
})

describe('teamSceneInputOf and idle play', () => {
  // Every condition as the card builds it (team-panel-member-cards statusOf), never hand-written.
  const CARDS: [TeamMemberCard['condition'], TeamMemberCard['status'], boolean][] = [
    ['working', 'working', false],
    ['starting', 'working', false],
    ['waiting', 'attention', true],
    ['idle', 'idle', false],
    ['done', 'idle', false],
    ['queued', 'idle', false],
    ['paused', 'risk', false],
    ['asleep', 'risk', false],
    ['limited', 'risk', false],
    ['unreachable', 'risk', false],
    ['loggedOut', 'attention', false],
    ['gone', 'attention', false],
    ['startFailed', 'attention', false]
  ]

  it('lets only a truly idle member play at its desk', () => {
    const playing = CARDS.flatMap(([condition, status, needsYou]) => {
      const model = {
        lead: lead(),
        advisor: null,
        members: [card('m', { condition, status, needsYou })]
      }
      const world = createTeamSceneWorld()
      applyTeamSceneInput(world, teamSceneInputOf(model), { rowSize: 5, workSeated: true })
      for (let i = 0; i < 30; i++) {
        stepTeamScene(world, 1 / 30, { width: 420 })
      }
      return teamSceneActors(world).find((a) => a.key === 'm')?.play ? [condition] : []
    })
    expect(playing).toEqual(['idle'])
  })
})

describe('teamSceneInputOf and an empty seat', () => {
  it('leaves the seat of a member whose session is gone or never started empty, and says so', () => {
    const members = [
      card('gone', { condition: 'gone', status: 'attention' }),
      card('failed', { condition: 'startFailed', status: 'attention' }),
      card('asleep', { condition: 'asleep', status: 'risk' }),
      card('busy')
    ]
    const input = teamSceneInputOf({ lead: lead(), advisor: null, members })
    expect(input.members.map((m) => m.away === true)).toEqual([true, true, false, false])
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input, { rowSize: 5, workSeated: true })
    stepTeamScene(world, 1 / 30, { width: 420 })
    const away = teamSceneActors(world)
      .filter((a) => a.away)
      .map((a) => a.key)
    expect(away.sort()).toEqual(['failed', 'gone'])
  })
})
