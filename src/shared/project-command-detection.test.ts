import { describe, expect, it } from 'vitest'
import { GAME_ACTION_COMMAND } from './orchestrator-game-actions'
import { GAME_LINK_LABEL_MAX } from './orchestrator-game-integrations'
import { detectProjectCommands } from './project-command-detection'
import type { ProjectFileReader } from './project-file-reader-contract'

function memoryRepo(files: Record<string, string>): ProjectFileReader & { reads: string[] } {
  const reads: string[] = []
  const childrenOf = (dir: string) => {
    const prefix = dir === '' ? '' : `${dir}/`
    const children = new Map<string, boolean>()
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) {
        continue
      }
      const [name, ...rest] = path.slice(prefix.length).split('/')
      children.set(name, rest.length > 0 || children.get(name) === true)
    }
    return children
  }
  return {
    reads,
    readFile: async (path) => {
      reads.push(path)
      return files[path] ?? null
    },
    fileExists: async (path) => files[path] !== undefined,
    readDir: async (path) => {
      const children = childrenOf(path)
      if (path !== '' && children.size === 0) {
        return null
      }
      return [...children].map(([name, isDirectory]) => ({ name, isDirectory }))
    }
  }
}

const NODE_REPO = {
  'package.json': JSON.stringify({
    scripts: {
      test: 'vitest run',
      lint: 'oxlint',
      build: 'vite build',
      'build:prod': 'vite build --mode production',
      prebuild: 'rimraf dist',
      postinstall: 'husky',
      prepare: 'husky'
    }
  }),
  'pnpm-lock.yaml': 'lockfileVersion: 9.0',
  'scripts/release.mjs': 'console.info(1)',
  'scripts/notes.md': '# notes',
  '.github/workflows/ci.yml': [
    'jobs:',
    '  verify:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Install',
    '        run: pnpm install --frozen-lockfile',
    '      - run: pnpm test',
    '      - name: Deploy',
    '        run: deploy ${{ secrets.TOKEN }}',
    '  e2e:',
    '    steps:',
    '      - run: pnpm test'
  ].join('\n')
}

const RUBY_REPO = {
  Gemfile: "source 'https://rubygems.org'",
  Rakefile: [
    "require 'rake/testtask'",
    'desc "Run the tests"',
    'task :test do',
    '  ruby "test/all.rb"',
    'end',
    'task default: :test',
    'namespace :db do',
    '  task :migrate do',
    '  end',
    "  task 'seed' => :migrate",
    'end',
    'task :lint'
  ].join('\n'),
  'bin/setup': '#!/usr/bin/env ruby',
  'bin/rails': '#!/usr/bin/env ruby',
  'bin/.keep': ''
}

const PYTHON_REPO = {
  'pyproject.toml': '[project]\nname = "app"',
  Makefile: ['install:', '\tpip install -e .', 'test:', '\tpytest'].join('\n'),
  'scripts/format.py': 'import black',
  'scripts/bootstrap.sh': 'python3 -m venv .venv',
  '.gitlab-ci.yml': [
    'stages: [test]',
    'variables:',
    '  PIP_CACHE_DIR: .cache',
    '.base:',
    '  image: python:3.12',
    'unit-tests:',
    '  stage: test',
    '  script:',
    '    - pip install -r requirements.txt',
    '    - pytest -q',
    'lint:',
    '  script: ruff check .'
  ].join('\n')
}

const MAKE_REPO = {
  GNUmakefile: [
    'CC ?= cc',
    'CFLAGS := -O2',
    'OBJ ::= main.o',
    'export PATH := $(PATH):/opt/bin',
    '.PHONY: all clean check',
    'all: build',
    'build check: deps',
    '\t$(CC) -o app main.c',
    '%.o: %.c',
    '\t$(CC) -c $<',
    'main.o: main.c',
    'dist/app: build',
    '$(OBJ): main.h',
    'clean::',
    '\trm -f app',
    'define RECIPE',
    'fake: target',
    'endef'
  ].join('\n'),
  Makefile: 'ignored: make reads GNUmakefile first',
  justfile: [
    'set shell := ["bash", "-c"]',
    'alias t := test',
    "version := '1.0'",
    'export RUST_LOG := "info"',
    "import 'common.just'",
    'mod tools',
    '# comment: not a recipe',
    'default:',
    '  just --list',
    '@test filter="":',
    '  cargo test {{filter}}',
    'deploy env:',
    '  ./deploy {{env}}',
    'bench *args:',
    '  cargo bench {{args}}',
    "greet name='a b':",
    '  echo {{name}}',
    '_helper:',
    '  echo hidden',
    '[private]',
    'secret:',
    '  echo hidden',
    '[group("ci")]',
    'fmt: default',
    '  cargo fmt'
  ].join('\n')
}

describe('detectProjectCommands', () => {
  it('detects a node repo: package scripts with its package manager, scripts/ and CI steps', async () => {
    const candidates = await detectProjectCommands(memoryRepo(NODE_REPO))

    expect(candidates).toEqual([
      {
        source: 'package-json',
        file: 'package.json',
        label: 'Build',
        run: 'pnpm run build',
        slashCommand: 'build'
      },
      {
        source: 'package-json',
        file: 'package.json',
        label: 'Test',
        run: 'pnpm run test',
        slashCommand: 'test'
      },
      {
        source: 'package-json',
        file: 'package.json',
        label: 'Lint',
        run: 'pnpm run lint',
        slashCommand: 'lint'
      },
      {
        source: 'package-json',
        file: 'package.json',
        label: 'Build prod',
        run: 'pnpm run build:prod',
        slashCommand: 'build-prod'
      },
      {
        source: 'scripts',
        file: 'scripts/release.mjs',
        label: 'Release',
        run: 'node scripts/release.mjs',
        slashCommand: 'release'
      },
      {
        source: 'github-actions',
        file: '.github/workflows/ci.yml',
        label: 'Install',
        run: 'pnpm install --frozen-lockfile',
        slashCommand: 'install'
      },
      {
        source: 'github-actions',
        file: '.github/workflows/ci.yml',
        label: 'Verify',
        run: 'pnpm test',
        slashCommand: 'verify'
      }
    ])
  })

  it('detects a ruby repo: rake tasks through bundler, namespaced tasks and bin/', async () => {
    const candidates = await detectProjectCommands(memoryRepo(RUBY_REPO))

    expect(candidates.map(({ source, file, run, label }) => [source, file, run, label])).toEqual([
      ['rakefile', 'Rakefile', 'bundle exec rake test', 'Test'],
      ['rakefile', 'Rakefile', 'bundle exec rake default', 'Default'],
      ['rakefile', 'Rakefile', 'bundle exec rake db:migrate', 'Db migrate'],
      ['rakefile', 'Rakefile', 'bundle exec rake db:seed', 'Db seed'],
      ['rakefile', 'Rakefile', 'bundle exec rake lint', 'Lint'],
      ['bin', 'bin/rails', 'bin/rails', 'Rails'],
      ['bin', 'bin/setup', 'bin/setup', 'Setup']
    ])
  })

  it('detects a python repo: Makefile targets, scripts/ by interpreter and GitLab CI jobs', async () => {
    const candidates = await detectProjectCommands(memoryRepo(PYTHON_REPO))

    expect(candidates.map(({ source, file, run, label }) => [source, file, run, label])).toEqual([
      ['makefile', 'Makefile', 'make install', 'Install'],
      ['makefile', 'Makefile', 'make test', 'Test'],
      ['scripts', 'scripts/bootstrap.sh', 'bash scripts/bootstrap.sh', 'Bootstrap'],
      ['scripts', 'scripts/format.py', 'python3 scripts/format.py', 'Format'],
      ['gitlab-ci', '.gitlab-ci.yml', 'pip install -r requirements.txt\npytest -q', 'Unit tests'],
      ['gitlab-ci', '.gitlab-ci.yml', 'ruff check .', 'Lint']
    ])
  })

  it('detects a make repo: the Makefile make reads first, real targets only, and runnable just recipes', async () => {
    const candidates = await detectProjectCommands(memoryRepo(MAKE_REPO))

    expect(candidates.map(({ source, file, run }) => [source, file, run])).toEqual([
      ['makefile', 'GNUmakefile', 'make all'],
      ['makefile', 'GNUmakefile', 'make build'],
      ['makefile', 'GNUmakefile', 'make check'],
      ['makefile', 'GNUmakefile', 'make clean'],
      ['justfile', 'justfile', 'just default'],
      ['justfile', 'justfile', 'just test'],
      ['justfile', 'justfile', 'just bench'],
      ['justfile', 'justfile', 'just greet'],
      ['justfile', 'justfile', 'just fmt']
    ])
  })

  it('skips CI steps that would run elsewhere or in another shell from the repo root', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        '.github/workflows/web.yml': [
          'jobs:',
          '  root:',
          '    steps:',
          '      - run: make check',
          '      - run: npm test',
          '        working-directory: web',
          '      - run: Get-ChildItem',
          '        shell: pwsh',
          '      - run: make root-again',
          '        shell: bash',
          '  nested:',
          '    defaults:',
          '      run:',
          '        working-directory: api',
          '    steps:',
          '      - run: go test ./...',
          '  windows:',
          '    defaults:',
          '      run:',
          '        shell: cmd',
          '    steps:',
          '      - run: dir'
        ].join('\n'),
        '.github/workflows/moved.yml': [
          'defaults:',
          '  run:',
          '    working-directory: docs',
          'jobs:',
          '  build:',
          '    steps:',
          '      - run: mkdocs build'
        ].join('\n')
      })
    )

    expect(candidates.map((candidate) => candidate.run)).toEqual(['make check', 'make root-again'])
  })

  it('keeps one candidate per source when two sources name the same command', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        'package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        Makefile: 'test:\n\tnpm test'
      })
    )

    expect(candidates.map(({ source, run }) => [source, run])).toEqual([
      ['package-json', 'npm run test'],
      ['makefile', 'make test']
    ])
  })

  it('gives a later source its own slash command when two sources name the same command', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        'package.json': JSON.stringify({
          scripts: { test: 'jest', 'check-everything-includi': 'x' }
        }),
        Makefile: 'test:\n\tnpm test\ncheck-everything-includi:\n\ttrue',
        justfile: 'test:\n  cargo test'
      })
    )

    expect(candidates.map(({ run, slashCommand }) => [run, slashCommand])).toEqual([
      ['npm run test', 'test'],
      ['npm run check-everything-includi', 'check-everything-includi'],
      ['make test', 'make-test'],
      ['make check-everything-includi', 'make-check-everything-in'],
      ['just test', 'just-test']
    ])
  })

  it('numbers slash commands that still collide, including names that fall back to run', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        '.github/workflows/ci.yml': [
          'jobs:',
          '  build:',
          '    steps:',
          '      - name: 🚀',
          '        run: make ship',
          '      - name: ✅',
          '        run: make verify',
          '      - name: 🔥',
          '        run: make burn'
        ].join('\n')
      })
    )

    expect(candidates.map(({ run, slashCommand }) => [run, slashCommand])).toEqual([
      ['make ship', 'run'],
      ['make verify', 'github-run'],
      ['make burn', 'github-run-2']
    ])
    for (const candidate of candidates) {
      expect(candidate.slashCommand).toMatch(GAME_ACTION_COMMAND)
    }
  })

  it('uses npm run when lockfiles from two package managers disagree', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
        'yarn.lock': '',
        'package-lock.json': '{}'
      })
    )

    expect(candidates.map((candidate) => candidate.run)).toEqual(['npm run dev'])
  })

  it('skips package scripts whose names a shell would reinterpret', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        'package.json': JSON.stringify({
          scripts: { 'ok:name': 'a', 'rm -rf': 'b', 'x;y': 'c', 'a$(b)': 'd' }
        })
      })
    )

    expect(candidates.map((candidate) => candidate.run)).toEqual(['npm run ok:name'])
  })

  it('proposes labels and slash commands the actions schema accepts', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        'package.json': JSON.stringify({
          scripts: {
            '2fa:rotate': 'x',
            'check:everything:including:the:slow:end-to-end:suites': 'y'
          }
        })
      })
    )

    expect(candidates.map(({ label, slashCommand }) => [label, slashCommand])).toEqual([
      ['2fa rotate', 'run-2fa-rotate'],
      ['Check everything includ…', 'check-everything-includi']
    ])
    for (const candidate of candidates) {
      expect(candidate.label.length).toBeLessThanOrEqual(GAME_LINK_LABEL_MAX)
      expect(candidate.slashCommand).toMatch(GAME_ACTION_COMMAND)
    }
  })

  it('caps the candidates each source can contribute', async () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`task${index}`, 'x'])
    )
    const candidates = await detectProjectCommands(
      memoryRepo({ 'package.json': JSON.stringify({ scripts }) })
    )

    expect(candidates).toHaveLength(20)
  })

  it('keeps the everyday package scripts when the cap cuts a long list', async () => {
    const scripts = Object.fromEntries([
      ...Array.from({ length: 30 }, (_, index) => [`audit${index}`, 'x']),
      ['typecheck', 'tsc'],
      ['build', 'vite build'],
      ['dev', 'vite']
    ])
    const candidates = await detectProjectCommands(
      memoryRepo({ 'package.json': JSON.stringify({ scripts }) })
    )

    expect(candidates.slice(0, 4).map((candidate) => candidate.run)).toEqual([
      'npm run dev',
      'npm run build',
      'npm run typecheck',
      'npm run audit0'
    ])
  })

  it('spreads the CI cap across workflow files and skips CI-only plumbing', async () => {
    const steps = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) => `      - run: ${prefix} ${index}`)
    const candidates = await detectProjectCommands(
      memoryRepo({
        '.github/workflows/a-release.yml': [
          'jobs:',
          '  r:',
          '    steps:',
          ...steps(30, 'release')
        ].join('\n'),
        '.github/workflows/ci.yml': [
          'jobs:',
          '  test:',
          '    steps:',
          '      - run: sudo apt-get install -y libpq-dev',
          '      - run: |',
          '          set -euo pipefail',
          '          echo "$TAG"',
          '      - run: npm test',
          '  win:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - run: dir',
          '  win-bash:',
          '    runs-on: [self-hosted, windows]',
          '    defaults:',
          '      run:',
          '        shell: bash',
          '    steps:',
          '      - run: make win'
        ].join('\n')
      })
    )

    expect(candidates.filter((c) => c.file.endsWith('a-release.yml'))).toHaveLength(5)
    expect(
      candidates.filter((c) => c.file.endsWith('ci.yml')).map((candidate) => candidate.run)
    ).toEqual(['npm test', 'make win'])
  })

  it('ignores files over the import size limit and unparsable CI', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        Makefile: `test:\n${'#'.repeat(300 * 1024)}`,
        '.github/workflows/broken.yml': 'jobs: [unclosed',
        '.gitlab-ci.yml': '- not a mapping'
      })
    )

    expect(candidates).toEqual([])
  })

  it('returns nothing for an empty or unreadable repo', async () => {
    await expect(detectProjectCommands(memoryRepo({}))).resolves.toEqual([])
    await expect(
      detectProjectCommands({
        readFile: async () => null,
        fileExists: async () => false,
        readDir: async () => null
      })
    ).resolves.toEqual([])
  })
})
