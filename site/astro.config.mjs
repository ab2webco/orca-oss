import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { BASE, SITE } from './site.config.mjs'
import { docsSidebar } from './src/data/docs-sidebar.mjs'

export default defineConfig({
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
      customCss: ['./src/styles/fonts.css', './src/styles/starlight-theme.css'],
      sidebar: docsSidebar
    })
  ]
})
