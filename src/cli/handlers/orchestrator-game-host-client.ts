import { RuntimeClient } from '../runtime-client'

/** A client for one paired host's own runtime, by its environment id. */
export const hostClientOf = (environmentId: string): RuntimeClient =>
  new RuntimeClient(undefined, undefined, null, environmentId)
