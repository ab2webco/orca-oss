import { useCallback, useEffect, useRef, useState } from 'react'
import { parseOrcaYaml } from '../../../../shared/orca-yaml'
import { withOrcaYamlGameActions } from '../../../../shared/orca-yaml-game-actions-edit'
import type { OrchestratorGameAction } from '../../../../shared/orchestrator-game-actions'
import type { SshMutationExpectation } from '../../../../shared/ssh-types'
import { joinPath } from '../../lib/path'
import type { SceneFileFs } from './orchestrator-game-scene-file-io'
import { translate } from '@/i18n/i18n'

/** The file as Settings showed it ('' when missing), and its project actions. */
export type OrcaYamlGameActions = { text: string; actions: OrchestratorGameAction[] }

type FileArgs = { fs: SceneFileFs; rootPath: string; connectionId?: string }

async function readText({ fs, rootPath, connectionId }: FileArgs): Promise<string> {
  const filePath = joinPath(rootPath, 'orca.yaml')
  try {
    return (await fs.readFile({ filePath, connectionId })).content
  } catch (error) {
    if (await fs.pathExists({ filePath, connectionId })) {
      throw error
    }
    return ''
  }
}

export async function readOrcaYamlGameActions(args: FileArgs): Promise<OrcaYamlGameActions> {
  const text = await readText(args)
  return { text, actions: parseOrcaYaml(text)?.orchestratorGame?.actions ?? [] }
}

/** Throws 'changed' when the file moved on since `shown`, 'invalid' or 'too-large' when the edit
 *  cannot be made; otherwise writes only `orchestratorGame.actions`, creating the file if needed. */
export async function writeOrcaYamlGameActions(
  args: FileArgs & {
    expectation?: SshMutationExpectation
    shown: string
    actions: OrchestratorGameAction[]
  }
): Promise<OrcaYamlGameActions> {
  const now = await readText(args)
  if (now !== args.shown) {
    throw new Error('changed')
  }
  const edit = withOrcaYamlGameActions(now, args.actions)
  if (!edit.ok) {
    throw new Error(edit.reason)
  }
  const filePath = joinPath(args.rootPath, 'orca.yaml')
  const target = { filePath, connectionId: args.connectionId, ...args.expectation }
  if (now === '' && !(await args.fs.pathExists({ filePath, connectionId: args.connectionId }))) {
    await args.fs.createFile(target)
  }
  await args.fs.writeFile({ ...target, content: edit.text })
  return { text: edit.text, actions: args.actions }
}

/** What Settings says when an orca.yaml write was refused; this machine's settings stay as they were. */
export function orcaYamlWriteErrorText(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error)
  if (reason === 'changed') {
    return translate(
      'settings.gameActions.fileChanged',
      'orca.yaml changed since it was shown. Check it and try again.'
    )
  }
  if (reason === 'invalid') {
    return translate(
      'settings.gameActions.fileInvalid',
      'orca.yaml has a syntax error. Fix it before saving here.'
    )
  }
  return translate('settings.gameActions.fileFailed', 'Could not save orca.yaml: {{reason}}', {
    reason
  })
}

/** The target worktree's orca.yaml for Settings > Actions, read again on window focus. */
export function useOrcaYamlGameActions(args: {
  rootPath: string
  connectionId: string | undefined
  isReachable: boolean
}): { file: OrcaYamlGameActions | null; setFile: (file: OrcaYamlGameActions) => void } {
  const { rootPath, connectionId, isReachable } = args
  const [file, setFile] = useState<OrcaYamlGameActions | null>(null)
  const request = useRef(0)
  const reload = useCallback((): void => {
    const id = ++request.current
    if (!isReachable) {
      return
    }
    void readOrcaYamlGameActions({ fs: window.api.fs, rootPath, connectionId }).then(
      (read) => id === request.current && setFile(read),
      () => id === request.current && setFile(null)
    )
  }, [connectionId, isReachable, rootPath])
  useEffect(() => {
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])
  return { file, setFile }
}
