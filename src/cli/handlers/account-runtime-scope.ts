import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'

/**
 * Rejects the runtime-selector flags instead of ignoring them. shouldIgnoreRemoteSelection
 * pins account commands to the local runtime, so honoring `--environment homelab`
 * silently would target the laptop rather than the host the user named — the exact
 * mistake this feature exists to avoid. A `--help` note does not reach someone who
 * already typed the flag.
 */
export function rejectRemoteSelectionFlags(ctx: HandlerContext, command: string): void {
  for (const flag of ['environment', 'pairing-code']) {
    if (ctx.flags.has(flag)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `\`--${flag}\` does not retarget \`${command}\`. Run it on the host whose accounts you want to manage.`
      )
    }
  }
}
