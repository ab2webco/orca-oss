import type { GameMode } from '../types'
import { gameStrings } from './game-strings'

export const QUEST_MODES: readonly GameMode[] = ['off', 'on', 'zen']

export const NOTE_MIN_CHARS = 240

export const isQuestMode = (value: unknown): value is GameMode =>
  typeof value === 'string' && (QUEST_MODES as readonly string[]).includes(value)

export type QuestCommand = { mode: GameMode } | { error: string } | { show: true } | { demo: true }

export const questCommandOf = (args: string): QuestCommand => {
  const asked = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
  if (asked === '') {
    return { show: true }
  }
  if (asked === 'demo') {
    return { demo: true }
  }
  return isQuestMode(asked) ? { mode: asked } : { error: gameStrings().text.unknownMode(asked) }
}

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const value: unknown = Reflect.get(input, key)
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const basename = (path: string): string => path.split('/').findLast((part) => part !== '') ?? path

const firstLine = (text: string, max = 60): string => {
  const line = (text.split('\n')[0] ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const isEditTool = (tool: string): boolean =>
  tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit'

export const activityOf = (tool: string, input: unknown): string => {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path')
  const target = path === undefined ? '' : ` ${basename(path)}`
  const art = gameStrings().art
  switch (tool) {
    case 'Read':
      return `${art.reading}${target}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `${art.editing}${target}`
    case 'Write':
      return `${art.writing}${target}`
    case 'Bash':
      return firstLine(field(input, 'description') ?? field(input, 'command') ?? art.runningCommand)
    case 'Grep':
    case 'Glob':
      return art.searchingCode
    case 'Agent':
    case 'Task':
      return art.delegating(firstLine(field(input, 'description') ?? art.anAgent))
    case 'WebFetch':
    case 'WebSearch':
      return art.researchingWeb
    case 'Skill':
      return art.running(field(input, 'skill') ?? art.aSkill)
    default: {
      const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool)
      return art.using(mcp === null ? tool : `${mcp[1]} ${mcp[2]}`)
    }
  }
}

export const noteKey = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed === '') {
    return ''
  }
  return text.includes('\n') ? `${trimmed}\n` : trimmed
}

export const cardKeyOf = (requestId: string, text: string): string =>
  `${requestId}\u0000${noteKey(text)}`

export const isSubstantive = (text: string): boolean =>
  text.trim().includes('\n') || text.trim().length >= NOTE_MIN_CHARS

export type StepOutcome = { stopReason: string | null; toolUses: readonly unknown[] }

export const isWorkingNote = (step: StepOutcome, text: string): boolean => {
  const midTurn =
    step.stopReason === 'tool_use' || (step.stopReason === 'max_tokens' && step.toolUses.length > 0)
  return midTurn && !isSubstantive(text)
}

export type StoredRow = { role: 'user' | 'assistant'; text: string; toolUses: readonly unknown[] }

export const restoredNotesOf = (
  rows: readonly StoredRow[]
): { notes: string[]; replies: string[] } => {
  const notes = new Set<string>()
  const replies = new Set<string>()
  rows.forEach((row, index) => {
    if (row.role !== 'assistant') {
      return
    }
    const key = noteKey(row.text)
    if (key === '') {
      return
    }
    // A short note whose turn goes on to call a tool was mid-turn chatter, not a reply.
    let calledTools = row.toolUses.length > 0
    for (let later = index + 1; !calledTools && rows[later]?.role === 'assistant'; later += 1) {
      calledTools = (rows[later]?.toolUses.length ?? 0) > 0
    }
    if (calledTools && !isSubstantive(row.text)) {
      notes.add(key)
    } else {
      replies.add(key)
    }
  })
  for (const key of replies) {
    notes.delete(key)
  }
  return { notes: [...notes], replies: [...replies] }
}

export type FlowPhase = 'docs' | 'build' | 'verify' | 'pr' | 'handoff'

const DOCS_PATH = /(^|\/)docs\/|\.mdx?$/
const VERIFY_COMMAND =
  /\b(vitest|jest|pytest|rspec|playwright|rubocop|tsc|eslint|oxlint)\b|\b(pnpm|npm|yarn|bun)( run)? (test|lint|typecheck|e2e)\b|\b(cargo|go|rails|mix|dotnet) test\b|\bmake test\b|\bplugin test\b/
const PR_COMMAND =
  /\bgit push\b|\bgh pr (create|ready|edit|review)\b|\bglab mr (create|update|approve)\b|\/pulls\/\d+\/comments|resolveReviewThread/
const MERGE_COMMAND = /\bgh pr merge\b|\bglab mr merge\b/
const TRACKER_COMMAND = /\borca (plane|linear) status set\b/
const TRACKER_TOOL = /^mcp__.+__(update_work_item|save_issue|update_issue|transition\w*)$/i

export const phaseOf = (tool: string, input: unknown): FlowPhase | undefined => {
  if (isEditTool(tool)) {
    const path = field(input, 'file_path') ?? field(input, 'notebook_path') ?? ''
    return DOCS_PATH.test(path) ? 'docs' : 'build'
  }
  if (tool === 'Bash') {
    const command = field(input, 'command') ?? ''
    if (MERGE_COMMAND.test(command) || TRACKER_COMMAND.test(command)) {
      return 'handoff'
    }
    if (PR_COMMAND.test(command)) {
      return 'pr'
    }
    return VERIFY_COMMAND.test(command) ? 'verify' : undefined
  }
  if (tool === 'Skill') {
    const skill = field(input, 'skill') ?? ''
    if (/handoff/.test(skill)) {
      return 'handoff'
    }
    if (/verify|review|test/.test(skill)) {
      return 'verify'
    }
    if (/spec|plan|docs/.test(skill)) {
      return 'docs'
    }
    return /implement|build/.test(skill) ? 'build' : undefined
  }
  return TRACKER_TOOL.test(tool) ? 'handoff' : undefined
}

export type Action = 'read' | 'edit' | 'test' | 'commit' | 'push' | 'merge' | 'track'

export const ACTIONS: readonly Action[] = [
  'read',
  'edit',
  'test',
  'commit',
  'push',
  'merge',
  'track'
]

const COMMIT_COMMAND = /\bgit commit\b/
const PUSH_COMMAND = /\bgit push\b|\bgh pr (create|ready|edit)\b|\bglab mr (create|update)\b/
const READ_COMMAND = /^\s*(cat|head|tail|sed -n|grep|rg|find|ls)\b/
const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']

const bashActionOf = (command: string): Action | undefined => {
  if (MERGE_COMMAND.test(command)) {
    return 'merge'
  }
  if (TRACKER_COMMAND.test(command)) {
    return 'track'
  }
  if (PUSH_COMMAND.test(command)) {
    return 'push'
  }
  if (COMMIT_COMMAND.test(command)) {
    return 'commit'
  }
  if (VERIFY_COMMAND.test(command)) {
    return 'test'
  }
  return READ_COMMAND.test(command) ? 'read' : undefined
}

export const actionOf = (tool: string, input: unknown): Action | undefined => {
  if (READ_TOOLS.includes(tool)) {
    return 'read'
  }
  if (isEditTool(tool)) {
    return 'edit'
  }
  if (TRACKER_TOOL.test(tool)) {
    return 'track'
  }
  return tool === 'Bash' ? bashActionOf(field(input, 'command') ?? '') : undefined
}

export const isFinishingCall = (tool: string, input: unknown): boolean => {
  if (TRACKER_TOOL.test(tool)) {
    return true
  }
  const command = tool === 'Bash' ? (field(input, 'command') ?? '') : ''
  return MERGE_COMMAND.test(command) || TRACKER_COMMAND.test(command)
}

export const isHumanOrigin = (kind: string): boolean =>
  kind !== 'task-notification' && kind !== 'scheduled-trigger'
