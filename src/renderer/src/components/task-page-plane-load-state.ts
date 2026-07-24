import type { PlaneWorkItem } from '../../../shared/plane-types'

export type TaskPagePlaneLoadError = {
  title: string
  details: string | null
}

export type TaskPagePlaneLoadFailureState = {
  items: PlaneWorkItem[]
  error: TaskPagePlaneLoadError
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load Plane work items.'
}

function getErrorCode(message: string): number | null {
  const explicit = /^Error\s+(\d{3})\b/i.exec(message)?.[1]
  if (explicit) {
    return Number(explicit)
  }
  if (/\bforbidden\b/i.test(message)) {
    return 403
  }
  if (/\bunauthorized\b|\bunauthenticated\b/i.test(message)) {
    return 401
  }
  if (/\btoo many requests\b|\brate limit\b/i.test(message)) {
    return 429
  }
  if (/\bservice unavailable\b/i.test(message)) {
    return 503
  }
  return null
}

function getErrorDetails(message: string, code: number | null): string | null {
  const normalized =
    code === null ? message : message.replace(new RegExp(`^Error\\s+${code}:\\s*`, 'i'), '')
  return normalized.trim() || null
}

function getWorkItemSearchErrorSummary(message: string, code: number | null): string {
  if (code === 401) {
    return 'Plane authentication failed. Reconnect Plane in Settings, then try again.'
  }
  if (code === 403) {
    return 'Plane denied access to this work item search. Check project permissions or try a different PQL query.'
  }
  if (code === 429) {
    return 'Plane rate-limited this work item search. Try again in a moment.'
  }
  if (code !== null && code >= 500) {
    return 'Plane had a server error while loading work items. Try again in a moment.'
  }
  if (/\bpql\b|\bsyntax\b/i.test(message)) {
    return "Plane couldn't run this PQL query. Check the syntax and try again."
  }
  if (/\bnetwork\b|\bfetch failed\b|\btimed? ?out\b|\beconn/i.test(message)) {
    return "Couldn't reach Plane. Check your connection and try again."
  }
  return "Couldn't load Plane work items. Try again in a moment."
}

export function createTaskPagePlaneLoadFailureState(error: unknown): TaskPagePlaneLoadFailureState {
  const message = getErrorMessage(error)
  const code = getErrorCode(message)
  const summary = getWorkItemSearchErrorSummary(message, code)
  return {
    items: [],
    error: {
      title: code === null ? summary : `Error ${code}: ${summary}`,
      details: getErrorDetails(message, code)
    }
  }
}
