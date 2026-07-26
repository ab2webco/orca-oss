import { Clipboard, ExternalLink, GitBranch } from 'lucide-react'

import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import type { PlaneWorkItemActionItem } from './use-plane-work-item-mutations'

function buildPlaneBranchName(title: string, identifier: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52)
  return `${identifier.toLowerCase()}${slug ? `-${slug}` : ''}`
}

async function copyTextToClipboard(text: string, label: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(
      translate('auto.components.PlaneWorkItemWorkspace.copied', '{{value0}} copied', {
        value0: label
      })
    )
  } catch {
    toast.error(
      translate('auto.components.PlaneWorkItemWorkspace.copyFailed', 'Failed to copy {{value0}}', {
        value0: label.toLowerCase()
      })
    )
  }
}

/** Menu actions for one work item: open, copy URL/identifier/branch/prompt.
 *  Extracted from the mutation hook because these change nothing in Plane. */
export function buildPlaneWorkItemActions(
  displayed: PlaneWorkItem | null
): PlaneWorkItemActionItem[] {
  if (!displayed) {
    return []
  }
  return [
    {
      label: translate('auto.components.PlaneWorkItemWorkspace.openInPlane', 'Open in Plane'),
      icon: ExternalLink,
      action: () => window.api.shell.openUrl(displayed.url)
    },
    {
      label: translate('auto.components.PlaneWorkItemWorkspace.copyUrl', 'Copy URL'),
      icon: Clipboard,
      action: () => void copyTextToClipboard(displayed.url, 'URL')
    },
    {
      label: translate('auto.components.PlaneWorkItemWorkspace.copyId', 'Copy identifier'),
      icon: Clipboard,
      action: () => void copyTextToClipboard(displayed.identifier, 'Identifier')
    },
    {
      label: translate(
        'auto.components.PlaneWorkItemWorkspace.copyBranch',
        'Copy suggested branch name'
      ),
      icon: GitBranch,
      action: () =>
        void copyTextToClipboard(
          buildPlaneBranchName(displayed.title, displayed.identifier),
          'Branch name'
        )
    },
    {
      label: translate('auto.components.PlaneWorkItemWorkspace.copyPrompt', 'Copy prompt'),
      icon: Clipboard,
      action: () =>
        void copyTextToClipboard(
          `Complete Plane work item ${displayed.identifier}: ${displayed.title}\n\n${displayed.url}`,
          'Prompt'
        )
    }
  ]
}
