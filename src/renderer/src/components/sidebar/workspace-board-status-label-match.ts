// Board columns are user-named, provider states are project/team-scoped, so the
// only stable bridge is the label itself. Kept provider-agnostic: Linear
// workflow states and Plane states both match on name.

function normalizeStateName(name: string): string {
  return name.trim().toLowerCase()
}

export function matchStatesByLabel<T extends { name: string }>(
  states: readonly T[],
  label: string
): T[] {
  const target = normalizeStateName(label)
  return states.filter((state) => normalizeStateName(state.name) === target)
}

export function isSameStateName(left: string, right: string): boolean {
  return normalizeStateName(left) === normalizeStateName(right)
}
