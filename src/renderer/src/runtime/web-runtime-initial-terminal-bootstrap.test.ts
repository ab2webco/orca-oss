import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginWebRuntimeInitialTerminalBootstrap,
  clearWebRuntimeInitialTerminalBootstrapForEnvironment,
  clearWebRuntimeInitialTerminalBootstrapForWorktree,
  endWebRuntimeInitialTerminalBootstrap,
  hasWebRuntimeInitialTerminalBootstrap,
  resetWebRuntimeInitialTerminalBootstrapForTests
} from './web-runtime-initial-terminal-bootstrap'

const ENV = 'web-env-1'
const OTHER_ENV = 'web-env-2'
const WT = 'repo::/worktree'
const OTHER_WT = 'repo::/otro'

beforeEach(resetWebRuntimeInitialTerminalBootstrapForTests)

describe('initial terminal bootstrap registry', () => {
  it('lets only one caller claim the bootstrap', () => {
    // El caso real: dos instancias del efecto de sincronizacion vivas a la vez
    // evaluan el mismo snapshot vacio. Si las dos pudieran crear, salen dos
    // terminales — que es el reporte "se abren dos o mas".
    expect(beginWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(true)
    expect(beginWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(false)
  })

  it('stays claimed after a successful bootstrap, so a reconnect does not repeat it', () => {
    beginWebRuntimeInitialTerminalBootstrap(ENV, WT)
    endWebRuntimeInitialTerminalBootstrap(ENV, WT, { succeeded: true })

    // Esto es lo que hace que cerrar la terminal se respete: al reconectar, el
    // snapshot vuelve a traer cero tabs, y sin esta marca se abriria otra.
    expect(hasWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(true)
    expect(beginWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(false)
  })

  it('releases the claim when the bootstrap failed', () => {
    // Un workspace que se quedo sin terminal por un error de red si merece otro
    // intento; marcarlo como listo lo dejaria vacio para siempre.
    beginWebRuntimeInitialTerminalBootstrap(ENV, WT)
    endWebRuntimeInitialTerminalBootstrap(ENV, WT, { succeeded: false })

    expect(hasWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(false)
    expect(beginWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(true)
  })

  it('keeps the claim per worktree and per environment', () => {
    beginWebRuntimeInitialTerminalBootstrap(ENV, WT)
    endWebRuntimeInitialTerminalBootstrap(ENV, WT, { succeeded: true })

    expect(hasWebRuntimeInitialTerminalBootstrap(ENV, OTHER_WT)).toBe(false)
    expect(hasWebRuntimeInitialTerminalBootstrap(OTHER_ENV, WT)).toBe(false)
  })

  it('forgets a worktree the host published as removed', () => {
    // Un workspace borrado y vuelto a crear si merece su terminal inicial otra
    // vez. Este es el unico gancho por worktree, y NO corre en una reconexion.
    beginWebRuntimeInitialTerminalBootstrap(ENV, WT)
    endWebRuntimeInitialTerminalBootstrap(ENV, WT, { succeeded: true })

    clearWebRuntimeInitialTerminalBootstrapForWorktree(WT)

    expect(hasWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(false)
  })

  it('clears only the torn-down environment', () => {
    // El desmontaje de un host no puede hacer que los workspaces de otro
    // vuelvan a abrir terminales solas.
    beginWebRuntimeInitialTerminalBootstrap(ENV, WT)
    endWebRuntimeInitialTerminalBootstrap(ENV, WT, { succeeded: true })
    beginWebRuntimeInitialTerminalBootstrap(OTHER_ENV, WT)
    endWebRuntimeInitialTerminalBootstrap(OTHER_ENV, WT, { succeeded: true })

    clearWebRuntimeInitialTerminalBootstrapForEnvironment(ENV)

    expect(hasWebRuntimeInitialTerminalBootstrap(ENV, WT)).toBe(false)
    expect(hasWebRuntimeInitialTerminalBootstrap(OTHER_ENV, WT)).toBe(true)
  })

  it('does not confuse a worktree id that is a suffix of another', () => {
    // Las claves se arman concatenando entorno y worktree; un `endsWith` ingenuo
    // borraria de mas.
    beginWebRuntimeInitialTerminalBootstrap(ENV, 'repo::/a/worktree')
    endWebRuntimeInitialTerminalBootstrap(ENV, 'repo::/a/worktree', { succeeded: true })

    clearWebRuntimeInitialTerminalBootstrapForWorktree('worktree')

    expect(hasWebRuntimeInitialTerminalBootstrap(ENV, 'repo::/a/worktree')).toBe(true)
  })
})
