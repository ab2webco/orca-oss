import React from 'react'
import { cn } from '@/lib/utils'

// Why: V30's tree glyphs (IC.server, IC.group, IC.repo), drawn dim beside host, org and project rows.
const TREE_GLYPH_PATHS = {
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  group: <path d="M4 4h6v6H4zM4 7v11h6M10 18h6v-4h-6z" />,
  repo: (
    <>
      <path d="M5 8a7 7 0 0 1 14 0v1a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path d="M9 13v7M15 13v7" />
    </>
  )
} as const

export type SidebarTreeGlyphName = keyof typeof TREE_GLYPH_PATHS

export function SidebarTreeGlyph({
  name,
  className
}: {
  name: SidebarTreeGlyphName
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-sidebar-tree-glyph={name}
      className={cn('size-3.5 shrink-0 text-muted-foreground/60', className)}
    >
      {TREE_GLYPH_PATHS[name]}
    </svg>
  )
}

export function SidebarOrgGlyph({ className }: { className?: string }): React.JSX.Element {
  return <SidebarTreeGlyph name="group" className={className} />
}

export function SidebarProjectGlyph({ className }: { className?: string }): React.JSX.Element {
  return <SidebarTreeGlyph name="repo" className={className} />
}
