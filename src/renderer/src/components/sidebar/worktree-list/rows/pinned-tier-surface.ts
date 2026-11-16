// Why the 1px skirts: the composited sticky layer and the scrolled rows snap to different pixels at
// fractional offsets, so without them a row shows through the stack's edges (ORCA-1216 §8).
export const PINNED_TIER_SURFACE_CLASS =
  'bg-worktree-sidebar-solid shadow-[0_-1px_0_var(--worktree-sidebar-solid,var(--worktree-sidebar)),0_1px_0_var(--worktree-sidebar-solid,var(--worktree-sidebar))]'
