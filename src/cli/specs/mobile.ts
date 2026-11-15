import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const MOBILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mobile', 'pair'],
    summary: 'Mint a phone pairing link for this Orca Lab or a paired host',
    usage:
      'orca mobile pair [--environment <host>] [--connection relay|lan] [--address <ip>] [--rotate] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'connection', 'address', 'rotate'],
    examples: [
      'orca mobile pair',
      'orca mobile pair --connection lan --address 100.64.1.20',
      'orca mobile pair --environment m1 --connection lan --address 10.0.2.2 --json'
    ],
    notes: [
      'Mirrors Settings > Mobile on the machine being paired: that machine mints the link and advertises its own address.',
      '--environment mints on a paired host; without it the link pairs with this machine.',
      '--connection is the Connection method. relay (the default) is Orca Relay and needs Orca sign-in on that host; when Relay cannot mint, the error names its failure code. lan pairs over --address alone.',
      '--address is the address the phone dials, the UI’s address of this computer. lan requires it; without one the command lists the host’s addresses. An Android emulator reaches the machine it runs on at 10.0.2.2.',
      '--rotate revokes a pending, never-scanned link and mints a fresh one; otherwise repeated calls reuse it.',
      '--json returns pairingUrl, endpoint, deviceId, connection, host and qrText. The link is a credential: do not paste it into PRs, tickets or chats.'
    ]
  }
]
