import { useState } from 'react'

/** Keeps the previous value while the next one is equal, so buildRows' memo holds. */
export function useStableIdentity<T>(next: T, same: (left: T, right: T) => boolean): T {
  // Why state, not a ref: a ref written during render leaks from renders React discards.
  const [stable, setStable] = useState(() => next)
  if (stable !== next && !same(stable, next)) {
    setStable(() => next)
    return next
  }
  return stable
}
