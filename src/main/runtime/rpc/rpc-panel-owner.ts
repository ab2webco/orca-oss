/**
 * Panel-session owner identity for RPC transports. Dependency-free on purpose:
 * the socket layer imports it, and importing the plugins RPC module from there
 * reorders main's chunk initialization and crashes the app at load.
 */

let revokeOwner: ((ownerKey: string) => void) | null = null

export function rpcPanelOwnerKey(connectionId?: string, clientId?: string): string {
  // Why: the bearer session must not cross paired-client connections even
  // when two sockets authenticate as the same device.
  return `runtime:${connectionId ?? clientId ?? 'local'}`
}

export function setRpcPanelOwnerRevoker(revoke: ((ownerKey: string) => void) | null): void {
  revokeOwner = revoke
}

/** Called when a socket closes. Why: the per-request signal a panel owner is
 *  bound to is disposed once its request settles, so it never fires on close. */
export function revokeRpcPanelOwnerForConnection(connectionId: string): void {
  revokeOwner?.(rpcPanelOwnerKey(connectionId))
}
