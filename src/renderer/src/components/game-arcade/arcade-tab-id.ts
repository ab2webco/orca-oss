// Why a synthetic id: the Arcade tab is a virtual editor tab with no file on disk.
export const gameArcadeTabIdOf = (worktreeId: string): string => `orca-arcade::${worktreeId}`
