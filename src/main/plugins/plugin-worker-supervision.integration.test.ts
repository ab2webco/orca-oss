import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PluginWorkerHandle } from './plugin-host-process'
import { PluginWorkerManager, type PluginWorkerSpawnSpec } from './plugin-worker-manager'

type LogEntry = {
  at: number
  level: 'info' | 'warn' | 'error'
  line: string
}

const pluginRoots: string[] = []
const managers: PluginWorkerManager[] = []
let bundleRoot = ''
let hostEntryPath = ''

function createStateNotifications(): {
  notify: () => void
  waitFor: (predicate: () => boolean, description: string, timeoutMs?: number) => Promise<void>
} {
  const listeners = new Set<() => void>()
  return {
    notify: () => {
      for (const listener of listeners) {
        listener()
      }
    },
    waitFor: (predicate, description, timeoutMs = 10_000) => {
      if (predicate()) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(check)
          reject(new Error(`timed out waiting for ${description}`))
        }, timeoutMs)
        const check = (): void => {
          if (!predicate()) {
            return
          }
          clearTimeout(timeout)
          listeners.delete(check)
          resolve()
        }
        listeners.add(check)
      })
    }
  }
}

beforeAll(async () => {
  bundleRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-host-bundle-'))
  hostEntryPath = join(bundleRoot, 'plugin-host-entry.cjs')
  await build({
    entryPoints: {
      'plugin-host-entry': join(process.cwd(), 'src', 'main', 'plugins', 'plugin-host-entry.ts'),
      'plugin-host-preload': join(process.cwd(), 'src', 'main', 'plugins', 'plugin-host-preload.ts')
    },
    outdir: bundleRoot,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: false,
    logLevel: 'silent'
  })
}, 30_000)

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.disposeAll()))
  await Promise.all(pluginRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

afterAll(async () => {
  if (bundleRoot) {
    await rm(bundleRoot, { recursive: true, force: true })
  }
})

async function createPluginSpec(
  source = `export default function activate(orca) { orca.commands.register('run', async () => ({ ok: true })); }`,
  networkHosts: readonly string[] = []
): Promise<PluginWorkerSpawnSpec> {
  const rootDir = await mkdtemp(join(tmpdir(), 'orca-plugin-supervision-'))
  pluginRoots.push(rootDir)
  await writeFile(join(rootDir, 'main.mjs'), source)
  return {
    pluginKey: 'orca-samples.supervision',
    rootDir,
    mainEntry: 'main.mjs',
    grantedCapabilities: networkHosts.length > 0 ? ['net:fetch'] : [],
    networkHosts
  }
}

describe('real plugin worker supervision', () => {
  it('closes raw Node network and process escape paths', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-denied-read-'))
    pluginRoots.push(outsideRoot)
    const outsidePath = join(outsideRoot, 'secret.txt')
    await writeFile(outsidePath, 'not granted')
    const spec = await createPluginSpec(`
      export default function activate(orca) {
        orca.commands.register('run', async ({ outsidePath }) => {
          const blockedImport = async (specifier) => {
            try {
              await import(specifier)
              return false
            } catch (error) {
              return String(error).includes('network access denied')
            }
          }
          let childProcessBlocked = false
          try {
            const { execFileSync } = await import('node:child_process')
            execFileSync(process.execPath, ['--version'])
          } catch (error) {
            childProcessBlocked = String(error).includes('restricted')
          }
          let fsReadBlocked = false
          try {
            const { readFile } = await import('node:fs/promises')
            await readFile(outsidePath, 'utf8')
          } catch (error) {
            fsReadBlocked = String(error).includes('restricted')
          }
          return {
            net: await blockedImport('node:net'),
            http: await blockedImport('http'),
            dgram: await blockedImport('node:dgram'),
            getBuiltinModule: typeof process.getBuiltinModule,
            binding: typeof process.binding,
            linkedBinding: typeof process._linkedBinding,
            dlopen: typeof process.dlopen,
            webSocket: typeof globalThis.WebSocket,
            childProcessBlocked,
            fsReadBlocked
          }
        })
      }
    `)
    const manager = new PluginWorkerManager({
      entryPath: hostEntryPath,
      executeHostCall: async () => ({ ok: true, value: null }),
      log: vi.fn(),
      onWorkerStateChange: vi.fn(),
      onWorkerGone: vi.fn()
    })
    managers.push(manager)

    const worker = await manager.ensureActive(spec)

    await expect(worker.invokeCommand('run', { outsidePath })).resolves.toEqual({
      net: true,
      http: true,
      dgram: true,
      getBuiltinModule: 'undefined',
      binding: 'undefined',
      linkedBinding: 'undefined',
      dlopen: 'undefined',
      webSocket: 'undefined',
      childProcessBlocked: true,
      fsReadBlocked: true
    })
  })

  it('blocks network access without net:fetch and permits a declared host', async () => {
    let hits = 0
    const server = createServer((_request, response) => {
      hits += 1
      response.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind to TCP')
    }
    const source = `
      export default function activate(orca) {
        orca.commands.register('run', async ({ url }) => {
          try {
            const response = await fetch(url)
            return { ok: true, body: await response.text() }
          } catch (error) {
            return { ok: false, error: String(error) }
          }
        })
      }
    `
    const deniedSpec = await createPluginSpec(source)
    const allowedSpec = await createPluginSpec(source, ['127.0.0.1'])
    const createManager = (): PluginWorkerManager => {
      const manager = new PluginWorkerManager({
        entryPath: hostEntryPath,
        executeHostCall: async () => ({ ok: true, value: null }),
        log: vi.fn(),
        onWorkerStateChange: vi.fn(),
        onWorkerGone: vi.fn()
      })
      managers.push(manager)
      return manager
    }

    try {
      const denied = await createManager().ensureActive(deniedSpec)
      await expect(
        denied.invokeCommand('run', { url: `http://127.0.0.1:${address.port}` })
      ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('net:fetch') })
      expect(hits).toBe(0)

      const allowed = await createManager().ensureActive(allowedSpec)
      await expect(
        allowed.invokeCommand('run', { url: `http://127.0.0.1:${address.port}` })
      ).resolves.toEqual({ ok: true, body: 'ok' })
      expect(hits).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('terminates and supervises a live worker that disconnects IPC', async () => {
    const spec = await createPluginSpec(`
      export default function activate(orca) {
        orca.commands.register('disconnect', async () => {
          process.disconnect?.()
          setInterval(() => {}, 1_000)
          await new Promise(() => {})
        })
      }
    `)
    const notifications = createStateNotifications()
    const manager = new PluginWorkerManager({
      entryPath: hostEntryPath,
      executeHostCall: async () => ({ ok: true, value: null }),
      log: vi.fn(),
      onWorkerStateChange: notifications.notify,
      onWorkerGone: vi.fn()
    })
    managers.push(manager)

    const worker = await manager.ensureActive(spec)
    const command = worker.invokeCommand('disconnect')

    await expect(command).rejects.toThrow('disconnected')
    await notifications.waitFor(
      () => manager.runState(spec.pluginKey) === 'restarting',
      'disconnected worker to enter supervised backoff'
    )
    expect(manager.restartCount(spec.pluginKey)).toBe(1)
  })

  it('restarts forced exits with 500/2000/5000ms backoff, then stays errored', async () => {
    const spec = await createPluginSpec()
    const notifications = createStateNotifications()
    const logs: LogEntry[] = []
    const manager = new PluginWorkerManager({
      entryPath: hostEntryPath,
      executeHostCall: async () => ({ ok: true, value: null }),
      log: (_pluginKey, level, line) => logs.push({ at: performance.now(), level, line }),
      onWorkerStateChange: notifications.notify,
      onWorkerGone: vi.fn()
    })
    managers.push(manager)

    let current: PluginWorkerHandle = await manager.ensureActive(spec)
    expect(current.commands).toContain('run')
    expect(manager.runState(spec.pluginKey)).toBe('running')

    for (const [index, delayMs] of [500, 2_000, 5_000].entries()) {
      const exited = current
      exited.kill()
      await notifications.waitFor(
        () =>
          manager.runState(spec.pluginKey) === 'restarting' &&
          manager.restartCount(spec.pluginKey) === index + 1,
        `restart ${index + 1} to enter backoff`
      )
      const restartLog = logs.find((entry) =>
        entry.line.includes(`restart ${index + 1} in ${delayMs}ms`)
      )
      expect(restartLog?.level).toBe('warn')

      current = await manager.ensureActive(spec)

      expect(current).not.toBe(exited)
      expect(manager.runState(spec.pluginKey)).toBe('running')
      expect(performance.now() - restartLog!.at).toBeGreaterThanOrEqual(delayMs - 25)
    }

    current.kill()
    await notifications.waitFor(
      () => manager.runState(spec.pluginKey) === 'errored',
      'fourth forced exit to become terminally errored'
    )

    expect(manager.restartCount(spec.pluginKey)).toBe(3)
    expect(
      logs.some((entry) => entry.level === 'error' && entry.line.includes('marked errored'))
    ).toBe(true)
    await expect(manager.ensureActive(spec)).rejects.toThrow('errored after repeated failures')
  }, 45_000)
})
