/** Repo-relative reads a detector needs; local and SSH implementations live in main. */
export type ProjectFileReader = {
  readFile(relativePath: string): Promise<string | null>
  fileExists(relativePath: string): Promise<boolean>
  readDir(relativePath: string): Promise<ProjectDirEntry[] | null>
}

export type ProjectDirEntry = { name: string; isDirectory: boolean }
