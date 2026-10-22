import { readdir, readFile, stat } from 'node:fs/promises'
import type { ProjectFileReader } from '../../shared/project-file-reader-contract'
import { isENOENT } from './ipc/filesystem-path-containment'
import type { IFilesystemProvider } from './providers/types'
import { joinWorktreeRelativePath } from './runtime/runtime-relative-paths'

export function createLocalProjectFileReader(rootPath: string): ProjectFileReader {
  return {
    readFile: async (relativePath) => {
      try {
        return await readFile(joinWorktreeRelativePath(rootPath, relativePath), 'utf-8')
      } catch (error) {
        warnUnlessMissing('read', error)
        return null
      }
    },
    fileExists: async (relativePath) => {
      try {
        return !(await stat(joinWorktreeRelativePath(rootPath, relativePath))).isDirectory()
      } catch (error) {
        warnUnlessMissing('stat', error)
        return false
      }
    },
    readDir: async (relativePath) => {
      try {
        const entries = await readdir(joinWorktreeRelativePath(rootPath, relativePath), {
          withFileTypes: true
        })
        return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      } catch (error) {
        warnUnlessMissing('list', error)
        return null
      }
    }
  }
}

/** Why: an SSH repo's files live on the remote host; reading the local disk would inspect the wrong tree. */
export function createRemoteProjectFileReader(
  rootPath: string,
  fsProvider: IFilesystemProvider | undefined
): ProjectFileReader {
  return {
    readFile: async (relativePath) => {
      if (!fsProvider) {
        return null
      }
      try {
        const result = await fsProvider.readFile(joinWorktreeRelativePath(rootPath, relativePath))
        return result.isBinary ? null : result.content
      } catch {
        return null
      }
    },
    fileExists: async (relativePath) => {
      if (!fsProvider) {
        return false
      }
      try {
        const fileStat = await fsProvider.stat(joinWorktreeRelativePath(rootPath, relativePath))
        return fileStat.type !== 'directory'
      } catch {
        return false
      }
    },
    readDir: async (relativePath) => {
      if (!fsProvider) {
        return null
      }
      try {
        const entries = await fsProvider.readDir(joinWorktreeRelativePath(rootPath, relativePath))
        return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }))
      } catch {
        return null
      }
    }
  }
}

function warnUnlessMissing(operation: string, error: unknown): void {
  if (!isENOENT(error)) {
    console.warn(`[project-files] Failed to ${operation} project file:`, error)
  }
}
