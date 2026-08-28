import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const PROJECTS = ['electron-headless', 'electron-ondemand', 'electron-headful']
export const BASELINE_PATH = 'config/e2e-project-test-baseline.txt'
const TEST_ROOT = 'tests/e2e'

export function parseListOutput(output, project) {
  const files = new Set()
  const linePattern = new RegExp(`^\\s*\\[${project}\\] › (.+):\\d+:\\d+ ›`)
  for (const line of output.split(/\r?\n/)) {
    const match = linePattern.exec(line)
    if (match) {
      files.add(path.posix.normalize(path.posix.join(TEST_ROOT, match[1].replaceAll('\\\\', '/'))))
    }
  }
  const total = /Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?/.exec(output)
  return {
    files,
    tests: total ? Number(total[1]) : 0,
    listedFiles: total ? Number(total[2]) : files.size
  }
}

export function listSpecFiles(root) {
  const result = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        result.push(path.posix.normalize(path.relative(root, fullPath).replaceAll('\\', '/')))
      }
    }
  }
  visit(path.join(root, TEST_ROOT))
  return new Set(result)
}

export function findUncoveredSpecs(specFiles, projectFiles) {
  const collected = new Set(projectFiles.flatMap((files) => [...files]))
  return [...specFiles].filter((file) => !collected.has(file)).sort()
}

export function parseBaseline(text) {
  const counts = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\d+)$/.exec(line.trim())
    if (match) {
      counts.set(match[1], Number(match[2]))
    }
  }
  return counts
}

export function formatBaseline(counts) {
  return [
    '# E2E test counts per Playwright project.',
    '# This is a ratchet: update intentionally when specs are added or removed.',
    '',
    ...PROJECTS.map((project) => `${project} ${counts.get(project) ?? 0}`),
    ''
  ].join('\n')
}

export function diffAgainstBaseline(current, baseline) {
  return PROJECTS.filter((project) => current.get(project) !== baseline.get(project)).map(
    (project) => ({
      project,
      current: current.get(project) ?? 0,
      expected: baseline.get(project) ?? 0
    })
  )
}

function runProject(root, project) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(
    command,
    [
      'exec',
      'playwright',
      'test',
      '--list',
      '--config',
      'tests/playwright.config.ts',
      '--project',
      project
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }
  )
  if (result.error) {
    throw result.error
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0 && !output.includes('No tests found')) {
    throw new Error(`Playwright --list failed for ${project}:\n${output}`)
  }
  return parseListOutput(output, project)
}

export function checkCoverage(root = process.cwd(), { write = false } = {}) {
  const projectResults = new Map()
  const projectFiles = []
  for (const project of PROJECTS) {
    const result = runProject(root, project)
    projectResults.set(project, result.tests)
    projectFiles.push(result.files)
  }
  const uncovered = findUncoveredSpecs(listSpecFiles(root), projectFiles)
  if (uncovered.length) {
    throw new Error(
      `E2E specs collected by no project:\n${uncovered.map((file) => `  ${file}`).join('\n')}`
    )
  }

  const baselineFile = path.join(root, BASELINE_PATH)
  const baseline = fs.existsSync(baselineFile)
    ? parseBaseline(fs.readFileSync(baselineFile, 'utf8'))
    : new Map()
  const differences = diffAgainstBaseline(projectResults, baseline)
  if (differences.length && !write) {
    throw new Error(
      `E2E project test-count ratchet changed:\n${differences.map(({ project, current, expected }) => `  ${project}: expected ${expected}, found ${current}`).join('\n')}\nRun with --write after reviewing the intentional change.`
    )
  }
  if (write) {
    fs.writeFileSync(baselineFile, formatBaseline(projectResults))
  }
  return { projectResults, uncovered, differences }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = checkCoverage(process.cwd(), { write: process.argv.includes('--write') })
    const total = [...result.projectResults.values()].reduce((sum, count) => sum + count, 0)
    console.log(`E2E spec coverage OK: ${total} tests across ${PROJECTS.length} projects.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
