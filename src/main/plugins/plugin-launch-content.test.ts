import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isOfficialOrganizationGitSource,
  isOfficialPluginIdentity,
  pluginMarketplaceSchema
} from '../../shared/plugins/plugin-marketplace'
import { bootstrapBundledPlugins, resolveBundledPluginRoot } from './plugin-bundled-bootstrap'
import { hashPluginTree } from './plugin-content-hash'
import { inspectPluginInstallTree } from './plugin-install-staging'

const launchRoot = join(process.cwd(), 'resources', 'plugins', 'launch')
const temporaryRoots: string[] = []

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('Phase 1 launch plugin content', () => {
  it('lists and validates the launch plugin packs', async () => {
    const marketplace = pluginMarketplaceSchema.parse(
      await readJson(join(launchRoot, 'orca-marketplace.json'))
    )
    expect(marketplace.plugins.map((plugin) => plugin.id).sort()).toEqual([
      'stablyai.orca-multipass-recipes',
      'stablyai.orca-navigation-shortcuts',
      'stablyai.orca-portuguese'
    ])
    // These packs are upstream's, not Ab2Web's: they keep shipping as installable
    // content but none of them is official here, so none carries the badge.
    expect(
      marketplace.plugins.filter(
        (plugin) =>
          isOfficialPluginIdentity(plugin.id) || isOfficialOrganizationGitSource(plugin.source.url)
      )
    ).toEqual([])

    const localPluginDirectories = (await readdir(launchRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(marketplace.plugins.map((plugin) => plugin.id).sort()).toEqual(localPluginDirectories)

    const contributionKinds = new Set<string>()
    for (const listing of marketplace.plugins) {
      const inspection = await inspectPluginInstallTree({
        rootDir: join(launchRoot, listing.id),
        hostVersion: '1.4.0',
        expectedPluginKey: listing.id
      })
      expect(inspection, `${listing.id} must pass the production install inspection`).toMatchObject(
        {
          ok: true
        }
      )
      if (!inspection.ok) {
        continue
      }
      const contributes = inspection.manifest.contributes
      if (contributes.languagePacks.length > 0) {
        contributionKinds.add('language')
      }
      if (contributes.vmRecipes.length > 0) {
        contributionKinds.add('vm-recipe')
      }
      if (contributes.commands.length > 0 && contributes.keybindings.length > 0) {
        contributionKinds.add('command-keybinding')
      }
    }
    expect(contributionKinds).toEqual(new Set(['language', 'vm-recipe', 'command-keybinding']))
  })

  it('auto-installs nothing, because the bundled index ships empty', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'orca-launch-content-'))
    temporaryRoots.push(userDataPath)

    const index = JSON.parse(
      await readFile(join(launchRoot, 'bundled-plugins.json'), 'utf8')
    ) as unknown
    expect(index).toEqual({ version: 1, plugins: [] })

    await expect(
      bootstrapBundledPlugins({ root: launchRoot, userDataPath, hostVersion: '1.4.0' })
    ).resolves.toEqual({ installed: [], unchanged: [], errors: [] })
  })

  // The shipped index is empty, so a packaged bootstrap of it proves only that
  // nothing installs. Index one official pack over the packaged copy so the
  // resources layout, the hash gate, and the `ab2web.orca-*` identity gate all
  // still get exercised on the path a release actually takes.
  it('boots release-indexed content from the packaged resources layout', async () => {
    const resourcesPath = await mkdtemp(join(tmpdir(), 'orca-packaged-resources-'))
    const userDataPath = await mkdtemp(join(tmpdir(), 'orca-packaged-user-data-'))
    temporaryRoots.push(resourcesPath, userDataPath)
    const packagedRoot = join(resourcesPath, 'plugins', 'launch')
    await cp(launchRoot, packagedRoot, { recursive: true })
    const pluginKey = 'ab2web.orca-launch-probe'
    const pluginRoot = join(packagedRoot, pluginKey)
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(
      join(pluginRoot, 'orca-plugin.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'orca-launch-probe',
        publisher: 'ab2web',
        name: 'Launch Probe',
        version: '1.0.0',
        engines: { orca: '>=1.0.0' },
        pluginApi: 1,
        capabilities: []
      })
    )
    const hashed = await hashPluginTree(pluginRoot)
    expect(hashed).toMatchObject({ ok: true })
    if (!hashed.ok) {
      return
    }
    await writeFile(
      join(packagedRoot, 'bundled-plugins.json'),
      JSON.stringify({
        version: 1,
        plugins: [{ pluginKey, path: pluginKey, contentHash: hashed.hash }]
      })
    )

    const result = await bootstrapBundledPlugins({
      root: resolveBundledPluginRoot({
        isPackaged: true,
        resourcesPath,
        appPath: join(resourcesPath, 'app.asar')
      }),
      userDataPath,
      hostVersion: '1.4.0'
    })

    expect(result).toEqual({ installed: [pluginKey], unchanged: [], errors: [] })
  })
})
