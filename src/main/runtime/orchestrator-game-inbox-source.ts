import { ticketInText } from '../../shared/orchestrator-game-fleet-verbs'
import type {
  GameAnsweredQuestionMail,
  GameInboxMail,
  GameInboxSource
} from '../../shared/orchestrator-game-inbox'

/** The orchestration database reads the game inbox needs; mail is never deleted when a member closes. */
export type GameInboxDb = {
  getCurrentRunForPane: (
    paneKey: string
  ) => { id: string; coordinator_handle: string | null } | undefined
  listWorkerTerminalResources: (params: {
    runId?: string
  }) => { dispatchId: string; taskId: string; agentTerminalHandle: string | null }[]
  getTask: (id: string) => { task_title: string | null; display_name: string | null } | undefined
  getAllMessagesForHandle: (handle: string, limit?: number) => GameInboxMail[]
  listPendingQuestions: (runId: string) => GameInboxMail[]
  listAnsweredQuestions: (runId: string, limit: number) => GameAnsweredQuestionMail[]
}

// Why 100: what `orca orchestration inbox` reads per address; older mail stays there.
const MAIL_PER_ADDRESS = 100
const ANSWERED_QUESTIONS_MAX = 100

/** The lead's addresses and every ticket's, from the lead's current run, with their mail. */
export function gameInboxSourceOf(
  db: GameInboxDb,
  lead: { handle: string; paneKey: string | null },
  peerLeads: Readonly<Record<string, string>> = {}
): GameInboxSource {
  const run = lead.paneKey ? db.getCurrentRunForPane(lead.paneKey) : undefined
  const leadAddresses = [
    ...new Set([
      lead.handle,
      run?.coordinator_handle ?? lead.handle,
      ...(run ? [`run:${run.id}`] : [])
    ])
  ]
  const byTicket = new Map<string, string[]>()
  for (const worker of run ? db.listWorkerTerminalResources({ runId: run.id }) : []) {
    const task = db.getTask(worker.taskId)
    const ticket = ticketInText(task?.task_title ?? task?.display_name)
    if (!ticket) {
      continue
    }
    const addresses = byTicket.get(ticket) ?? []
    for (const address of [worker.agentTerminalHandle, `dispatch:${worker.dispatchId}`]) {
      if (address && !addresses.includes(address)) {
        addresses.push(address)
      }
    }
    byTicket.set(ticket, addresses)
  }
  const members = [...byTicket].map(([ticket, addresses]) => ({ ticket, addresses }))
  const mail = [...leadAddresses, ...members.flatMap((member) => member.addresses)].flatMap(
    (address) => db.getAllMessagesForHandle(address, MAIL_PER_ADDRESS)
  )
  // Why: read apart from the mail window, so an old question still waits after a hundred newer messages.
  const pendingQuestions = run ? db.listPendingQuestions(run.id) : []
  const answeredQuestions = run ? db.listAnsweredQuestions(run.id, ANSWERED_QUESTIONS_MAX) : []
  return { leadAddresses, members, mail, peerLeads, pendingQuestions, answeredQuestions }
}
