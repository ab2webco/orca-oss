import { ticketInText } from '../../shared/orchestrator-game-fleet-verbs'
import type { WorkerTerminalListState } from './orchestration/worker-terminal-ownership'
import {
  GAME_OWNER_HANDLE,
  type GameAnsweredQuestionMail,
  type GameInboxMail,
  type GameInboxSource
} from '../../shared/orchestrator-game-inbox'

/** The orchestration database reads the game inbox needs; mail is never deleted when a member closes. */
export type GameInboxDb = {
  getCurrentRunForPane: (
    paneKey: string
  ) => { id: string; coordinator_handle: string | null } | undefined
  listWorkerTerminalResources: (params: { runId?: string }) => {
    dispatchId: string
    taskId: string
    agentTerminalHandle: string | null
    terminalState?: WorkerTerminalListState | null
  }[]
  /** A remote member's home worker row: its stage is `released` once game stop freed it. */
  getWorkerDispatch?: (dispatchId: string) => { stage: string } | undefined
  getFederatedDispatch?: (dispatchId: string) => unknown
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
  const workers = run ? db.listWorkerTerminalResources({ runId: run.id }) : []
  for (const worker of workers) {
    const task = db.getTask(worker.taskId)
    // Why the name: an adopted agent's task has no ticket, and its mail still needs a home.
    const ticket =
      ticketInText(task?.task_title ?? task?.display_name) ??
      (task?.display_name || task?.task_title)?.trim()
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
  return {
    leadAddresses,
    members,
    mail,
    peerLeads,
    pendingQuestions,
    answeredQuestions,
    releasedSenders: releasedSendersOf(db, workers),
    // Why (ORCA-1431): a lead's reply to an owner answer goes to the owner, outside every address above.
    ownerReplies: db.getAllMessagesForHandle(GAME_OWNER_HANDLE, MAIL_PER_ADDRESS)
  }
}

type GameInboxWorker = ReturnType<GameInboxDb['listWorkerTerminalResources']>[number]

// Why (ORCA-1267): a member often keeps working in its pane after worker_done, so only game stop's
// release means nobody can act on an answer. Never pane registry liveness: after a restart a
// daemon-held pane stays unregistered until the UI opens it.
function released(db: GameInboxDb, worker: GameInboxWorker): boolean {
  if (db.getFederatedDispatch?.(worker.dispatchId)) {
    return db.getWorkerDispatch?.(worker.dispatchId)?.stage === 'released'
  }
  return worker.terminalState === 'released'
}

const addressesOf = (worker: GameInboxWorker): string[] => [
  `dispatch:${worker.dispatchId}`,
  ...(worker.agentTerminalHandle ? [worker.agentTerminalHandle] : [])
]

// Why: a terminal a relaunched member still uses keeps its mail waiting on the lead.
function releasedSendersOf(db: GameInboxDb, workers: readonly GameInboxWorker[]): string[] {
  const gone = workers.filter((worker) => released(db, worker))
  const live = new Set(workers.filter((worker) => !gone.includes(worker)).flatMap(addressesOf))
  return [...new Set(gone.flatMap(addressesOf).filter((one) => !live.has(one)))]
}
