import type { OrchestratorGameConfig, OrchestratorGameLayer } from './orchestrator-game-config'
import type { OrchestratorGameLead } from './orchestrator-game-lead'
import type { OrchestratorGameAction } from './orchestrator-game-actions'

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

/** Sets a project's scene from the picker: one built-in or plugin scene, one file, or `null` to inherit. */
export function withOrchestratorGameProjectScene(
  projects: Record<string, OrchestratorGameLayer> | undefined,
  repoId: string,
  choice: { scene: string } | { sceneFile: string } | null
): Record<string, OrchestratorGameLayer> {
  const next = { ...projects }
  const layer: OrchestratorGameLayer = { ...next[repoId] }
  delete layer.scene
  delete layer.sceneFile
  Object.assign(layer, choice)
  if (Object.keys(layer).length === 0) {
    delete next[repoId]
  } else {
    next[repoId] = layer
  }
  return next
}

/** Overrides one lead key for one project on this machine; `undefined` inherits it again. */
export function withOrchestratorGameProjectLead<K extends keyof OrchestratorGameLead>(
  projects: Record<string, OrchestratorGameLayer> | undefined,
  repoId: string,
  key: K,
  value: OrchestratorGameLead[K] | undefined
): Record<string, OrchestratorGameLayer> {
  const next = { ...projects }
  const layer: OrchestratorGameLayer = { ...next[repoId] }
  const lead = { ...layer.orchestrator }
  if (value === undefined) {
    delete lead[key]
  } else {
    lead[key] = value
  }
  if (Object.keys(lead).length === 0) {
    delete layer.orchestrator
  } else {
    layer.orchestrator = lead
  }
  if (Object.keys(layer).length === 0) {
    delete next[repoId]
  } else {
    next[repoId] = layer
  }
  return next
}

/** Replaces a project's action list on this machine; `undefined` inherits orca.yaml's again. */
export function withOrchestratorGameProjectActions(
  projects: Record<string, OrchestratorGameLayer> | undefined,
  repoId: string,
  actions: OrchestratorGameAction[] | undefined
): Record<string, OrchestratorGameLayer> {
  const next = { ...projects }
  const layer: OrchestratorGameLayer = { ...next[repoId] }
  if (actions === undefined) {
    delete layer.actions
  } else {
    layer.actions = actions
  }
  if (Object.keys(layer).length === 0) {
    delete next[repoId]
  } else {
    next[repoId] = layer
  }
  return next
}
