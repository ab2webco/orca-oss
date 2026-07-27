import type { UpdateCheckOptions } from '../../../shared/types'
import { getShortcutPlatform } from './shortcut-platform'

type UpdateCheckClickEvent = Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

function isMacShortcutPlatform(): boolean {
  return getShortcutPlatform() === 'darwin'
}

export function getUpdateCheckHint(isMac = isMacShortcutPlatform()): string {
  const rcClickLabel = isMac ? '⇧+click' : 'Shift+click'
  const perfClickLabel = isMac ? '⌘+click' : 'Ctrl+click'
  const labRcClickLabel = isMac ? '⌥+click' : 'Alt+click'
  return `${rcClickLabel} checks the latest RC; ${perfClickLabel} checks the latest perf build; ${labRcClickLabel} checks the latest lab release candidate.`
}

export function getUpdateCheckClickOptions(
  event: UpdateCheckClickEvent,
  isMac = isMacShortcutPlatform()
): UpdateCheckOptions {
  return {
    includePrerelease: event.shiftKey,
    includePerfPrerelease: isMac ? event.metaKey : event.ctrlKey,
    includeLabRcPrerelease: event.altKey
  }
}
