import {
  OFFICIAL_MARKETPLACE_OWNER,
  OFFICIAL_PLUGIN_ORG,
  isOfficialMarketplaceGitSource,
  isOfficialOrganizationGitSource,
  isReservedPluginIdentity
} from '../../shared/plugins/plugin-marketplace'
import type { PluginMarketplaceFetchResult } from './plugin-marketplace-fetch'
import type { PluginMarketplaceRegisteredSource } from './plugin-marketplace-store'

export function validateMarketplaceProvenance(
  source: PluginMarketplaceRegisteredSource,
  fetched: PluginMarketplaceFetchResult
): void {
  if (
    isOfficialMarketplaceGitSource(source.source.url) &&
    fetched.marketplace.owner.toLowerCase() !== OFFICIAL_MARKETPLACE_OWNER
  ) {
    throw new Error('official marketplace metadata has an unexpected owner')
  }
  for (const entry of fetched.marketplace.plugins) {
    if (isReservedPluginIdentity(entry.id) && !isOfficialOrganizationGitSource(entry.source.url)) {
      throw new Error(
        `reserved plugin identity ${entry.id} must resolve to the ${OFFICIAL_PLUGIN_ORG} organization`
      )
    }
  }
}
