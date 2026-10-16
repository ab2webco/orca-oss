import { useState } from 'react'
import { FileCode2, FilePlus2, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { OrchestratorGameBuiltInScene } from '../../../../shared/orchestrator-game-config'
import {
  orchestratorGameSceneFileWithin,
  parseOrchestratorGameSceneFile,
  type OrchestratorGameSceneFileError
} from '../../../../shared/orchestrator-game-scene-file'
import { SCENES } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { useAppStore } from '../../store'
import { joinPath } from '../../lib/path'
import { extractIpcErrorMessage } from '../../lib/ipc-error'
import { captureDirectSshMutationExpectation } from '@/lib/ssh-mutation-expectation'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { createOrchestratorGameSceneFile, sceneFileTextOf } from './orchestrator-game-scene-file-io'
import { sceneLabel } from './OrchestratorGameSceneSelect'
import type { SceneFileState } from './use-orchestrator-game-scene-file'
import { translate } from '@/i18n/i18n'

const pathErrorText = (error: OrchestratorGameSceneFileError): string =>
  ({
    'not-a-path': translate(
      'auto.components.settings.OrchestratorGameSetting.sceneFileEmpty',
      'Enter the path of a JSON file in this project.'
    ),
    absolute: translate(
      'auto.components.settings.OrchestratorGameSetting.sceneFileAbsolute',
      'Use a path relative to the project root.'
    ),
    outside: translate(
      'auto.components.settings.OrchestratorGameSetting.sceneFileEscapes',
      'The path must stay inside the project (no ..).'
    )
  })[error]

/** Why the effective scene file is not drawn; nothing while it reads or when it is valid. */
export function OrchestratorGameSceneFileStatus({
  read
}: {
  read: SceneFileState | null
}): React.JSX.Element | null {
  if (read === null || read.status === 'loading' || read.status === 'ok') {
    return null
  }
  const text =
    read.status === 'invalid'
      ? translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileInvalid',
          "This file can't be drawn, so the game draws Quest: {{value0}}",
          { value0: read.message }
        )
      : translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileUnreadable',
          "Couldn't read this file, so the game draws Quest: {{value0}}",
          { value0: read.message }
        )
  return (
    <p role="alert" className="text-xs break-words text-destructive">
      {text}
    </p>
  )
}

/** The project's own scene: its path, where to get one, and why it is not drawn.
 *  Key it by `path` so a new stored path resets the draft. */
export function OrchestratorGameSceneFileField({
  path,
  rootPath,
  worktreeId,
  connectionId,
  baseScene,
  read,
  onPath,
  onFileWritten
}: {
  path: string | undefined
  rootPath: string
  worktreeId: string
  connectionId: string | undefined
  baseScene: OrchestratorGameBuiltInScene
  read: SceneFileState | null
  onPath: (path: string) => void
  onFileWritten: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(path ?? '')
  const [pathError, setPathError] = useState<OrchestratorGameSceneFileError | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const label = translate(
    'auto.components.settings.OrchestratorGameSetting.sceneFile',
    'Scene file'
  )

  const commit = (): void => {
    if (draft === (path ?? '')) {
      return
    }
    const parsed = parseOrchestratorGameSceneFile(draft)
    if (!parsed.ok) {
      setPathError(parsed.error)
      return
    }
    setPathError(null)
    setActionError(null)
    setDraft(parsed.path)
    if (parsed.path !== path) {
      onPath(parsed.path)
    }
  }

  const choose = async (): Promise<void> => {
    setActionError(null)
    const picked = await window.api.shell.pickJsonFile({ defaultPath: rootPath })
    if (picked === null) {
      return
    }
    const within = orchestratorGameSceneFileWithin(rootPath, picked)
    if (within === null) {
      setActionError(
        translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileOutside',
          'Pick a file inside this project ({{value0}}).',
          { value0: rootPath }
        )
      )
      return
    }
    setPathError(null)
    onPath(within)
  }

  const create = async (): Promise<void> => {
    const scene = SCENES[baseScene]
    if (!scene) {
      return
    }
    setActionError(null)
    setIsBusy(true)
    try {
      const created = await createOrchestratorGameSceneFile({
        fs: window.api.fs,
        rootPath,
        connectionId,
        expectation: connectionId
          ? captureDirectSshMutationExpectation(useAppStore.getState(), connectionId)
          : undefined,
        sceneId: baseScene,
        text: sceneFileTextOf(scene)
      })
      setPathError(null)
      onPath(created)
      onFileWritten()
      toast.success(
        translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileCreated',
          'Scene file created'
        ),
        { description: created }
      )
    } catch (error) {
      setActionError(
        extractIpcErrorMessage(
          error,
          translate(
            'auto.components.settings.OrchestratorGameSetting.sceneFileCreateFailed',
            "Couldn't create the scene file."
          )
        )
      )
    } finally {
      setIsBusy(false)
    }
  }

  const open = (): void => {
    if (!path) {
      return
    }
    const state = useAppStore.getState()
    state.setActiveWorktree(worktreeId)
    const targetGroupId = state.ensureWorktreeRootGroup(worktreeId)
    state.openFile(
      {
        filePath: joinPath(rootPath, path),
        relativePath: path,
        worktreeId,
        language: 'json',
        mode: 'edit'
      },
      { targetGroupId }
    )
    state.setActiveView('terminal')
  }

  return (
    <div data-slot="game-scene-file" className="space-y-2 pb-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileDescription',
          'A scene JSON in this project, relative to its root. Each worktree reads its own copy, so edits show on the next refresh.'
        )}
      </p>
      <Input
        aria-label={label}
        aria-invalid={pathError !== null}
        value={draft}
        placeholder=".orca/scenes/my-scene.json"
        spellCheck={false}
        className="h-8 font-mono text-xs md:text-xs"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          }
        }}
      />
      {pathError ? (
        <p role="alert" className="text-xs text-destructive">
          {pathErrorText(pathError)}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {actionError}
        </p>
      ) : null}
      {path && !pathError ? <OrchestratorGameSceneFileStatus read={read} /> : null}
      <div className="flex flex-wrap gap-2">
        {connectionId ? null : (
          <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void choose()}>
            <FolderOpen className="size-3.5" />
            {translate(
              'auto.components.settings.OrchestratorGameSetting.sceneFileChoose',
              'Choose file…'
            )}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void create()}>
          <FilePlus2 className="size-3.5" />
          {translate(
            'auto.components.settings.OrchestratorGameSetting.sceneFileCreate',
            'Create from {{value0}}',
            { value0: sceneLabel({ value: baseScene, kind: 'built-in', scene: baseScene }) }
          )}
        </Button>
        <Button size="sm" variant="outline" disabled={isBusy || !path} onClick={open}>
          <FileCode2 className="size-3.5" />
          {translate(
            'auto.components.settings.OrchestratorGameSetting.sceneFileOpen',
            'Open in editor'
          )}
        </Button>
      </div>
      {connectionId ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.OrchestratorGameSetting.sceneFileSsh',
            'This project is on an SSH host, so type the path; the file picker only browses this computer.'
          )}
        </p>
      ) : null}
    </div>
  )
}
