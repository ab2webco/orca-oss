import { normalizeProxyUrl } from '../../../shared/network-proxy'
import { normalizeKagiSessionLink } from '../../../shared/browser-url'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { SshPtyConsumerRecovery } from '../../../shared/ssh-types'
import {
  PROTECTED_SECRET_SLOT,
  sshPtyOwnerLeaseSecretSlot,
  type LegacyPlaintextValidator,
  type ProtectedSecretDecryption,
  type ProtectedSecretPersistence
} from '../../protected-secret-persistence'
import {
  isLegacyOpenCodeSessionCookie,
  isLegacySshPtyOwnerLease
} from '../leasing-ssh-ptys/secret-validation'
import { normalizeSshPtyConsumerRecovery } from '../leasing-ssh-ptys/ssh-normalization'

export type ProtectedSecretRead = {
  slot: string
  ciphertext: string
  isLegacyPlaintext: LegacyPlaintextValidator
}

// A slot with no result yet reads as sealed: blank in memory, ciphertext retained for saves.
const SEALED: ProtectedSecretDecryption = { plaintext: '', status: 'unavailable' }

export function protectedSecretReads(state: PersistedState): ProtectedSecretRead[] {
  const reads: ProtectedSecretRead[] = []
  if (state.settings?.opencodeSessionCookie) {
    reads.push({
      slot: PROTECTED_SECRET_SLOT.opencodeSessionCookie,
      ciphertext: state.settings.opencodeSessionCookie,
      isLegacyPlaintext: isLegacyOpenCodeSessionCookie
    })
  }
  if (state.settings?.httpProxyUrl) {
    reads.push({
      slot: PROTECTED_SECRET_SLOT.httpProxyUrl,
      ciphertext: state.settings.httpProxyUrl,
      isLegacyPlaintext: (value) => normalizeProxyUrl(value).ok
    })
  }
  if (state.ui?.browserKagiSessionLink) {
    reads.push({
      slot: PROTECTED_SECRET_SLOT.browserKagiSessionLink,
      ciphertext: state.ui.browserKagiSessionLink,
      isLegacyPlaintext: (value) => normalizeKagiSessionLink(value) !== null
    })
  }
  for (const record of state.sshPtyConsumerRecoveries ?? []) {
    reads.push({
      slot: sshPtyOwnerLeaseSecretSlot(record.targetId),
      ciphertext: record.ownerLease,
      isLegacyPlaintext: isLegacySshPtyOwnerLease
    })
  }
  return reads
}

// Why: a late Keychain answer must not overwrite a value saved after the timeout, such as a
// re-typed proxy or the lease of an SSH owner the relay granted in the meantime.
export function holdsSealedPlaceholder(state: PersistedState, read: ProtectedSecretRead): boolean {
  switch (read.slot) {
    case PROTECTED_SECRET_SLOT.opencodeSessionCookie:
      return !state.settings?.opencodeSessionCookie
    case PROTECTED_SECRET_SLOT.httpProxyUrl:
      return !state.settings?.httpProxyUrl
    case PROTECTED_SECRET_SLOT.browserKagiSessionLink:
      return !state.ui?.browserKagiSessionLink
    default:
      // A sealed lease record keeps its ciphertext in place of the lease.
      return (state.sshPtyConsumerRecoveries ?? []).some(
        (record) =>
          sshPtyOwnerLeaseSecretSlot(record.targetId) === read.slot &&
          record.ownerLease === read.ciphertext
      )
  }
}

/** Writes decrypted values into `state`; returns whether the result must be re-saved. */
export function applyProtectedSecretReads(
  state: PersistedState,
  reads: readonly ProtectedSecretRead[],
  results: ReadonlyMap<string, ProtectedSecretDecryption>,
  protectedSecrets: ProtectedSecretPersistence
): boolean {
  let needsSave = false
  // Why: keyed by the reads, not the fields, because sealed fields are already blank in memory.
  const readSlots = new Set(reads.map((read) => read.slot))
  const resultFor = (slot: string): ProtectedSecretDecryption => results.get(slot) ?? SEALED
  if (state.settings && readSlots.has(PROTECTED_SECRET_SLOT.opencodeSessionCookie)) {
    state.settings.opencodeSessionCookie = resultFor(
      PROTECTED_SECRET_SLOT.opencodeSessionCookie
    ).plaintext
  }
  if (state.settings && readSlots.has(PROTECTED_SECRET_SLOT.httpProxyUrl)) {
    const decryptedProxy = resultFor(PROTECTED_SECRET_SLOT.httpProxyUrl)
    // Why (STA-3442): after a keychain reset decrypt returns raw ciphertext; a non-URL
    // value must not masquerade as a configured proxy (silent DIRECT fallback) or
    // re-persist as garbage. Plaintext URLs still pass, preserving the upgrade path.
    if (
      decryptedProxy.status === 'unavailable' ||
      (decryptedProxy.status === 'failed' && !decryptedProxy.plaintext)
    ) {
      state.settings.httpProxyUrl = ''
    } else if (normalizeProxyUrl(decryptedProxy.plaintext).ok) {
      state.settings.httpProxyUrl = decryptedProxy.plaintext
    } else {
      console.warn(
        '[persistence] httpProxyUrl could not be decrypted — clearing the stored proxy URL. Re-enter it in Settings > Advanced > Network.'
      )
      state.settings.httpProxyUrl = ''
      protectedSecrets.removeRetainedBlob(PROTECTED_SECRET_SLOT.httpProxyUrl)
      needsSave = true
    }
  }
  if (state.ui && readSlots.has(PROTECTED_SECRET_SLOT.browserKagiSessionLink)) {
    state.ui.browserKagiSessionLink = resultFor(
      PROTECTED_SECRET_SLOT.browserKagiSessionLink
    ).plaintext
  }
  if (state.sshPtyConsumerRecoveries) {
    state.sshPtyConsumerRecoveries = state.sshPtyConsumerRecoveries
      .map((record) => {
        const slot = sshPtyOwnerLeaseSecretSlot(record.targetId)
        if (!readSlots.has(slot)) {
          return record
        }
        const decrypted = resultFor(slot)
        const normalized =
          decrypted.status === 'unavailable' ||
          (decrypted.status === 'failed' && !decrypted.plaintext)
            ? record
            : normalizeSshPtyConsumerRecovery({ ...record, ownerLease: decrypted.plaintext })
        if (!normalized) {
          protectedSecrets.removeRetainedBlob(slot)
        }
        return normalized
      })
      .filter((record): record is SshPtyConsumerRecovery => record !== null)
  }
  return needsSave
}
