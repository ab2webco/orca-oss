import { isOrchestrationMutation } from '../../../shared/orchestration-rpc-contract'
import type { RpcRequest } from './core'

/** Federation control and durable mutations are the only calls whose identity must be pinned locally. */
export function resolveAuthenticatedCallerFingerprint(
  request: RpcRequest,
  params: unknown,
  provided: string | undefined,
  resolveLocal: () => string
): string | undefined {
  if (provided !== undefined) {
    return provided
  }
  const needsLocalIdentity =
    request.method.startsWith('orchestration.federation') ||
    (!!request.orchestrationRequestId && isOrchestrationMutation(request.method, params))
  return needsLocalIdentity ? resolveLocal() : undefined
}
