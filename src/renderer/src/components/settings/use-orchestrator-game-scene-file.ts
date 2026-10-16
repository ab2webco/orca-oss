import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readOrchestratorGameSceneFile,
  type SceneFileRead
} from './orchestrator-game-scene-file-io'
import { translate } from '@/i18n/i18n'

export type SceneFileState = SceneFileRead | { status: 'loading' }

/** Reads a project's scene file and reads it again on window focus, so an edit made in the
 *  editor shows when the user comes back. `null` path reads nothing. */
export function useOrchestratorGameSceneFile(args: {
  rootPath: string
  connectionId: string | undefined
  isReachable: boolean
  path: string | null
}): { state: SceneFileState | null; reload: () => void } {
  const { rootPath, connectionId, isReachable, path } = args
  const [state, setState] = useState<SceneFileState | null>(null)
  const request = useRef(0)

  const reload = useCallback((): void => {
    const id = ++request.current
    if (path === null) {
      setState(null)
      return
    }
    if (!isReachable) {
      setState({
        status: 'unreadable',
        message: translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileSshOffline',
          'Connect this SSH project to read its scene file.'
        )
      })
      return
    }
    setState((current) => current ?? { status: 'loading' })
    void readOrchestratorGameSceneFile({ fs: window.api.fs, rootPath, connectionId, path }).then(
      (read) => {
        // Why: a slow SSH read must not overwrite the answer for a path typed after it.
        if (id === request.current) {
          setState(read)
        }
      }
    )
  }, [connectionId, isReachable, path, rootPath])

  useEffect(() => {
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])

  return { state, reload }
}
