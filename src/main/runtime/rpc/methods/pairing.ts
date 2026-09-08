import { defineMethod, type RpcAnyMethod } from '../core'
import {
  PairingGetEndpointsParamsSchema,
  PairingProvisionRelayParamsSchema
} from '../../../../shared/mobile-relay-credential-contract'
import { getPairingNetworkInterfaces } from '../../pairing-network-interfaces'

export const PAIRING_METHODS: readonly RpcAnyMethod[] = [
  defineMethod({
    // Why a remote client may ask for these: the pairing wizard has to show the
    // addresses of the machine that will be paired, and on a headless server
    // that machine is not the one running the UI. Without this the picker on a
    // web client or a remote-scoped desktop shows "No interfaces found" and the
    // wizard dead-ends, even though the pairing itself works end to end.
    //
    // Why it carries no host secret: these are the same addresses any peer on
    // the network already sees, and the caller is a paired client of this very
    // runtime. It reads nothing from disk and takes no caller-supplied path.
    name: 'pairing.listNetworkInterfaces',
    params: null,
    handler: async () => ({ interfaces: await getPairingNetworkInterfaces() })
  }),
  defineMethod({
    name: 'pairing.getEndpoints',
    params: PairingGetEndpointsParamsSchema,
    handler: async (params, ctx) => {
      if (!ctx.pairing) {
        throw new Error('pairing_context_unavailable')
      }
      return await ctx.pairing.getEndpoints(params)
    }
  }),
  defineMethod({
    name: 'pairing.provisionRelay',
    params: PairingProvisionRelayParamsSchema,
    handler: async (params, ctx) => {
      if (!ctx.pairing) {
        throw new Error('pairing_context_unavailable')
      }
      return await ctx.pairing.provisionRelay(params)
    }
  })
]
