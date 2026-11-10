import { describe, expect, it } from 'vitest'
import type {
  TeamAgentFacts,
  TeamLeadCard,
  TeamMemberCard,
  TeamPullRequest
} from '../team-panel-model-types'
import { teamSceneInputOf } from './team-scene-input'

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
        activity: 'resting',
        reportId: null,
        mergedPr: null,
        site: { stage: 0, broken: false }
      }
    ])
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
