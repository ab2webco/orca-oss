import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'

/**
 * La carpeta que Orca crea PARA un plugin cuando sus automatizaciones declaran
 * `workspace: 'plugin-owned'`, y su registro como folder workspace del host
 * local.
 *
 * Por que no es lo mismo que adivinar el repo del usuario: el plugin no nombra
 * la ruta ni elige un repo existente. Pide "mi carpeta" y Orca decide cual es,
 * la crea vacia y la registra a su nombre. Nada del usuario entra ahi y el
 * trabajo del bot nunca cae en un checkout ajeno.
 *
 * Por que `<userData>/plugin-workspaces/<pluginKey>` y no `plugins-data`:
 * `plugins-data/<pluginKey>` es el almacen privado del plugin — ahi viven su
 * `kv.json` y su `secrets.json.enc` — y ademas es el arbol que el watcher de
 * refresh vigila en recursivo. Un agente trabajando dentro escribiria encima
 * del almacen de secretos y dispararia un refresh de discovery por cada
 * archivo que toque. Hermano, no dentro: mismo dueno, mismo ciclo de vida,
 * pero un arbol aparte que nadie vigila.
 */
export function getPluginWorkspacesDir(userDataPath: string): string {
  return join(userDataPath, 'plugin-workspaces')
}

export function getPluginWorkspaceDir(userDataPath: string, pluginKey: string): string {
  return join(getPluginWorkspacesDir(userDataPath), pluginKey)
}

/** Como se lee la carpeta en la lista de automatizaciones y en la barra
 *  lateral: el nombre del plugin, marcado como suya, para que no pase por un
 *  proyecto del usuario ni por un "Proyecto desconocido". */
export function pluginOwnedWorkspaceDisplayName(pluginDisplayName: string): string {
  return `${pluginDisplayName} (plugin)`
}

/**
 * Crea la carpeta si falta y devuelve el repo folder que la representa,
 * registrandolo si todavia no lo esta.
 *
 * El registro es de verdad, no un atajo: la fila es un `Repo` como cualquier
 * otro folder workspace, asi que `resolveAutomationRunTarget` la valida por el
 * mismo camino que un proyecto del usuario en vez de tener un caso especial
 * que se salte la validacion.
 */
export async function ensurePluginOwnedWorkspaceRepo(input: {
  store: Store
  userDataPath: string
  pluginKey: string
  displayName: string
}): Promise<Repo> {
  const path = getPluginWorkspaceDir(input.userDataPath, input.pluginKey)
  await mkdir(path, { recursive: true })
  const existing = findLocalRepoByPath(input.store, path)
  if (existing) {
    return existing
  }
  const repo: Repo = {
    id: randomUUID(),
    path,
    displayName: input.displayName,
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    addedAt: Date.now(),
    kind: 'folder'
  }
  input.store.addRepo(repo)
  return repo
}

function findLocalRepoByPath(store: Store, path: string): Repo | undefined {
  const key = normalizeRuntimePathForComparison(path)
  return store
    .getRepos()
    .find(
      (repo) =>
        getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
        normalizeRuntimePathForComparison(repo.path) === key
    )
}
