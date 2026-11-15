import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const MOBILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mobile', 'pair'],
    summary: 'Mint a phone pairing link for this Orca Lab or a paired host',
    usage:
      'orca mobile pair [--environment <host>] [--address <addr>] [--local-only] [--rotate] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'address', 'local-only', 'rotate'],
    examples: [
      'orca mobile pair --address 100.64.1.20',
      'orca mobile pair --environment m1 --address 10.0.2.2 --local-only --json'
    ],
    notes: [
      'The machine that will be paired mints the link, the same way Settings > Mobile does, so it advertises that machine’s address.',
      '--environment mints on a paired host; without it the link pairs with this machine.',
      '--address picks the address the phone dials. An Android emulator reaches its own host at 10.0.2.2.',
      '--local-only pairs over that address alone. Without it the host also mints an Orca Relay invite, and refuses if Relay is unavailable.',
      '--rotate revokes a pending, never-scanned link and mints a fresh one; otherwise repeated calls reuse it.',
      '--json returns pairingUrl, endpoint, deviceId, connectionMode, host and qrText.'
    ]
  }
]
