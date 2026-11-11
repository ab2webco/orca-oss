// Why: the strip shrink-wraps its tabs, so a content-derived width lets one live title update
// resize every tab; a definite width pins them and flex-shrink still narrows to the floor.
// Why the narrow floors: in a bar under 200 px an 88 px tab was cut to its × alone, so 48 px keeps
// its icon and close; under 120 px the +N count and the + leave room for its 32 px icon alone (ORCA-717).
export const TAB_CONTAINER_WIDTH_CLASSES =
  'w-[180px] min-w-[88px] min-[1280px]:w-[220px] @max-[200px]/tab-bar:min-w-12 @max-[120px]/tab-bar:min-w-8'

export const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate @max-[120px]/tab-bar:hidden'

// Why: under 120 px a tab is its icon alone; hover or focus swaps the icon for the close (ORCA-717).
export const TAB_NARROW_ICON_CLASSES =
  'contents @max-[120px]/tab-bar:group-hover:hidden @max-[120px]/tab-bar:group-focus-within:hidden'

export const TAB_NARROW_CLOSE_CLASSES =
  '@max-[120px]/tab-bar:hidden @max-[120px]/tab-bar:group-hover:flex @max-[120px]/tab-bar:group-focus-within:flex'

export const TAB_NARROW_HIDDEN_CLASSES = '@max-[120px]/tab-bar:hidden'
