// Why a copy: the mod cannot import Orca's src/shared; agent-row-primary-text.test.ts pins it to Orca's line.
const BRIEF_LINE = /^Read your Orca Lab brief at (\S+) \(task (\S+)\) and follow it\.$/

/** The file Orca's one-line dispatch brief names, or null for any other prompt. */
export const briefPathOf = (text: string): string | null =>
  BRIEF_LINE.exec(text.trim())?.[1] ?? null
