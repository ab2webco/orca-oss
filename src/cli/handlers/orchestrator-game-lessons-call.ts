import type { CommandHandler } from '../dispatch'
import { gameBoardCaller } from './orchestrator-game-board-call'
import { gameLessonBriefOf, parseGameLesson } from '../../shared/orchestrator-game-lessons'

type Client = Parameters<CommandHandler>[0]['client']

/** The project's lessons as the block a member's brief ends with; empty when there are none. */
export async function gameLessonBriefFor(client: Client, ticket: string): Promise<string> {
  // Why swallow: an older Orca has no lessons, and they never block a launch.
  const response = await client
    .call<{ lessons?: unknown }>('game.lessons', gameBoardCaller())
    .catch(() => undefined)
  const raw = response?.result?.lessons
  const lessons = Array.isArray(raw) ? raw.flatMap((one) => parseGameLesson(one) ?? []) : []
  return gameLessonBriefOf(lessons, { now: Date.now(), ticket })
}

/** The task spec with the lessons after it, so the brief's own text always comes first. */
export const withGameLessons = (spec: string, lessons: string): string =>
  lessons === '' ? spec : `${spec}\n\n${lessons}`
