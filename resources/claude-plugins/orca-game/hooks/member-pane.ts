import type { GameState } from '../types'

let isLaunchedAsMember = false

/** Orca launches a member with ORCA_GAME_ROLE=member, so its band is right before the first poll. */
export const setLaunchRole = (role: string | null | undefined): void => {
  isLaunchedAsMember = role?.trim().toLowerCase() === 'member'
}

export const isMemberPane = (state: Pick<GameState, 'role'> | null): boolean =>
  isLaunchedAsMember || state?.role === 'member'

// Why no CLI name: the member may run `orca`, `orca-dev` or a quoted absolute path.
const ASK = /(?:^|\s)orchestration\s+ask\s/
const QUESTION = /--question(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/
const MAX_QUESTION = 200

/** The question an `orca orchestration ask` command puts to the lead, or undefined for any other command. */
export const askedQuestionOf = (command: unknown): string | undefined => {
  if (typeof command !== 'string' || !ASK.test(command)) {
    return undefined
  }
  const match = QUESTION.exec(command)
  const text = (match?.[1]?.replace(/\\(.)/g, '$1') ?? match?.[2] ?? match?.[3] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? undefined : text.slice(0, MAX_QUESTION)
}

let pending: string | undefined
// Why session-only, like the text toggle: a reload opens the band again.
let isCollapsed = false

/** A collapsed member band is its menu row only, and its turn draws no scene. */
export const isMemberBandCollapsed = (): boolean => isCollapsed

export const setMemberBandCollapsed = (collapsed: boolean): void => {
  isCollapsed = collapsed
}

export const pendingQuestion = (): string | undefined => pending

/** Holds the question while its `ask` blocks on the lead's answer. */
export const holdQuestion = (question: string | undefined): void => {
  pending = question
}
