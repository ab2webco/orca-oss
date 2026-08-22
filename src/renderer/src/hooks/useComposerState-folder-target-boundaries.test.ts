import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK_SOURCE = readFileSync(join(__dirname, 'useComposerState.ts'), 'utf8')

function sourceBetween(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start + startPattern.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

// Split out of useComposerState-host-context-boundaries.test.ts: the merged file
// crossed the 800-line cap once both lineages added cases. Folder-target source
// resolution is a self-contained slice.
describe('useComposerState folder-target boundaries', () => {
  it('disables repo-backed folder smart lookup when a folder target has no source repos', () => {
    const cardProps = sourceBetween(
      HOOK_SOURCE,
      'const cardProps: ComposerCardProps = {',
      'return {'
    )
    expect(cardProps).toContain(
      'repoBackedSourcesDisabled: isProjectGroupTarget ? folderSourceRepos.length === 0 : false'
    )
    expect(cardProps).toContain(
      'repoBackedSearchRepos: isProjectGroupTarget ? folderSourceRepos : undefined'
    )
  })

  it('surfaces folder submit smart-resolution failures through create error UI', () => {
    const section = sourceBetween(
      HOOK_SOURCE,
      'const submitFolderTarget',
      'const submit = useCallback'
    )
    expect(section).toContain('catch (error)')
    expect(section).toContain('const formattedError = formatWorkspaceCreateError(error)')
    expect(section).toContain('setCreateError(formattedError)')
    expect(section).toContain('toast.error(getWorkspaceCreateErrorToastMessage(formattedError))')
    expect(section).toContain('if (!folderWorkspaceCreated)')
    expect(section).toContain('setCreateError({')
  })

  it('uses submit-time smart metadata for both folder launch mode and startup content', () => {
    const section = sourceBetween(
      HOOK_SOURCE,
      'const submitFolderTarget',
      'const submit = useCallback'
    )
    expect(section).toContain(
      'const submitLinkedWorkItem = smartGitHubMetadata?.linkedWorkItem ?? linkedWorkItem'
    )
    expect(section).toContain('resolveFolderWorkspaceLaunchDraft(submitLinkedWorkItem, note)')
    expect(section).toContain('linkedWorkItem: submitLinkedWorkItem')
  })

  it('gates every submit path on the derived source intent', () => {
    // Why: derived from name+mode, so the submitted name and the gate can never disagree.
    expect(HOOK_SOURCE).toContain(
      'const sourceIntentBlocksCreate = !linkedWorkItem && isBlockingJiraUrlIntent(smartNameMode, name)'
    )
    const submitSections = [
      sourceBetween(HOOK_SOURCE, 'const folderCreateDisabled', 'const submit = useCallback'),
      sourceBetween(HOOK_SOURCE, 'const submit = useCallback', 'const submitQuick = useCallback'),
      sourceBetween(HOOK_SOURCE, 'const submitQuick = useCallback', 'const createGateInput')
    ]

    for (const section of submitSections) {
      expect(section).toContain('sourceIntentBlocksCreate')
    }
  })

  it('passes folder child repos to smart lookup instead of building task source options', () => {
    const cardProps = sourceBetween(
      HOOK_SOURCE,
      'const cardProps: ComposerCardProps = {',
      'return {'
    )
    expect(cardProps).toContain(
      'repoBackedSearchRepos: isProjectGroupTarget ? folderSourceRepos : undefined'
    )
    expect(HOOK_SOURCE).not.toContain('folderSourceProjectOptions')
    expect(HOOK_SOURCE).not.toContain('handleFolderTaskSourceProjectChange')
    expect(HOOK_SOURCE).not.toContain('getRepoIdFromNewWorkspaceFolderSourceOptionId')
  })

  it('keeps folder run repo changes inside the selected folder source set', () => {
    const section = sourceBetween(
      HOOK_SOURCE,
      'const handleFolderSourceRepoChange = useCallback',
      'const handleProjectHostSetupChange = useCallback'
    )
    expect(section).toContain('folderSourceRepos.some((repo) => repo.id === value)')
    expect(section).toContain('return')

    const cardProps = sourceBetween(
      HOOK_SOURCE,
      'const cardProps: ComposerCardProps = {',
      'return {'
    )
    expect(cardProps).toContain('allowSmartNameAddProject: !isProjectGroupTarget')
  })
})
