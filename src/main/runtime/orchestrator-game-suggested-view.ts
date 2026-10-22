import { collectHostMemory } from '../memory/host-memory'
import {
  suggestedOrchestratorGameView,
  type OrchestratorGameViewId
} from '../../shared/orchestrator-game-view'

type HostMemoryRead = () => Promise<{ totalMemory: number; availableMemory: number }>

const EVERY_MS = 60_000

// Why cached: every game pane polls its state every 30 s, and a host memory read can spawn a process.
export function createGameSuggestedView({
  read = collectHostMemory,
  now = Date.now
}: { read?: HostMemoryRead; now?: () => number } = {}): () => Promise<
  OrchestratorGameViewId | undefined
> {
  let last: { at: number; view: Promise<OrchestratorGameViewId | undefined> } | undefined
  return () => {
    if (last === undefined || now() - last.at >= EVERY_MS) {
      last = { at: now(), view: read().then(suggestedOrchestratorGameView, () => undefined) }
    }
    return last.view
  }
}
