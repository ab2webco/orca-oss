/**
 * Un workspace remoto sin terminales recibe una al abrirlo. Esa parte es
 * deseada; lo que no puede pasar es que se repita.
 *
 * El guardia que habia vivia en un `let` DENTRO del efecto que se suscribe a los
 * session tabs, y ese efecto se vuelve a correr con cada cambio de
 * `activeWorktreeRuntimeConnectionGeneration`, `activeWorktreeRuntimeId` o
 * `activeWorktreeRuntimePairingRevision` — o sea, en cada reconexion y en cada
 * reinicio del runtime. Cada corrida estrenaba el guardia en `false`, asi que el
 * primer snapshot que llegara con cero tabs volvia a abrir una terminal:
 *
 *  - cerrar la ultima terminal no se respetaba: al reconectar reaparecia;
 *  - dos instancias del efecto vivas a la vez abrian dos (o mas), porque el
 *    snapshot de la segunda se tomo antes de que la terminal de la primera
 *    quedara registrada, y ninguna veia el intento de la otra.
 *
 * Por eso el registro es de MODULO y no del efecto: tiene que sobrevivir
 * exactamente a lo que hacia fallar al anterior. Mismo patron que
 * `web-runtime-wake-terminal-respawn.ts`, con una diferencia: aqui el estado
 * "listo" es permanente mientras el cliente viva, no un candado en vuelo. Un
 * candado que se suelta al terminar volveria a permitir el rebote en la
 * siguiente reconexion, que es el bug.
 */
type BootstrapState = 'in-flight' | 'done'

const bootstrapStateByOwner = new Map<string, BootstrapState>()

const OWNER_KEY_SEPARATOR = '::'

function ownerKey(environmentId: string, worktreeId: string): string {
  return `${environmentId}${OWNER_KEY_SEPARATOR}${worktreeId}`
}

/** True cuando este workspace ya recibio (o esta recibiendo) su terminal inicial. */
export function hasWebRuntimeInitialTerminalBootstrap(
  environmentId: string,
  worktreeId: string
): boolean {
  return bootstrapStateByOwner.has(ownerKey(environmentId, worktreeId))
}

/**
 * Reclama el derecho a abrir la terminal inicial. Devuelve `false` si otra
 * instancia del efecto ya lo reclamo — es la parte atomica, y lo que evita que
 * dos suscripciones concurrentes abran dos terminales.
 */
export function beginWebRuntimeInitialTerminalBootstrap(
  environmentId: string,
  worktreeId: string
): boolean {
  const key = ownerKey(environmentId, worktreeId)
  if (bootstrapStateByOwner.has(key)) {
    return false
  }
  bootstrapStateByOwner.set(key, 'in-flight')
  return true
}

/**
 * Cierra el intento. Si fallo se suelta el registro, porque un workspace que se
 * quedo sin terminal por un error de red SI merece otro intento; si funciono
 * queda marcado para siempre, que es lo que hace que cerrar la terminal a mano
 * se respete.
 */
export function endWebRuntimeInitialTerminalBootstrap(
  environmentId: string,
  worktreeId: string,
  outcome: { succeeded: boolean }
): void {
  const key = ownerKey(environmentId, worktreeId)
  if (outcome.succeeded) {
    bootstrapStateByOwner.set(key, 'done')
    return
  }
  bootstrapStateByOwner.delete(key)
}

/**
 * Se llama cuando el workspace deja de existir para este cliente (el host lo
 * publico como `removed`). Un workspace borrado y vuelto a crear si merece su
 * terminal inicial otra vez; una reconexion NO, y por eso este es el unico
 * gancho por worktree.
 */
export function clearWebRuntimeInitialTerminalBootstrapForWorktree(worktreeId: string): void {
  const suffix = `${OWNER_KEY_SEPARATOR}${worktreeId}`
  for (const key of bootstrapStateByOwner.keys()) {
    if (key.endsWith(suffix)) {
      bootstrapStateByOwner.delete(key)
    }
  }
}

/**
 * Solo las entradas de ese entorno: el desmontaje de un host no tiene por que
 * hacer que los workspaces de otro vuelvan a abrir terminales.
 */
export function clearWebRuntimeInitialTerminalBootstrapForEnvironment(environmentId: string): void {
  const prefix = `${environmentId}${OWNER_KEY_SEPARATOR}`
  for (const key of bootstrapStateByOwner.keys()) {
    if (key.startsWith(prefix)) {
      bootstrapStateByOwner.delete(key)
    }
  }
}

export function clearAllWebRuntimeInitialTerminalBootstrap(): void {
  bootstrapStateByOwner.clear()
}

export function resetWebRuntimeInitialTerminalBootstrapForTests(): void {
  clearAllWebRuntimeInitialTerminalBootstrap()
}
