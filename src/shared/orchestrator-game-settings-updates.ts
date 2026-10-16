import type { OrchestratorGameConfig, OrchestratorGameLayer } from './orchestrator-game-config'

// Why: `undefined` means "inherit", so the key is removed instead of stored, letting lower layers show through.
export function withOrchestratorGameField<K extends keyof OrchestratorGameConfig>(
  layer: OrchestratorGameLayer | undefined,
  key: K,
  value: OrchestratorGameConfig[K] | undefined
): OrchestratorGameLayer {
  const next: OrchestratorGameLayer = { ...layer }
  if (value === undefined) {
    delete next[key]
  } else {
    next[key] = value
  }
  return next
}

export function withOrchestratorGameProjectField<K extends keyof OrchestratorGameConfig>(
  projects: Record<string, OrchestratorGameLayer> | undefined,
  repoId: string,
  key: K,
  value: OrchestratorGameConfig[K] | undefined
): Record<string, OrchestratorGameLayer> {
  const next = { ...projects }
  const layer = withOrchestratorGameField(next[repoId], key, value)
  if (Object.keys(layer).length === 0) {
    delete next[repoId]
  } else {
    next[repoId] = layer
  }
  return next
}
