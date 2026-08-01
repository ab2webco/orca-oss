import React from 'react'
import { ExternalLink, MonitorUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { translate } from '@/i18n/i18n'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from './WorktreeCardDetailSection'
import { DetailHeader, MetadataActionIcon } from './WorktreeCardMetadataControls'
import type { WorktreeCardPlaneWorkItemDisplay } from './worktree-card-meta-types'

export function WorktreeCardPlaneWorkItemDetailSection({
  planeWorkItem,
  onOpenPlaneWorkItemInOrca
}: {
  planeWorkItem: WorktreeCardPlaneWorkItemDisplay | null | undefined
  onOpenPlaneWorkItemInOrca?: (event: React.MouseEvent) => void
}): React.JSX.Element | null {
  if (!planeWorkItem) {
    return null
  }

  const labels = planeWorkItem.labels ?? []

  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<PlaneIcon className="size-3 text-muted-foreground" />}
        label={translate(
          'auto.components.sidebar.WorktreeCardMeta.planeWorkItem',
          'Plane {{value0}}',
          { value0: planeWorkItem.identifier }
        )}
        actions={
          <>
            {onOpenPlaneWorkItemInOrca && (
              <MetadataActionIcon
                label={translate(
                  'auto.components.sidebar.WorktreeCardMeta.2c67730e07',
                  'Open in Orca'
                )}
                onClick={onOpenPlaneWorkItemInOrca}
              >
                <MonitorUp className="size-3" />
              </MetadataActionIcon>
            )}
            {planeWorkItem.url && (
              <MetadataActionIcon
                label={translate(
                  'auto.components.sidebar.WorktreeCardMeta.viewOnPlane',
                  'View on Plane'
                )}
                href={planeWorkItem.url}
              >
                <ExternalLink className="size-3" />
              </MetadataActionIcon>
            )}
          </>
        }
      />
      <WorktreeCardDetailSectionContent className="space-y-1.5">
        <div className="text-[13px] font-semibold leading-snug text-foreground break-words">
          {planeWorkItem.title}
        </div>
        {(labels.length > 0 || planeWorkItem.stateName) && (
          <div className="flex flex-wrap gap-1">
            {planeWorkItem.stateName && (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                {planeWorkItem.stateName}
              </Badge>
            )}
            {labels.map((label) => (
              <Badge key={label} variant="outline" className="h-4 px-1.5 text-[9px]">
                {label}
              </Badge>
            ))}
          </div>
        )}
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
