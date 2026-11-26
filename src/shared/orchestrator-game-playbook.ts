import {
  gameTicketKindOf,
  parseGameTicketKind,
  type GameTicketKind
} from './orchestrator-game-ticket-kind'

/** The task kinds a project can keep a playbook for, one `<kind>.md` each (ORCA-1425). */
export const GAME_PLAYBOOKS = ['bug-fix', 'feature', 'review', 'live-check'] as const

export type GamePlaybook = (typeof GAME_PLAYBOOKS)[number]

// Why CLI-side names only: worker-start's schema takes the four model kinds, so a host would refuse a new one.
const PLAYBOOK_LAUNCH_KIND: Readonly<Record<GamePlaybook, GameTicketKind>> = {
  'bug-fix': 'implement',
  feature: 'implement',
  review: 'review',
  'live-check': 'captures'
}

const KIND_PLAYBOOK: Readonly<Partial<Record<GameTicketKind, GamePlaybook>>> = {
  review: 'review',
  captures: 'live-check'
}

const PLAYBOOKS_DIR_MAX = 200
const PLAYBOOKS_DIR = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/

/** `orchestrator.playbooks`: a folder inside the repo, as a member's worktree resolves it on any host. */
export function parsePlaybooksDir(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  const inside = text.split('/').every((part) => part !== '..' && part !== '.')
  return text.length <= PLAYBOOKS_DIR_MAX && PLAYBOOKS_DIR.test(text) && inside ? text : null
}

/** A `--kind` value: a model kind as it is, or a playbook kind with the model kind it launches as. */
export function parseGameLaunchKind(
  value: string
): { kind: GameTicketKind; playbook?: GamePlaybook } | null {
  const text = value.trim().toLowerCase()
  const playbook = GAME_PLAYBOOKS.find((one) => one === text)
  if (playbook) {
    return { kind: PLAYBOOK_LAUNCH_KIND[playbook], playbook }
  }
  const kind = parseGameTicketKind(text)
  return kind ? { kind } : null
}

/** The member's playbook: the one `--kind` named, else the one its model kind implies, else none. */
export function gamePlaybookOf(
  typed: { kind?: GameTicketKind; playbook?: GamePlaybook },
  title: string
): GamePlaybook | null {
  if (typed.playbook) {
    return typed.playbook
  }
  const kind = typed.kind ?? gameTicketKindOf(title)
  return kind ? (KIND_PLAYBOOK[kind] ?? null) : null
}

const KEEP_OR_SKIP =
  'Copy each step into your todo list and keep it, or mark it `skip: <reason>`; never drop one.'

/** The brief's one line: a link, never the playbook's text, so no member pays for it in context. */
export function gamePlaybookBriefLine(
  dir: string | undefined,
  typed: { kind?: GameTicketKind; playbook?: GamePlaybook },
  title: string
): string | null {
  if (dir === undefined) {
    return null
  }
  const playbook = gamePlaybookOf(typed, title)
  return playbook
    ? `Playbook: read ${dir}/${playbook}.md before you start. ${KEEP_OR_SKIP}`
    : `Playbooks: ${dir}/ has one per task kind (${GAME_PLAYBOOKS.join(', ')}); read the one that fits this ticket before you start. ${KEEP_OR_SKIP}`
}
