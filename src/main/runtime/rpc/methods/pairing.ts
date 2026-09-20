import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'
import {
  PairingGetEndpointsParamsSchema,
  PairingProvisionRelayParamsSchema
} from '../../../../shared/mobile-relay-credential-contract'
import { getPairingNetworkInterfaces } from '../../pairing-network-interfaces'

const PairingCreateMobileQrParamsSchema = z
  .object({
    address: z.string().min(1).optional(),
    connectionMode: z.enum(['automatic', 'local-only']).optional(),
    rotate: z.boolean().optional()
  })
  .optional()

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
    // Why the host mints it instead of the caller: the QR carries the address of the machine the
    // phone pairs with, and on a headless server — or in the web client — that machine is not the
    // one drawing the wizard. A client-built QR would advertise the browser's own host and fail in
    // a way the user cannot diagnose.
    //
    // Why it is not in MOBILE_RPC_METHOD_ALLOWLIST: a paired phone must never mint credentials for
    // another device. Only runtime-scoped clients reach it.
    name: 'pairing.createMobileQr',
    params: PairingCreateMobileQrParamsSchema,
    handler: async (params, ctx) => {
      if (!ctx.mobilePairingQr) {
        throw new Error('pairing_context_unavailable')
      }
      return await ctx.mobilePairingQr(params ?? {})
    }
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
