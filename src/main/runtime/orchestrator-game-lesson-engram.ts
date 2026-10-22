import { createHash } from 'node:crypto'
import { parseGameLesson, type GameLesson } from '../../shared/orchestrator-game-lessons'
import type { GameLessonMirror, GameLessonProject } from './orchestrator-game-lesson-store'

/** GET without a body, POST with one; throws on any failure or timeout. */
export type EngramRequest = (path: string, body?: unknown) => Promise<unknown>

// Why a single word: Engram's full-text search splits a hyphenated marker into two terms.
const MARKER = 'orcalessonv1'
const TOPIC_PREFIX = 'orca-lesson/'
const SEARCH_LIMIT = 100
// Why: a stopped Engram must not cost every launch and sweep a timeout.
const RETRY_AFTER_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 1500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Engram's local HTTP server, as its own Claude hooks reach it. */
export function engramRequestOf(
  baseUrl = process.env.ENGRAM_URL || 'http://127.0.0.1:7437',
  timeoutMs = REQUEST_TIMEOUT_MS
): EngramRequest {
  return async (path, body) => {
    const response = await fetch(new URL(path, baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) {
      throw new Error(`Engram answered ${response.status}`)
    }
    return response.json()
  }
}

/** Lessons kept in Engram under the project's name, one row per fingerprint via its topic key. */
export class EngramLessonMirror implements GameLessonMirror {
  private readonly sessions = new Set<string>()
  private unavailableUntil = 0

  constructor(
    private readonly request: EngramRequest,
    private readonly now: () => number = Date.now
  ) {}

  async save(project: GameLessonProject, lesson: GameLesson): Promise<void> {
    const sessionId = `orca-game-lessons-${project.name}`
    if (!this.sessions.has(sessionId)) {
      await this.call('/sessions', {
        id: sessionId,
        project: project.name,
        directory: project.directory ?? ''
      })
      this.sessions.add(sessionId)
    }
    await this.call('/observations', {
      session_id: sessionId,
      type: 'learning',
      scope: 'project',
      project: project.name,
      title: `Orca lesson (${lesson.kind}): ${lesson.what.slice(0, 80)}`,
      topic_key: `${TOPIC_PREFIX}${createHash('sha256').update(lesson.fingerprint).digest('hex').slice(0, 24)}`,
      content: `${MARKER} ${JSON.stringify(lesson)}`
    })
  }

  async list(project: GameLessonProject): Promise<GameLesson[]> {
    const query = new URLSearchParams({
      q: MARKER,
      project: project.name,
      limit: String(SEARCH_LIMIT)
    })
    const rows = await this.call(`/search?${query.toString()}`)
    return (Array.isArray(rows) ? rows : []).flatMap((row) => {
      if (
        !isRecord(row) ||
        row.project !== project.name ||
        typeof row.topic_key !== 'string' ||
        !row.topic_key.startsWith(TOPIC_PREFIX) ||
        typeof row.content !== 'string' ||
        !row.content.startsWith(`${MARKER} `)
      ) {
        return []
      }
      try {
        return parseGameLesson(JSON.parse(row.content.slice(MARKER.length + 1))) ?? []
      } catch {
        return []
      }
    })
  }

  private async call(path: string, body?: unknown): Promise<unknown> {
    if (this.now() < this.unavailableUntil) {
      throw new Error('Engram unavailable')
    }
    try {
      return await this.request(path, body)
    } catch (error) {
      this.unavailableUntil = this.now() + RETRY_AFTER_MS
      throw error
    }
  }
}
