// The Plane workspace switch's loading flag, kept pure/testable so the "must
// clear no matter how the switch settles" contract is a real assertion
// against the code the pane actually runs, not just a code-review claim.

export type PlaneWorkspaceSwitchArgs = {
  switchWorkspace: () => Promise<void>
  onFailure: () => void
  setLoading: (loading: boolean) => void
}

/**
 * Runs a Plane workspace switch and guarantees the loading flag clears
 * regardless of how the switch settles.
 *
 * Why this needs a `finally` and not just a `catch`: selectPlaneWorkspace
 * RESOLVES (does not reject) without touching planeStatus when its mutation
 * generation is superseded by a newer switch/connect/disconnect. A bare
 * `.catch()` only clears loading on the reject path, so that silent resolve
 * left `planeLoading` stuck true forever — no load-effect dependency changes
 * either, since planeStatus never moved (see ORCA-275).
 */
export async function runPlaneWorkspaceSwitch(args: PlaneWorkspaceSwitchArgs): Promise<void> {
  args.setLoading(true)
  try {
    await args.switchWorkspace()
  } catch {
    args.onFailure()
  } finally {
    args.setLoading(false)
  }
}
