import type { GlobalSettings, TaskProvider } from '../../../shared/types'

export type LinkedWorkItemContext = {
  provider: TaskProvider
  version: 1
  renderedText: string
}

export type LinearLaunchContextArgs = {
  provider?: TaskProvider
  identifier: string | undefined
  title?: string
  url?: string
  template?: string
}

export function isLinearWorkItemReference(
  args:
    | {
        provider?: TaskProvider
        linearIdentifier?: string
        linkedContext?: LinkedWorkItemContext
      }
    | null
    | undefined
): boolean {
  return (
    args?.provider === 'linear' ||
    Boolean(args?.linearIdentifier?.trim()) ||
    args?.linkedContext?.provider === 'linear'
  )
}

// Why: unlike Jira/GitLab, Plane self-hosts on arbitrary base URLs with no
// stable hostname shape, so provider inference stays tag-based like Linear.
export function isPlaneWorkItemReference(
  args:
    | {
        provider?: TaskProvider
        planeIdentifier?: string
        linkedContext?: LinkedWorkItemContext
      }
    | null
    | undefined
): boolean {
  return (
    args?.provider === 'plane' ||
    Boolean(args?.planeIdentifier?.trim()) ||
    args?.linkedContext?.provider === 'plane'
  )
}

// Why: the settings pane persists one template per provider; callers only
// ever need the template that matches the linked item's own provider.
export function getLaunchPromptTemplateForProvider(
  settings:
    | Pick<GlobalSettings, 'linearLaunchPromptTemplate' | 'planeLaunchPromptTemplate'>
    | null
    | undefined,
  provider: TaskProvider | null | undefined
): string | undefined {
  if (provider === 'linear') {
    return settings?.linearLaunchPromptTemplate
  }
  if (provider === 'plane') {
    return settings?.planeLaunchPromptTemplate
  }
  return undefined
}

const LAUNCH_TEMPLATE_LINE_SPLIT = /\r\n|\r|\n/
const UNRESOLVED_TEMPLATE_PLACEHOLDER = /\{\{[^{}]+\}\}/

// Why: user templates are free text; substitute the two known tokens, then drop
// blank lines (and lines left with an unknown placeholder) so an unfilled
// placeholder never leaves a dangling or literal-token line.
export function renderLaunchTemplate(
  template: string,
  identifier: string,
  url: string
): string | null {
  const rendered = template
    .split('{{identifier}}')
    .join(identifier)
    .split('{{url}}')
    .join(url)
    .split(LAUNCH_TEMPLATE_LINE_SPLIT)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !UNRESOLVED_TEMPLATE_PLACEHOLDER.test(line))
    .join('\n')
  return rendered.length > 0 ? rendered : null
}

// Why: Linear ticket prose is third-party source data; terminal drafts may
// carry only stable identity/link fields from the selected issue.
export function buildLinearLaunchContextBlock(args: LinearLaunchContextArgs): string | null {
  const identifier = args.identifier?.trim()
  const url = args.url?.trim()
  if (!identifier && !url) {
    return null
  }

  const template = args.template?.trim()
  if (template) {
    return renderLaunchTemplate(template, identifier ?? '', url ?? '')
  }

  const lines = [identifier ? `Linked Linear issue: ${identifier}` : 'Linked Linear issue']
  if (url) {
    lines.push(url)
  }
  return lines.join('\n')
}

export type PlaneLaunchContextArgs = {
  provider?: TaskProvider
  identifier: string | undefined
  title?: string
  url?: string
  template?: string
}

// Why: Plane work-item prose is third-party source data; terminal drafts may
// carry only stable identity/link fields from the selected work item.
export function buildPlaneLaunchContextBlock(args: PlaneLaunchContextArgs): string | null {
  const identifier = args.identifier?.trim()
  const url = args.url?.trim()
  if (!identifier && !url) {
    return null
  }

  const template = args.template?.trim()
  if (template) {
    return renderLaunchTemplate(template, identifier ?? '', url ?? '')
  }

  const lines = [identifier ? `Linked Plane issue: ${identifier}` : 'Linked Plane issue']
  if (url) {
    lines.push(url)
  }
  return lines.join('\n')
}
