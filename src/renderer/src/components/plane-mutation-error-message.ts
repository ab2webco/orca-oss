import { translate } from '@/i18n/i18n'

const SERVER_STATUS_PATTERN =
  /\b(?:HTTP(?:\/\d(?:\.\d)?)?|Error|status(?:\s+code)?)\s*[:=]?\s*5\d{2}\b/i
const SERVER_FAILURE_PATTERN =
  /\b(?:internal server error|bad gateway|service unavailable|gateway timeout)\b/i
const DNS_FAILURE_PATTERN =
  /\b(?:ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ESERVFAIL|DNS_PROBE_FINISHED_NXDOMAIN)\b/i
const TIMEOUT_PATTERN =
  /\b(?:ERR_(?:CONNECTION_)?TIMED_OUT|ETIMEDOUT|ESOCKETTIMEDOUT|request timed out|request timeout)\b/i

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === 'string' ? error : ''
}

export function getPlaneMutationErrorMessage(error: unknown, fallback: string): string {
  const message = getErrorMessage(error)
  if (/\bERR_INTERNET_DISCONNECTED\b/i.test(message)) {
    return translate(
      'auto.components.task-page-plane-board.internetDisconnected',
      "You're offline. Check your connection and try again."
    )
  }
  if (DNS_FAILURE_PATTERN.test(message)) {
    return translate(
      'auto.components.task-page-plane-board.dnsFailure',
      "Plane's address could not be resolved. Check your network or DNS settings and try again."
    )
  }
  if (SERVER_STATUS_PATTERN.test(message) || SERVER_FAILURE_PATTERN.test(message)) {
    return translate(
      'auto.components.task-page-plane-board.serverFailure',
      'Plane had a server error. Try again later.'
    )
  }
  if (TIMEOUT_PATTERN.test(message)) {
    return translate(
      'auto.components.task-page-plane-board.requestTimedOut',
      'The request to Plane timed out. Try again.'
    )
  }
  return fallback
}
