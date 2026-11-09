import type { CommandHandler } from '../dispatch'
import { recordGameMember } from './orchestrator-game-board-call'
import { bindRunOf, resumeOne } from './orchestrator-game-resume-members'
import {
  adoptedMemberKeyOf,
  type GameStatePausedMember
} from '../../shared/orchestrator-game-adopted-members'

type Client = Parameters<CommandHandler>[0]['client']

export type AdoptedMemberResume = {
  name: string
  adopted: boolean
  terminal: string
  dispatchId?: string
  refusal?: string
}

/** A paused adopted member resumes on its own task, so it keeps its name and Inbox thread. */
export async function resumeAdoptedMember(
  client: Client,
  from: string,
  saved: GameStatePausedMember,
  terminal: string
): Promise<AdoptedMemberResume> {
  const name = saved.name ?? saved.ticket
  const refused = await bindRunOf(client, from, saved, 0)
  if (refused) {
    return { name, adopted: false, terminal, refusal: refused }
  }
  const resumed = await resumeOne(client, from, saved.ticket)
  return {
    name,
    adopted: Boolean(resumed.dispatchId),
    terminal,
    ...(resumed.dispatchId ? { dispatchId: resumed.dispatchId } : {}),
    ...(resumed.reason ? { refusal: resumed.reason } : {})
  }
}

/** Saves a member adopted on this machine: a restart ends its dispatch, and resume-members brings it back by this record. */
export async function saveAdoptedMember(
  client: Client,
  member: {
    name: string
    runId: string | undefined
    taskId: string
    dispatchId: string
    worktreeId: string
    agent: string | null
    state: string
    paneKey: string
  }
): Promise<void> {
  const ticket = adoptedMemberKeyOf(member.name)
  if (!member.runId || !ticket || member.state === 'failed') {
    return
  }
  await recordGameMember(client, {
    ticket,
    name: member.name,
    runId: member.runId,
    taskId: member.taskId,
    dispatchId: member.dispatchId,
    worktreeId: member.worktreeId,
    agent: member.agent ?? undefined,
    lastState: member.state,
    adoptedPaneKey: member.paneKey
  })
}
