import { test, expect } from './helpers/orca-app'

// Why only the single-profile case is left: upstream deleted the switcher's only
// render site (`SidebarToolbar.tsx` rendered `<OrcaProfileSwitcher placement="sidebar" />`
// before this sync; nothing renders it in upstream/main) while keeping the
// component, its unit test and this spec. The two cases that drove that UI
// asserted a surface that no longer exists anywhere, on upstream's own tree —
// they cannot be repaired without re-adding a product surface upstream removed.
// Restoring it is a fork product decision, not a test fix (ORCA-203).

test.describe('default single-profile mode', () => {
  // Why: no flag — the default build shows no account trigger on a local-only
  // (cloud-unconfigured) install.
  test.use({ launchEnv: {} })

  test('hides the account trigger when cloud is unconfigured', async ({ orcaPage }) => {
    await expect(orcaPage.getByRole('button', { name: /^Switch profile$/ })).toHaveCount(0)
    await expect(orcaPage.getByRole('button', { name: /^Account$/ })).toHaveCount(0)
  })
})
