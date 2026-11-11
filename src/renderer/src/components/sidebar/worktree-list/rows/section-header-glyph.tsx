import React from 'react'
import { cn } from '@/lib/utils'
import { SidebarTreeGlyph } from '../../sidebar-tree-glyphs'

/** V30 draws a project and an org with its own dim glyphs; status and PR groups keep their icon. */
export function SectionHeaderGlyph({
  icon: Icon,
  tone,
  isProject,
  isProjectGroup
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: string
  isProject: boolean
  isProjectGroup: boolean
}): React.JSX.Element {
  if (isProject || isProjectGroup) {
    return (
      <div className="flex size-4 shrink-0 items-center justify-center">
        <SidebarTreeGlyph name={isProject ? 'repo' : 'group'} />
      </div>
    )
  }
  return (
    <div className={cn('flex size-4 shrink-0 items-center justify-center rounded-[4px]', tone)}>
      <Icon className="size-3" />
    </div>
  )
}
