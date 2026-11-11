import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, 'apt-mirror-fallback.sh')

// Shapes of the ubuntu24 runner image (mirror list) and the ubuntu base image (deb822 sources).
const RUNNER_MIRRORS = [
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1',
  'https://archive.ubuntu.com/ubuntu/\tpriority:2',
  'https://security.ubuntu.com/ubuntu/\tpriority:3',
  ''
].join('\n')
const UBUNTU_SOURCES = [
  'Types: deb',
  'URIs: http://archive.ubuntu.com/ubuntu/',
  'Suites: noble noble-updates noble-backports',
  'Components: main universe restricted multiverse',
  '',
  'Types: deb',
  'URIs: http://security.ubuntu.com/ubuntu/',
  'Suites: noble-security',
  'Components: main universe restricted multiverse',
  ''
].join('\n')
const OTHER_SOURCES = [
  'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main',
  'deb https://ppa.launchpadcontent.net/fish-shell/release-4/ubuntu noble main',
  ''
].join('\n')

function aptRoot() {
  const root = mkdtempSync(join(tmpdir(), 'orca-apt-mirror-'))
  mkdirSync(join(root, 'etc/apt/sources.list.d'), { recursive: true })
  writeFileSync(join(root, 'etc/apt/apt-mirrors.txt'), RUNNER_MIRRORS)
  writeFileSync(join(root, 'etc/apt/sources.list.d/ubuntu.sources'), UBUNTU_SOURCES)
  writeFileSync(join(root, 'etc/apt/sources.list.d/other.list'), OTHER_SOURCES)
  return root
}

function fallBack(root, env = {}) {
  return spawnSync('bash', [script, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
}

const read = (root, path) => readFileSync(join(root, 'etc/apt', path), 'utf8')

// Why (2026-11-11): runners could not resolve any *.ubuntu.com host, so every Canonical
// mirror in the list failed at once and only a mirror under another domain could answer.
describe('apt mirror fallback', () => {
  it('replaces every Canonical mirror in the runner mirror list with one fallback', () => {
    const root = aptRoot()
    const result = fallBack(root)
    expect(result.status).toBe(0)
    expect(read(root, 'apt-mirrors.txt')).toBe(
      'http://mirrors.edge.kernel.org/ubuntu/\tpriority:1\n'
    )
  })

  it('points the archive and security sources at the fallback', () => {
    const root = aptRoot()
    fallBack(root)
    expect(read(root, 'sources.list.d/ubuntu.sources')).toBe(
      UBUNTU_SOURCES.replaceAll(
        /http:\/\/(archive|security)\.ubuntu\.com\/ubuntu\//g,
        'http://mirrors.edge.kernel.org/ubuntu/'
      )
    )
  })

  it('leaves sources that are not a Canonical archive untouched', () => {
    const root = aptRoot()
    fallBack(root)
    expect(read(root, 'sources.list.d/other.list')).toBe(OTHER_SOURCES)
  })

  it('takes the fallback mirror from APT_FALLBACK_MIRROR', () => {
    const root = aptRoot()
    fallBack(root, { APT_FALLBACK_MIRROR: 'http://mirror.example.test/ubuntu/' })
    expect(read(root, 'apt-mirrors.txt')).toBe('http://mirror.example.test/ubuntu/\tpriority:1\n')
  })

  it('names the mirror it switched to', () => {
    const result = fallBack(aptRoot())
    expect(result.stderr).toContain('apt sources now use http://mirrors.edge.kernel.org/ubuntu/')
  })

  it('succeeds on a root without a mirror list', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-apt-mirror-'))
    mkdirSync(join(root, 'etc/apt'), { recursive: true })
    writeFileSync(
      join(root, 'etc/apt/sources.list'),
      'deb http://archive.ubuntu.com/ubuntu noble main\n'
    )
    expect(fallBack(root).status).toBe(0)
    expect(read(root, 'sources.list')).toBe(
      'deb http://mirrors.edge.kernel.org/ubuntu/ noble main\n'
    )
  })
})
