// A static server for dist/ under the site's base path, shared by the screenshot and motion checks.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE } from '../site.config.mjs'

export const SITE_DIR = fileURLToPath(new URL('../', import.meta.url))
export const DIST = path.join(SITE_DIR, 'dist')

const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}

/** Resolves to { origin, close } once the server listens on a free local port. */
export function serveDist() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    process.stderr.write('dist/ is missing; run `pnpm build` first\n')
    process.exit(1)
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${BASE}/`)) {
      res.writeHead(404).end()
      return
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname.slice(BASE.length)))
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = path.join(file, 'index.html')
    }
    if (!existsSync(file)) {
      res.writeHead(404).end()
      return
    }
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
    const size = statSync(file).size
    // Why ranges: GitHub Pages serves them, and a video element loops and seeks through them.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
        return
      }
      res.writeHead(206, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`
      })
      createReadStream(file, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}${BASE}`,
        close: () => server.close()
      })
    )
  )
}
