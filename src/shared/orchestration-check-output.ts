import { bashWord, bashWordOfCli } from './bash-cli-word'
import { ORCHESTRATION_LEGACY_RUN_ID } from './orchestration-rpc-contract'

export type OrchestrationMessageSummary = {
  id: string
  run_id?: string
  delivery_contract?: 'legacy_direct' | 'current_delivery' | 'audit_only'
  from_handle: string
  to_handle?: string
  subject?: string
  type?: string
  body?: string
  payload?: string | null
  priority?: string
  read?: number
}

// Why (ORCA-858): a lead watches check under Claude Code's Monitor, which cuts each line at ~500 characters and each event at ~3000.
const OUTPUT_LINE_MAX = 400

export type LegacyCompatibilityResult = {
  recovery?: boolean
  readOnly?: boolean
  ackMessageIds?: string[]
  answerAcknowledgement?: {
    questionId: string
    answerMessageId: string
  }
  currentDelivery?: {
    runId: string
    checkCommand: string
    ackCommand: string
  }
  resumeRequired?: boolean
  resumeCommand?: string
}

export type OrchestrationCheckOutput = {
  /** Commands that print each message whose body or payload a watch line would cut; first so a cut event keeps them. */
  readInFull?: string[]
  messages: OrchestrationMessageSummary[]
  count: number
  formatted?: string
  deliveryId?: string | null
  timedOut?: boolean
  cancelled?: boolean
  connectionLost?: boolean
  legacyCompatibility?: LegacyCompatibilityResult
  retired?: RetiredRunMailNotice
}

/** Run mail a check moved to history because a previous lead's era settled it (ORCA-824). */
export type RetiredRunMailNotice = {
  count: number
  /** Retired member reports whose PR is not merged or closed yet. */
  unverified: { ticket: string; pr: string | null }[]
}

function formatRetiredNotice(retired: RetiredRunMailNotice | undefined): string {
  if (!retired || retired.count === 0) {
    return ''
  }
  const noun = retired.count === 1 ? 'message' : 'messages'
  const unverified =
    retired.unverified.length > 0
      ? ` Still unverified: ${retired.unverified
          .map((report) => `${report.ticket} (${report.pr ? `PR ${report.pr}` : 'no PR'})`)
          .join(', ')}.`
      : ''
  return `${retired.count} inherited ${noun} retired to history (check --all).${unverified}\n`
}

export function formatMessageReadOnlyTag(
  message: OrchestrationMessageSummary,
  legacyCompatibilityActive = false
): string {
  return isLegacyReadOnlyMessage(message, legacyCompatibilityActive) ? ' [legacy, read-only]' : ''
}

export function isLegacyReadOnlyMessage(
  message: OrchestrationMessageSummary,
  legacyCompatibilityActive = false
): boolean {
  return (
    message.run_id === ORCHESTRATION_LEGACY_RUN_ID ||
    (message.delivery_contract === 'legacy_direct' && !legacyCompatibilityActive) ||
    message.delivery_contract === 'audit_only'
  )
}

export function formatOrchestrationCheckText(
  result: OrchestrationCheckOutput,
  checkedTerminal: string,
  cli?: string
): string {
  const prepared = prepareOrchestrationCheckOutput(
    result,
    checkedTerminal,
    result.formatted !== undefined,
    cli
  )
  const compatibilityActive = Boolean(
    prepared.legacyCompatibility && !prepared.legacyCompatibility.readOnly
  )
  const legacyHeader = prepared.legacyCompatibility
    ? prepared.legacyCompatibility.readOnly
      ? '[LEGACY READ-ONLY]\n'
      : prepared.legacyCompatibility.recovery
        ? '[LEGACY RECOVERY REPLAY — MAY HAVE BEEN SEEN]\n'
        : '[LEGACY COMPATIBILITY]\n'
    : ''
  const deliveryNotice = formatCurrentDeliveryNotice(prepared.legacyCompatibility?.currentDelivery)
  const readInFull = (prepared.readInFull ?? []).map((command) => `Read in full: ${command}\n`)
  return wrapLongLines(
    `${readInFull.join('')}${formatRetiredNotice(prepared.retired)}${formatCheckBody(prepared, legacyHeader, deliveryNotice, compatibilityActive)}`
  )
}

function wrapLongLines(text: string): string {
  return text
    .split('\n')
    .flatMap((line) => {
      if (line.length <= OUTPUT_LINE_MAX) {
        return [line]
      }
      const indent = /^ {0,8}/.exec(line)?.[0] ?? ''
      const pieces: string[] = []
      let piece = ''
      for (const character of line.slice(indent.length)) {
        if (indent.length + piece.length + character.length > OUTPUT_LINE_MAX) {
          pieces.push(`${indent}${piece}`)
          piece = ''
        }
        piece += character
      }
      return [...pieces, `${indent}${piece}`]
    })
    .join('\n')
}

const fitsOneLine = (text: string | null | undefined): boolean =>
  !text || JSON.stringify(text).length <= OUTPUT_LINE_MAX

function readInFullCommands(
  messages: readonly OrchestrationMessageSummary[],
  checkedTerminal: string,
  cli: string
): string[] {
  return messages
    .filter((message) => !fitsOneLine(message.body) || !fitsOneLine(message.payload))
    .map(
      (message) =>
        `${bashWordOfCli(cli)} orchestration inbox --terminal ${bashWord(message.to_handle ?? checkedTerminal)} --id ${bashWord(message.id)}`
    )
}

function formatCheckBody(
  prepared: OrchestrationCheckOutput,
  legacyHeader: string,
  deliveryNotice: string,
  compatibilityActive: boolean
): string {
  if (prepared.formatted) {
    return `${legacyHeader}${prepared.formatted}${deliveryNotice}`
  }
  if (prepared.count === 0) {
    if (prepared.timedOut) {
      return `${legacyHeader}Wait timed out; no messages were consumed.${deliveryNotice}`
    }
    if (prepared.cancelled) {
      const cancelled = prepared.connectionLost
        ? 'Wait cancelled because the connection closed; no messages were consumed.'
        : 'Wait cancelled; no messages were consumed.'
      return `${legacyHeader}${cancelled}${deliveryNotice}`
    }
    return `${legacyHeader}No messages.${deliveryNotice}`
  }
  // Why: a plain check is the only read a member does before acting; without the body it stops and asks the user.
  const rendered = prepared.messages
    .map((message) => {
      const header = `${message.id}${formatMessageReadOnlyTag(
        message,
        compatibilityActive
      )} [${message.type ?? 'status'}] from=${message.from_handle} "${message.subject}"`
      const lines = [header]
      if (message.body) {
        lines.push(formatQuotedMessageField('body', message.body))
      }
      if (message.payload) {
        lines.push(formatQuotedMessageField('payload', message.payload))
      }
      return lines.join('\n')
    })
    .join('\n\n')
  const output = prepared.deliveryId ? `Delivery ${prepared.deliveryId}\n${rendered}` : rendered
  return `${legacyHeader}${output}${deliveryNotice}`
}

export function prepareOrchestrationCheckOutput<T extends OrchestrationCheckOutput>(
  result: T,
  checkedTerminal: string,
  formattedRequested: boolean,
  /** The CLI the reader runs, so the read it names is not a bare `orca` that may be another program. */
  cli = 'orca'
): T {
  const compatibilityActive = Boolean(
    result.legacyCompatibility && !result.legacyCompatibility.readOnly
  )
  const readInFull = readInFullCommands(result.messages, checkedTerminal, cli)
  const sized = readInFull.length > 0 ? { readInFull, ...result } : result
  if (
    !formattedRequested ||
    !result.messages.some((message) => isLegacyReadOnlyMessage(message, compatibilityActive))
  ) {
    return sized
  }
  return {
    ...sized,
    formatted: formatLegacyAwareCheckMessages(result.messages, checkedTerminal, compatibilityActive)
  }
}

function formatMessagePriorityTag(message: OrchestrationMessageSummary): string {
  return message.priority === 'urgent' ? ' [URGENT]' : message.priority === 'high' ? ' [HIGH]' : ''
}

function escapeTerminalControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0)
      if (character === '\n' || (code >= 0x20 && code < 0x7f) || code > 0x9f) {
        return character
      }
      return `\\x${code.toString(16).padStart(2, '0')}`
    })
    .join('')
}

function formatQuotedMessageField(label: string, value?: string): string {
  return `[${label}]\n${escapeTerminalControlCharacters(value ?? '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}`
}

function formatLegacyAwareCheckMessages(
  messages: OrchestrationMessageSummary[],
  checkedTerminal: string,
  legacyCompatibilityActive = false
): string {
  return messages
    .map((message) => {
      const legacyReadOnly = isLegacyReadOnlyMessage(message, legacyCompatibilityActive)
      const lines = [
        `${message.id}${formatMessageReadOnlyTag(message, legacyCompatibilityActive)}${formatMessagePriorityTag(message)} [${message.type ?? 'status'}] from=${message.from_handle}`,
        formatQuotedMessageField('subject', message.subject)
      ]
      if (legacyReadOnly) {
        lines.push('[Inspection only: reply and acknowledgment are unavailable.]')
      }
      if (message.body) {
        lines.push(formatQuotedMessageField('body', message.body))
      }
      if (message.payload) {
        lines.push(formatQuotedMessageField('payload', message.payload))
      }
      if (!legacyReadOnly) {
        const replyTarget = message.to_handle ?? checkedTerminal
        const replyFrom =
          replyTarget.startsWith('run:') || replyTarget.startsWith('dispatch:')
            ? ''
            : ` --from ${replyTarget}`
        lines.push(`[Reply: orca orchestration reply --id ${message.id}${replyFrom} --body "..."]`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

function formatCurrentDeliveryNotice(
  delivery: LegacyCompatibilityResult['currentDelivery']
): string {
  if (!delivery) {
    return ''
  }
  return (
    `\n[CURRENT RUN MAIL WAITING]\n` +
    `Read: ${delivery.checkCommand}\n` +
    `Then acknowledge the delivery ID it prints: ${delivery.ackCommand}`
  )
}
