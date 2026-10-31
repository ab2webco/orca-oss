import { RuntimeClient } from '../runtime-client'

/** A client for the paired host a remote member runs on, named as the lead launched it there. */
export async function openHostRuntimeClient(host: string): Promise<RuntimeClient> {
  return new RuntimeClient(undefined, undefined, null, host)
}
