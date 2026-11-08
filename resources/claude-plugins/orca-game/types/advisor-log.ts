import type { AdvisorGesture } from './index'

/** One of Jev's decisions as the Panel lists it; `id` null is the main conversation's model. */
export type AdvisorLogEntry = {
  key: string
  id: string | null
  title: string | null
  model: string | null
  effort: string | number | null
  verdict: string
  gesture: AdvisorGesture | null
  at: number
}

/** Jev's latest decisions in this pane, oldest first, a few at most. */
export type AdvisorLog = { decisions: AdvisorLogEntry[] }
