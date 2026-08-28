// Why this module exists: a group panel syncs group focus to DOM focus, because
// keyboard and assistive-technology focus can enter a split group with no pointer
// event. That handler cannot tell the user arriving from a pane refocusing
// itself: Monaco re-focuses its own input ~63ms after a click, which stole group
// focus back from a tab the user had just clicked in another group (ORCA-314).
//
// The discriminator is provenance, not timing: the user's last input names which
// group they aimed at. A pointer press claims one group, and any key input hands
// the claim back to the keyboard, where a focus move is the user's own.

type GroupFocusIntent = { kind: 'pointer'; groupId: string } | { kind: 'key' }

let intent: GroupFocusIntent | null = null

/** A pointer press aimed at `groupId`; later DOM focus elsewhere is not the user. */
export function recordGroupPointerFocusIntent(groupId: string): void {
  intent = { kind: 'pointer', groupId }
}

/** Key input returns the claim to the keyboard, so tabbing into any group counts. */
export function recordGroupKeyFocusIntent(): void {
  intent = { kind: 'key' }
}

/**
 * Whether DOM focus landing inside `groupId` may claim group focus.
 *
 * Keyboard and AT focus always may — suppressing those would trade a pointer bug
 * for an accessibility one. Only a pointer press that named a different group
 * blocks the claim, and only until the user's next input.
 */
export function mayClaimGroupFocusFromDomFocus(groupId: string): boolean {
  return intent?.kind === 'pointer' ? intent.groupId === groupId : true
}

/** Installs the key-input watch; capture phase so a handler cannot swallow it. */
export function installGroupFocusIntentKeyWatch(target: Window): () => void {
  const onKeyDown = (): void => recordGroupKeyFocusIntent()
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

export function _resetGroupFocusIntentForTests(): void {
  intent = null
}
