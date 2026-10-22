import { createHash } from 'node:crypto'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  gameLessonOf,
  mergeGameLesson,
  mergeGameLessonLists,
  parseGameLesson,
  type GameLesson,
  type GameLessonSignal
} from '../../shared/orchestrator-game-lessons'

/** A project as the lessons know it: the host's key, and the name and folder Engram files it under. */
export type GameLessonProject = { key: string; name: string; directory: string | null }

/** A second home for lessons, such as Engram; any call may fail or time out. */
export type GameLessonMirror = {
  save: (project: GameLessonProject, lesson: GameLesson) => Promise<void>
  list: (project: GameLessonProject) => Promise<GameLesson[]>
}

// Why raw: keys and lessons this build cannot read were written by a newer one, and a rewrite
// that dropped them would cost them after a one-release downgrade.
type Loaded = {
  lessons: GameLesson[]
  unread: unknown[]
  data: Record<string, unknown>
  isDamaged: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fileStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

/** Each project's lessons, one bounded JSON file per project on the Orca host. */
export class GameLessonStore {
  // Why per project: two records to one file must not read the same old list and drop one.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly dirOf: () => string) {}

  async list(projectKey: string): Promise<GameLesson[]> {
    return (await this.read(projectKey)).lessons
  }

  /** The lesson as stored: merged into an earlier one with the same fingerprint. */
  record(projectKey: string, lesson: GameLesson): Promise<GameLesson> {
    const previous = this.queues.get(projectKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const { lessons, unread, data, isDamaged } = await this.read(projectKey)
        const merged = mergeGameLesson(lessons, lesson)
        await mkdir(this.dirOf(), { recursive: true })
        const file = this.fileOf(projectKey)
        if (isDamaged) {
          // Why: a damaged file must cost its lessons, never the record that writes it.
          await rename(
            file,
            join(this.dirOf(), `${this.nameOf(projectKey)}.damaged-${fileStamp()}.json`)
          )
        }
        await writeFileDurable(
          durableWriteTempPath(file),
          file,
          JSON.stringify({ version: 1, ...data, lessons: [...unread, ...merged] })
        )
        return merged.find((one) => one.fingerprint === lesson.fingerprint) ?? lesson
      })
    this.queues.set(projectKey, next)
    return next
  }

  private async read(projectKey: string): Promise<Loaded> {
    let text: string
    try {
      text = await readFile(this.fileOf(projectKey), 'utf8')
    } catch {
      return { lessons: [], unread: [], data: {}, isDamaged: false }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { lessons: [], unread: [], data: {}, isDamaged: true }
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.lessons)) {
      return { lessons: [], unread: [], data: {}, isDamaged: true }
    }
    const lessons: GameLesson[] = []
    const unread: unknown[] = []
    for (const one of parsed.lessons) {
      const lesson = parseGameLesson(one)
      if (lesson) {
        lessons.push(lesson)
      } else {
        unread.push(one)
      }
    }
    return { lessons, unread, data: parsed, isDamaged: false }
  }

  private nameOf(projectKey: string): string {
    return createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
  }

  private fileOf(projectKey: string): string {
    return join(this.dirOf(), `${this.nameOf(projectKey)}.json`)
  }
}

/** Orca's store is always written; the mirror is best effort, and reads merge both. */
export class GameLessons {
  constructor(private readonly deps: { store: GameLessonStore; mirror: GameLessonMirror | null }) {}

  async record(project: GameLessonProject, signal: GameLessonSignal): Promise<GameLesson> {
    const lesson = await this.deps.store.record(project.key, gameLessonOf(signal))
    await this.deps.mirror?.save(project, lesson).catch(() => undefined)
    return lesson
  }

  async list(project: GameLessonProject): Promise<GameLesson[]> {
    const [own, mirrored] = await Promise.all([
      this.deps.store.list(project.key),
      this.deps.mirror?.list(project).catch(() => []) ?? Promise.resolve([])
    ])
    return mergeGameLessonLists(own, mirrored)
  }
}
