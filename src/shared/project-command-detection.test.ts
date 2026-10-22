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
  'scripts/notes.md': '# notes'
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
  'scripts/bootstrap.sh': 'python3 -m venv .venv'
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
  it('detects a node repo: package scripts with its package manager and scripts/', async () => {
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

  it('detects a python repo: Makefile targets and scripts/ by interpreter', async () => {
    const candidates = await detectProjectCommands(memoryRepo(PYTHON_REPO))

    expect(candidates.map(({ source, file, run, label }) => [source, file, run, label])).toEqual([
      ['makefile', 'Makefile', 'make install', 'Install'],
      ['makefile', 'Makefile', 'make test', 'Test'],
      ['scripts', 'scripts/bootstrap.sh', 'bash scripts/bootstrap.sh', 'Bootstrap'],
      ['scripts', 'scripts/format.py', 'python3 scripts/format.py', 'Format']
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

  it('ignores files over the import size limit', async () => {
    const candidates = await detectProjectCommands(
      memoryRepo({
        Makefile: `test:\n${'#'.repeat(300 * 1024)}`
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
