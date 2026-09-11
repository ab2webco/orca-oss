import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAgentCliInstallRoot } from './agent-cli-self-update-probe'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-self-update-'))
  tempDirs.push(dir)
  return dir
}

describe('resolveAgentCliInstallRoot', () => {
  it('points at the scope directory for a scoped npm package', () => {
    // Why el scope y no el paquete: npm actualiza renombrando dentro de `@openai/`
    // (`rename @openai/codex -> @openai/.codex-XXXX`), que es el syscall del
    // error que reportan los usuarios.
    expect(
      resolveAgentCliInstallRoot(
        path.join('/usr', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      )
    ).toBe(path.join('/usr', 'lib', 'node_modules', '@openai'))
  })

  it('points at node_modules for an unscoped npm package', () => {
    expect(
      resolveAgentCliInstallRoot(path.join('/usr', 'lib', 'node_modules', 'thing', 'bin', 'cli.js'))
    ).toBe(path.join('/usr', 'lib', 'node_modules'))
  })

  it('uses the deepest node_modules when a package is nested', () => {
    expect(
      resolveAgentCliInstallRoot(
        path.join('/opt', 'node_modules', 'outer', 'node_modules', 'inner', 'bin.js')
      )
    ).toBe(path.join('/opt', 'node_modules', 'outer', 'node_modules'))
  })

  it('falls back to the containing directory for a plain binary', () => {
    // El instalador nativo de claude no pasa por node_modules.
    expect(resolveAgentCliInstallRoot(path.join('/home', 'me', '.local', 'bin', 'claude'))).toBe(
      path.join('/home', 'me', '.local', 'bin')
    )
  })
})

describe('writability of the resolved install root', () => {
  it('distinguishes a writable root from a read-only one', () => {
    // Why un test real y no un mock de fs: la sonda existe para responder una
    // pregunta del sistema de archivos, y un mock la responderia por definicion.
    const root = makeTempDir()
    expect(() => fs.accessSync(root, fs.constants.W_OK)).not.toThrow()

    fs.chmodSync(root, 0o500)
    const readOnlyRejected = (() => {
      try {
        fs.accessSync(root, fs.constants.W_OK)
        return false
      } catch {
        return true
      }
    })()
    fs.chmodSync(root, 0o700)

    // Why el guardia: como root todo es escribible, y el CI puede correr como root.
    if (process.getuid?.() === 0) {
      expect(readOnlyRejected).toBe(false)
      return
    }
    expect(readOnlyRejected).toBe(true)
  })
})
