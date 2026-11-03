import starlight from '@astrojs/starlight'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import { BASE, SITE } from './site.config.mjs'
import { docsSidebar } from './src/data/docs-sidebar.mjs'
import { starlightPaletteCss } from './src/data/scene-palette.ts'

export default defineConfig({
  // Why: without a pinned tsconfig Vite walks up to the repo root's, whose chain needs
  // the app's devDependencies; CI installs only site/'s.
  vite: { tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)) },
  site: SITE,
  base: BASE,
  integrations: [
    starlight({
      title: 'Orca Lab',
      description:
        'Run a team of coding agents, each in its own worktree, on every machine you own, and see who needs you.',
      logo: { src: './src/assets/icon.png', alt: 'Orca Lab' },
      favicon: '/icon.png',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ab2webco/orca-oss' }],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' }
      },
      head: [{ tag: 'style', content: starlightPaletteCss }],
      customCss: ['./src/styles/fonts.css', './src/styles/starlight-theme.css'],
      sidebar: docsSidebar
    })
  ]
})
