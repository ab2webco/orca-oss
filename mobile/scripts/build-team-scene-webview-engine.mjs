// Builds the Team sheet's scene WebView: the desktop's scene painters and director
// (mobile/src/team-drawer/team-scene-engine.ts) plus Orca's Quest art, so the phone draws the
// stage the desktop panel draws instead of a phone-only copy.
import { realpathSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'

const scriptDir = import.meta.dirname
const mobileRoot = path.resolve(scriptDir, '..')
const mobileRealRoot = realpathSync(mobileRoot)
const questArt = path.resolve(mobileRoot, '..', 'src', 'renderer', 'src', 'assets', 'quest-art')
const outputPath = path.join(
  mobileRoot,
  'src',
  'team-drawer',
  'team-scene-webview-engine.generated.ts'
)
const target = 'chrome74'

const ENTRY = `
  import { createTeamSceneEngine } from './src/team-drawer/team-scene-engine'
  import { createTeamSceneDioramaEngine } from './src/team-drawer/team-scene-diorama-engine'
  import { installTeamSceneShims } from './src/team-drawer/team-scene-webview-shims'

  installTeamSceneShims()
  const canvas = document.getElementById('stage')
  const post = (event) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(event))
  const decode = async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    return typeof createImageBitmap === 'function' ? createImageBitmap(image) : image
  }
  const engine = createTeamSceneEngine({
    canvas,
    overlay: document.getElementById('overlay'),
    names: document.getElementById('names'),
    width: () => canvas.clientWidth,
    ratio: () => window.devicePixelRatio || 1,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    scheduler: {
      request: (cb) => window.requestAnimationFrame(cb),
      cancel: (id) => window.cancelAnimationFrame(id)
    },
    decode,
    post
  })
  // Figures' diorama and the 3D Office take the stage where the host asks for them and WebGL opens;
  // every other stage, and a page with no 3D canvas, stays with the 2D engine.
  const canvas3d = document.getElementById('stage3d')
  const diorama = canvas3d && createTeamSceneDioramaEngine({
    canvas: canvas3d,
    width: () => canvas.clientWidth || window.innerWidth,
    dark: () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    scheduler: { request: (cb) => window.requestAnimationFrame(cb), cancel: (id) => window.cancelAnimationFrame(id) },
    post
  })
  let threeD = false, lastInput = null, lastMotion = null
  const show = (on) => {
    threeD = on
    canvas3d.style.display = on ? 'block' : 'none'
    for (const id of ['stage', 'overlay', 'names']) document.getElementById(id).style.display = on ? 'none' : ''
  }
  const route = async (message) => {
    // Why first: only a 3D stage has a camera, and the 2D engine reads any other kind as a stage.
    if (message.kind === 'camera') return threeD && diorama.camera(message)
    if (!diorama) return engine.receive(message)
    if (message.kind === 'stage') {
      show(diorama.take(message.stage))
      if (threeD) {
        await engine.receive({ kind: 'motion', run: false, reduced: true })
        return lastInput && diorama.input(lastInput.input, lastInput.machines, lastInput.floors)
      }
      for (const one of [message, lastMotion, lastInput]) if (one) await engine.receive(one)
      return
    }
    if (message.kind === 'input') lastInput = message
    if (message.kind === 'motion') { lastMotion = message; diorama.motion(message.run, message.reduced) }
    if (!threeD) return engine.receive(message)
    if (message.kind === 'input') diorama.input(message.input, message.machines, message.floors)
  }
  window.__teamScene = (message) => {
    route(message).catch((error) => post({ kind: 'error', message: String(error) }))
  }
  window.addEventListener('error', (event) => post({ kind: 'error', message: String(event.message) }))
  post({ kind: 'loaded' })
`

const outsideMobile = (dir) => {
  const relative = path.relative(mobileRealRoot, dir)
  return relative.startsWith('..') || path.isAbsolute(relative)
}

// Why: a desktop file's packages (zod) would resolve from the repo-root node_modules, which the
// release jobs never install; resolve them from mobile's own, so every install builds the same.
const mobilePackages = {
  name: 'mobile-packages',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) =>
      outsideMobile(args.resolveDir)
        ? build.resolve(args.path, { kind: args.kind, resolveDir: mobileRoot })
        : undefined
    )
  }
}

async function buildEngineJs() {
  const result = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: mobileRoot, sourcefile: 'team-scene-engine-entry.js' },
    plugins: [mobilePackages],
    bundle: true,
    format: 'iife',
    minify: true,
    platform: 'browser',
    target,
    legalComments: 'none',
    write: false,
    logLevel: 'silent'
  })
  return result.outputFiles[0].text
}

// Why data URLs: the WebView loads from an inline page with no file access, on both platforms.
async function questImages(style) {
  const files = (await readdir(path.join(questArt, style))).filter((one) => one.endsWith('.png'))
  const entries = await Promise.all(
    files.sort().map(async (file) => {
      const bytes = await readFile(path.join(questArt, style, file))
      return [`${style}/${file}`, `data:image/png;base64,${bytes.toString('base64')}`]
    })
  )
  return Object.fromEntries(entries)
}

async function main() {
  const [engineJs, figures, office] = await Promise.all([
    buildEngineJs(),
    questImages('figures'),
    questImages('office')
  ])
  // A literal </script> inside the bundle would close the inline script tag it is embedded in.
  const inlineSafeJs = engineJs.replace(/<\/script/gi, '<\\/script')
  const source = [
    '// Generated by scripts/build-team-scene-webview-engine.mjs.',
    '// Do not edit by hand; regenerate via pnpm postinstall.',
    `export const TEAM_SCENE_ENGINE_JS = ${JSON.stringify(inlineSafeJs)}`,
    `export const TEAM_SCENE_QUEST_IMAGES: Record<'figures' | 'office', Record<string, string>> = ${JSON.stringify({ figures, office })}`,
    ''
  ].join('\n')
  await writeFile(outputPath, source)
}

await main()
