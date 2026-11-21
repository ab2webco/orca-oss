import { vi } from 'vitest'
import { teamLeadViewOf, type TeamDrawerData } from './team-drawer-model'
import { TEAM_TONE_DEFAULTS } from './team-status-tone'

// Why a module: the Team sheet's render suites share one team, so each stays under the line cap.
export const question = {
  id: 'q1',
  ticket: 'ORCA-7',
  question: 'Merge the chain now?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-02T10:00:00.000Z',
  answer: null
}

export const waiting = {
  id: 'msg_w',
  ticket: 'ORCA-3',
  kind: 'decision_gate' as const,
  subject: 'Pick the port',
  body: 'Use 6768 or 6769?',
  at: '2026-11-02T09:00:00.000Z',
  answerer: 'lead'
}
export const answered = {
  id: 'msg_a',
  ticket: 'ORCA-1',
  kind: 'question' as const,
  question: 'Rebase before review?',
  answer: 'Yes, rebase first.',
  askedAt: '2026-11-02T08:00:00.000Z',
  answeredAt: '2026-11-02T08:05:00.000Z'
}
export const thread = {
  ticket: 'ORCA-1',
  last: '2026-11-02T08:05:00.000Z',
  waiting: 0,
  messages: [
    {
      id: 'm1',
      at: '2026-11-02T08:00:00.000Z',
      from: 'ORCA-1',
      to: 'lead',
      kind: 'question',
      subject: 'Rebase?',
      body: 'Rebase on main?',
      failure: null
    },
    {
      id: 'm2',
      at: '2026-11-02T08:05:00.000Z',
      from: 'lead',
      to: 'ORCA-1',
      kind: 'answer',
      subject: 'Re: Rebase?',
      body: 'Yes, rebase first.',
      failure: null
    }
  ]
}

export const member = (
  paneKey: string,
  displayName: string,
  state: string,
  over: Record<string, unknown> = {}
) => ({
  paneKey,
  displayName,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

export const NOW = 20 * 60_000

export const ADVISOR_LINE =
  'Approved Sonnet 5.5 · high for ORCA-9: the change only touches its tests, so a smaller model is enough.'

export const leader = {
  paneKey: 'tab-0:leaf',
  displayName: 'Lead pane',
  agentType: 'claude',
  state: 'working',
  toolName: 'Read',
  toolInput: 'ORCA-9',
  isLeader: true,
  isMember: false,
  launch: { model: 'Opus 5.5', effort: 'high' },
  advisor: {
    model: null,
    effort: null,
    pinned: { model: false, effort: false },
    line: ADVISOR_LINE
  }
}

export function teamWith(
  over: Partial<TeamDrawerData> = {},
  lead: Record<string, unknown> | null = null,
  extra: Record<string, unknown> = {}
): TeamDrawerData {
  const view = teamLeadViewOf(
    {
      role: 'lead',
      lead: { autostart: false, cap: 4, agent: 'claude' },
      leadName: 'Castillo',
      worktree: { id: 'repo::/lead' },
      inboxes: [
        {
          key: 'ORCA-9',
          unread: 0,
          last: { at: 'x', from: 'ORCA-9', subject: 'Tests green, opening the PR' },
          waiting: []
        }
      ],
      agents: [
        ...(lead ? [lead] : []),
        member('a', 'ORCA-1 idle one', 'idle'),
        member('b', 'ORCA-7 asker', 'working'),
        member('c', 'Juno', 'working', {
          workItem: {
            provider: 'plane',
            identifier: 'ORCA-9',
            title: 'Terminal role pill',
            url: 'u',
            status: 'In Progress',
            statusGroup: 'started'
          },
          toolName: 'Edit',
          toolInput: 'terminal-role.ts',
          stateSince: 8 * 60_000,
          launch: { model: 'opus', effort: 'high' },
          account: { provider: 'claude', id: 'a', email: 'dev@example.com' },
          review: {
            provider: 'github',
            number: 850,
            title: 'p',
            url: 'https://pr/850',
            state: 'open',
            ci: 'success',
            ciHistory: [
              { headSha: 'a', ci: 'failure' },
              { headSha: 'b', ci: 'success' }
            ],
            commentCount: 3
          }
        }),
        member('d', 'Rho', 'idle', {
          limit: { resetsAt: null, loggedOut: true },
          remote: { host: 'iMac', stateKnown: true }
        })
      ],
      metrics: {
        claudeAccounts: [{ email: 'dev@example.com', sessionPercent: 37, weeklyPercent: 61 }],
        mergedPerDay: [{ day: '2026-11-02', merged: 4 }],
        leadTime: { medianMs: 2 * 3_600_000, measured: 4 }
      },
      ...extra
    },
    new Set(['ORCA-7']),
    null,
    NOW
  )
  return {
    view,
    questions: [question],
    answerWorktreeId: 'repo::/main',
    inbox: {
      kind: 'ready',
      threads: { threads: [thread], waiting: [waiting], answered: [answered] }
    },
    answer: vi.fn(async () => {}),
    level: null,
    sceneArt: null,
    sendAction: null,
    tones: TEAM_TONE_DEFAULTS,
    ...over
  }
}

export const safeArea = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 }
}

export const texts = (): string[] =>
  [...document.body.querySelectorAll<HTMLElement>('div')]
    .filter((one) => one.childElementCount === 0)
    .map((one) => one.textContent ?? '')

export function button(label: string): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!found) {
    throw new Error(`no control labelled ${label}`)
  }
  return found
}

export const GB = 1024 ** 3
export const work = {
  project: {
    reviews: {
      total: 2,
      url: 'https://github.com/acme/web/pulls',
      items: [
        {
          id: '#416',
          title: 'Webhook signature check',
          url: 'https://pr/416',
          status: 'success'
        },
        { id: '#415', title: 'Rate limit dashboard', url: 'https://pr/415', status: 'failure' }
      ]
    },
    todo: null,
    queue: {
      provider: 'github',
      entries: [
        {
          id: '#409',
          title: 'Checkout copy review',
          url: 'https://pr/409',
          position: 1,
          state: 'checks',
          since: null
        },
        {
          id: '#412',
          title: 'Retry policy',
          url: 'https://pr/412',
          position: 2,
          state: 'waiting',
          since: null
        }
      ]
    }
  },
  hostCapacity: [
    {
      host: 'local',
      status: 'ok',
      running: 2,
      cap: 5,
      cpuCoreCount: 8,
      totalMemory: 100 * GB,
      availableMemory: 39 * GB,
      loadAverage1m: 1
    },
    {
      host: 'imac',
      status: 'ok',
      running: 1,
      cpuCoreCount: 8,
      totalMemory: 16 * GB,
      availableMemory: 2 * GB,
      loadAverage1m: 1
    },
    { host: 'contabo', status: 'unreachable', running: 0 }
  ]
}

export const gamePanel = (style: string, look = 'game') => ({
  panel: {
    look,
    style,
    tabs: { prs: true, machines: true },
    advisor: true,
    arcade: true
  }
})
