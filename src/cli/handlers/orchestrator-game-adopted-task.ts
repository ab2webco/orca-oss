import type { CommandHandler } from '../dispatch'
import { recordGameMember } from './orchestrator-game-board-call'
import type { GameAdoptedResume } from '../../shared/orchestrator-game-adopted-members'

type Client = Parameters<CommandHandler>[0]['client']

/** The task an adopted member resumes on: its own, or a new one under its name once that is done (ORCA-1141). */
export async function adoptedTaskOf(
  client: Client,
  from: string,
  outcome: GameAdoptedResume
): Promise<string> {
  if (!outcome.newTask) {
    return outcome.member.taskId
  }
  const name = outcome.member.name ?? outcome.member.ticket
  const created = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    spec: `You are a member of this project's lead again after Orca restarted, as ${name}. Keep working on what you were doing; report to the lead through the Orca commands below.`,
    taskTitle: name,
    callerTerminalHandle: from
  })
  // Why saved before the start: a start that fails leaves the member on its new, ready task.
  await recordGameMember(client, { ticket: outcome.member.ticket, taskId: created.result.task.id })
  return created.result.task.id
}
