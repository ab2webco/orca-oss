// A live owner-question notification, told to whatever on screen lists that worktree's questions.
export type OwnerQuestionArrival = { worktreeId: string | null }

const listeners = new Set<(arrival: OwnerQuestionArrival) => void>()

export function announceOwnerQuestion(arrival: OwnerQuestionArrival): void {
  for (const listener of listeners) {
    listener(arrival)
  }
}

export function onOwnerQuestion(listener: (arrival: OwnerQuestionArrival) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
