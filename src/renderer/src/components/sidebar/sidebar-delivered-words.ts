import { getIntlLocale, translate } from '@/i18n/i18n'
import type { StatusTone } from '@/components/status-tone'
import type { AlsoWorkedOn, DeliveredPr, DeliveredPrKind } from './sidebar-delivered-members'

export function deliveredGroupLabel(): string {
  return translate('auto.components.sidebar.SidebarDelivered.group', 'Delivered')
}

export function deliveredFoldedCount(count: number): string {
  return translate(
    'auto.components.sidebar.SidebarDelivered.foldedCount',
    '{{count}} delivered · over 24 h',
    { count }
  )
}

function stateWord(kind: Exclude<DeliveredPrKind, 'none'>): string {
  switch (kind) {
    case 'merged':
      return translate('auto.components.sidebar.SidebarDelivered.merged', 'merged')
    case 'open':
      return translate('auto.components.sidebar.SidebarDelivered.open', 'open')
    case 'ciFailing':
      return translate('auto.components.sidebar.SidebarDelivered.ciFailing', 'CI failing')
    case 'closed':
      return translate('auto.components.sidebar.SidebarDelivered.closed', 'closed')
  }
}

/** The row's second line: `#1208 · merged`, `#1206 · open · queued`, `#1205 · CI failing`. */
export function deliveredPrLine(pr: DeliveredPr | null, kind: DeliveredPrKind): string {
  if (!pr || kind === 'none') {
    return translate('auto.components.sidebar.SidebarDelivered.noPr', 'No PR')
  }
  const queued =
    kind === 'open' && pr.queued
      ? ` · ${translate('auto.components.sidebar.SidebarDelivered.queued', 'queued')}`
      : ''
  return `#${pr.number} · ${stateWord(kind)}${queued}`
}

/** The hover card's PR value: `#1208 merged`. */
export function deliveredPrValue(pr: DeliveredPr | null, kind: DeliveredPrKind): string {
  return !pr || kind === 'none'
    ? translate('auto.components.sidebar.SidebarDelivered.noPr', 'No PR')
    : `#${pr.number} ${stateWord(kind)}`
}

/** Merged reads as done, a CI failure as at risk; open and closed stay neutral. */
export function deliveredTone(kind: DeliveredPrKind): StatusTone {
  return kind === 'merged' ? 'success' : kind === 'ciFailing' ? 'warning' : 'idle'
}

export function deliveredDoneBy(name: string): string {
  return translate('auto.components.sidebar.SidebarDelivered.doneBy', 'Done by {{name}}', { name })
}

export function deliveredHoverLabel(field: 'pr' | 'title' | 'branch' | 'lead' | 'freed'): string {
  switch (field) {
    case 'pr':
      return translate('auto.components.sidebar.SidebarDelivered.label.pr', 'PR')
    case 'title':
      return translate('auto.components.sidebar.SidebarDelivered.label.title', 'Title')
    case 'branch':
      return translate('auto.components.sidebar.SidebarDelivered.label.branch', 'Branch')
    case 'lead':
      return translate('auto.components.sidebar.SidebarDelivered.label.lead', 'Lead')
    case 'freed':
      return translate('auto.components.sidebar.SidebarDelivered.label.freed', 'Freed')
  }
}

/** `today 06:10` or `14 Nov, 06:10`, then that the worktree waits for the merge. */
export function deliveredFreedValue(freedAt: number, now: number): string {
  const locale = getIntlLocale()
  const at = new Date(freedAt)
  const sameDay = at.toDateString() === new Date(now).toDateString()
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)
  const time = sameDay
    ? translate('auto.components.sidebar.SidebarDelivered.today', 'today {{time}}', { time: clock })
    : new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }).format(at)
  return translate(
    'auto.components.sidebar.SidebarDelivered.freedValue',
    '{{time}} · worktree waiting',
    { time }
  )
}

function alsoWord(kind: AlsoWorkedOn['kind']): string {
  switch (kind) {
    case 'merged':
      return translate('auto.components.sidebar.SidebarDelivered.merged', 'merged')
    case 'open':
      return translate('auto.components.sidebar.SidebarDelivered.open', 'open')
    case 'freed':
      return translate('auto.components.sidebar.SidebarDelivered.freed', 'freed')
    case 'inProgress':
      return translate('auto.components.sidebar.SidebarDelivered.inProgress', 'in progress')
  }
}

/** `Peach also: ORCA-1149 (merged), ORCA-1216 (in progress)`. */
export function deliveredAlso(name: string, others: readonly AlsoWorkedOn[]): string {
  const tickets = others.map((one) => `${one.ticket} (${alsoWord(one.kind)})`).join(', ')
  return translate('auto.components.sidebar.SidebarDelivered.also', '{{name}} also: {{tickets}}', {
    name,
    tickets
  })
}
