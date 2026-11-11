// Why: the strip shrink-wraps its tabs, so a content-derived width lets one live title update
// resize every tab; a definite width pins them and flex-shrink still narrows to the floor.
// Why the narrow floor: in a bar under 200 px an 88 px tab was cut to its × alone; 48 px keeps
// its icon and close (ORCA-717).
export const TAB_CONTAINER_WIDTH_CLASSES =
  'w-[180px] min-w-[88px] min-[1280px]:w-[220px] @max-[200px]/tab-bar:min-w-12'

export const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate'
