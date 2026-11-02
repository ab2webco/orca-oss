import { getRepoIdFromWorktreeId } from '../../src/shared/worktree/id'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'

// Every terminal is the lead of a project with five members, so the Team drawer (ORCA-952) has data.
const member = (paneKey: string, name: string, state: string, extra: Record<string, unknown>) => ({
  paneKey,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  launch: { model: 'opus', effort: null },
  ...extra
})

const workItem = (id: string, title: string, status: string) => ({
  provider: 'plane',
  identifier: id,
  title,
  url: `https://plane.example/${id}`,
  status,
  statusGroup: 'started'
})

const review = (number: number, ci: string, state = 'open') => ({
  provider: 'github',
  number,
  title: `PR ${number}`,
  url: `https://github.com/ab2webco/orca-oss/pull/${number}`,
  state,
  ci
})

const MEMBERS = [
  member('tab-9:a', 'Cipher Wren', 'idle', {
    workItem: workItem('ORCA-950', 'Metrics undercount merged per day', 'In Review'),
    review: review(845, 'success', 'merged')
  }),
  member('tab-9:b', 'Alex', 'working', {
    workItem: workItem('ORCA-949', 'Panel visual redesign for the Fleet pane', 'In Progress'),
    review: review(844, 'pending'),
    remote: { host: 'iMac', stateKnown: true }
  }),
  member('tab-9:c', 'Nova', 'waiting', {
    workItem: workItem('ORCA-948', "Fleet lists other projects' found agents", 'In Progress')
  }),
  member('tab-9:d', 'Juno', 'working', {
    workItem: workItem('ORCA-946', 'Paired-remote pane stays recovering on restart', 'In Progress'),
    review: review(843, 'failure')
  }),
  member('tab-9:e', 'Rho', 'done', {
    workItem: workItem('ORCA-943', 'Every agent talks both ways with the lead', 'Done'),
    review: review(840, 'success', 'merged')
  })
]

let questions = [
  {
    id: 'q1',
    ticket: 'ORCA-946',
    question: 'The restart spec needs a longer host relaunch budget on Linux CI. Raise it to 90 s?',
    options: ['Raise to 90 s', 'Keep 60 s'],
    context: 'https://github.com/ab2webco/orca-oss/pull/843',
    askedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    answer: null
  },
  {
    id: 'q2',
    ticket: null,
    question: 'Release lab.113 tonight or wait for ORCA-949?',
    options: ['Tonight', 'Wait'],
    context: null,
    askedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    answer: null
  }
]

function leadState(): unknown {
  return {
    role: 'lead',
    lead: { autostart: false, cap: 5, agent: 'claude', label: 'Lead' },
    agents: MEMBERS,
    openOwnerQuestions: questions.length,
    metrics: {
      computedAt: new Date().toISOString(),
      timezone: 'America/Bogota',
      mergedPerDay: [
        { day: '2026-10-30', merged: 5 },
        { day: '2026-10-31', merged: 7 },
        { day: '2026-11-01', merged: 3 },
        { day: '2026-11-02', merged: 4 }
      ],
      leadTime: { medianMs: 5.5 * 3_600_000, measured: 19 }
    }
  }
}

export function handleMockGameTeamRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown) => RpcResponse,
  activeWorktreeId: () => string | undefined
): boolean {
  if (request.method === 'game.state') {
    respond(success(request.id, leadState()))
    return true
  }
  if (request.method === 'game.ownerQuestionsAll') {
    const worktreeId = activeWorktreeId() ?? 'mock'
    const repoId = getRepoIdFromWorktreeId(worktreeId)
    respond(
      success(request.id, {
        projects: questions.length ? [{ repoId, repoName: 'orca-oss', worktreeId, questions }] : []
      })
    )
    return true
  }
  if (request.method === 'game.ownerAnswer') {
    questions = questions.filter((one) => one.id !== request.params?.id)
    respond(success(request.id, { answered: true }))
    return true
  }
  return false
}
