/**
 * Pure decisions behind the work item sheet's editable text fields.
 *
 * Why separate from the mutation hook: each one is "should this draft be sent,
 * and as what?", which is worth testing without a React tree — and it keeps the
 * hook file focused on wiring.
 */

/** Title edit result: `null` when the draft should be discarded instead of sent. */
export function resolvePlaneTitleSave(args: {
  draft: string
  stored: string
}): { title: string } | null {
  const title = args.draft.trim()
  // Why an empty title is discarded rather than saved: Plane requires one, so the
  // caller restores the stored value instead of sending a rejected write.
  return !title || title === args.stored ? null : { title }
}

/**
 * Whether a description edit is worth sending.
 *
 * Why the `?? ''` on the stored side: an item that never had a description reads
 * as undefined, so opening the editor and closing it untouched would otherwise
 * look like a change and fire a no-op write.
 */
export function shouldSavePlaneDescription(args: {
  draft: string
  stored: string | undefined
}): boolean {
  return args.draft !== (args.stored ?? '')
}

/** Splits the comma-separated labels draft into the id list Plane expects. */
export function resolvePlaneLabelIds(draft: string): string[] {
  return draft
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)
}
