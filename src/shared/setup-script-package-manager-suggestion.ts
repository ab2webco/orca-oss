import type {
  SetupScriptImportCandidate,
  SetupScriptImportFileExists,
  SetupScriptImportFileRead
} from './setup-script-imports'
import { isSetupScriptImportFieldWithinLimit } from './setup-script-import-limits'

const PACKAGE_JSON_PATH = 'package.json'
export type NodePackageManagerName = 'pnpm' | 'bun' | 'yarn' | 'npm'

const PACKAGE_MANAGER_LOCKFILES = [
  { path: 'pnpm-lock.yaml', manager: 'pnpm' },
  { path: 'bun.lock', manager: 'bun' },
  { path: 'bun.lockb', manager: 'bun' },
  { path: 'yarn.lock', manager: 'yarn' },
  { path: 'package-lock.json', manager: 'npm' },
  { path: 'npm-shrinkwrap.json', manager: 'npm' }
] as const

export async function inspectPackageManagerSetupCandidate(
  readFile: SetupScriptImportFileRead,
  fileExists?: SetupScriptImportFileExists
): Promise<SetupScriptImportCandidate | null> {
  const packageJsonContent = await readFile(PACKAGE_JSON_PATH)
  const packageJson = parsePackageJson(packageJsonContent)
  if (!packageJson) {
    return null
  }

  const resolution = await resolveNodePackageManager(
    packageJson,
    fileExists ?? fallbackFileExists(readFile)
  )
  if (!resolution) {
    return null
  }

  return {
    provider: 'package-manager',
    label: 'package manager',
    files: resolution.files,
    setup: `${resolution.manager} install`,
    unsupportedFields: []
  }
}

/** Null when lockfiles from different managers disagree; npm when nothing names one. */
export async function resolveNodePackageManager(
  packageJson: Record<string, unknown>,
  fileExists: SetupScriptImportFileExists
): Promise<{ manager: NodePackageManagerName; files: string[] } | null> {
  const packageManager = getPackageManagerName(packageJson.packageManager)
  if (packageManager) {
    return { manager: packageManager, files: [PACKAGE_JSON_PATH] }
  }

  const lockfileReads = await Promise.all(
    PACKAGE_MANAGER_LOCKFILES.map(async (entry) => ({
      ...entry,
      exists: await fileExists(entry.path)
    }))
  )
  const lockfiles = lockfileReads.filter((entry) => entry.exists)
  const lockfileManagers = new Set(lockfiles.map((entry) => entry.manager))
  if (lockfileManagers.size > 1) {
    return null
  }
  const selectedLockfile = lockfiles[0]
  return selectedLockfile
    ? { manager: selectedLockfile.manager, files: [selectedLockfile.path] }
    : { manager: 'npm', files: [PACKAGE_JSON_PATH] }
}

function fallbackFileExists(readFile: SetupScriptImportFileRead): SetupScriptImportFileExists {
  return async (relativePath) => (await readFile(relativePath)) !== null
}

export function parsePackageJson(content: string | null): Record<string, unknown> | null {
  if (!content) {
    return null
  }
  try {
    const parsed = JSON.parse(content)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function getPackageManagerName(value: unknown): NodePackageManagerName | null {
  if (typeof value !== 'string' || !isSetupScriptImportFieldWithinLimit(value)) {
    return null
  }
  const packageManager = value.trim().toLowerCase()
  if (packageManager.startsWith('pnpm@')) {
    return 'pnpm'
  }
  if (packageManager.startsWith('bun@')) {
    return 'bun'
  }
  if (packageManager.startsWith('yarn@')) {
    return 'yarn'
  }
  if (packageManager.startsWith('npm@')) {
    return 'npm'
  }
  return null
}
