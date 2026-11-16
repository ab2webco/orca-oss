import type { EngineInterface } from 'claude-code'

import type { StewardPhase } from './steward-rules'

// The steward's only model call (ORCA-1242): Haiku 5.5 names the kind of work when no plan does.
// It runs on the member's own session and account, and any failure keeps the current model.

export const STEWARD_JUDGE_MODEL = 'claude-haiku-5-5'
export const STEWARD_JUDGE_BUDGET = 20
const JUDGE_GAP_MS = 180_000
const JUDGE_TIMEOUT_MS = 8000
const TASK_CHARS = 1500
const TOOL_LINES = 10
const WHY_CHARS = 120

const KIND_PHASE: Readonly<Record<string, StewardPhase>> = {
  read: 'map',
  implement: 'implement',
  'review-design': 'design',
  captures: 'captures',
  stuck: 'test-fix'
}

export type StewardVerdict = { phase: StewardPhase; confidence: number; why: string }
export type StewardJudgeBudget = { calls: number; lastAt: number | null }
export type StewardJudgement =
  | { verdict: StewardVerdict; tokens: { input: number; output: number } }
  | {
      verdict: null
      failure: 'api-error' | 'empty-reply' | 'aborted' | 'unreadable' | 'refused'
    }

export const stewardJudgeAllowed = (budget: StewardJudgeBudget, now: number): boolean =>
  budget.calls < STEWARD_JUDGE_BUDGET &&
  (budget.lastAt === null || now - budget.lastAt >= JUDGE_GAP_MS)

const SYSTEM = [
  'You classify what a coding agent is about to do, so a cheaper or stronger model can serve it.',
  'Kinds: read (reading, mapping, auditing), implement (editing code), review-design (reviewing or',
  'designing), captures (taking or reading screenshots), stuck (repeating a failing fix).'
].join(' ')
const ANSWER =
  'Answer with one JSON object and nothing else: {"kind": "<kind>", "confidence": <0..1>, "why": "<under 15 words>"}'

export function stewardJudgePromptOf(input: { task: string; tools: readonly string[] }): string {
  const tools = input.tools.slice(-TOOL_LINES)
  return [
    `Task: ${input.task.trim().slice(0, TASK_CHARS)}`,
    tools.length === 0 ? 'No tools used yet.' : `Last tools:\n${tools.join('\n')}`,
    `Which kind of work is next? ${ANSWER}`
  ].join('\n\n')
}

export function stewardVerdictOf(text: string): StewardVerdict | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (json === undefined) {
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const kind: unknown = Reflect.get(raw, 'kind')
  const confidence: unknown = Reflect.get(raw, 'confidence')
  const why: unknown = Reflect.get(raw, 'why')
  const phase = typeof kind === 'string' ? KIND_PHASE[kind] : undefined
  if (phase === undefined || typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return null
  }
  const line = typeof why === 'string' ? (why.trim().split('\n')[0] ?? '').trim() : ''
  return { phase, confidence, why: line.slice(0, WHY_CHARS) }
}

/** Asks Haiku once; never throws, and a slow, failed or unreadable answer is no verdict. */
export async function askStewardJudge(
  $: EngineInterface,
  input: { task: string; tools: readonly string[] }
): Promise<StewardJudgement> {
  const reply = await $.model
    .complete({
      model: STEWARD_JUDGE_MODEL,
      effort: 'low',
      maxTokens: 200,
      timeoutMs: JUDGE_TIMEOUT_MS,
      system: SYSTEM,
      prompt: stewardJudgePromptOf(input)
    })
    .catch(() => null)
  if (reply === null) {
    return { verdict: null, failure: 'refused' }
  }
  if (!reply.isAnswered) {
    return { verdict: null, failure: reply.reason }
  }
  const verdict = stewardVerdictOf(reply.text)
  return verdict === null
    ? { verdict: null, failure: 'unreadable' }
    : { verdict, tokens: { input: reply.usage.input_tokens, output: reply.usage.output_tokens } }
}
