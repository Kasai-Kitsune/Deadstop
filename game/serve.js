// serve.js — tiny static server for the no-build game. ES modules need a real
// HTTP origin with a correct text/javascript MIME type; file:// won't do it.
// Usage: bun run serve [port]  (default 4173). python3 -m http.server works too.

import { stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

const PORT = Number(process.argv[2] || process.env.PORT || 4173)
const ROOT = resolve(import.meta.dir)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', // M3b: weapon viewmodel assets
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    let path = decodeURIComponent(url.pathname)
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT + sep)) return new Response('forbidden', { status: 403 })

    let info
    try {
      info = await stat(file)
    } catch {
      return new Response('not found', { status: 404 })
    }
    if (info.isDirectory()) return new Response('not found', { status: 404 })

    const ext = file.slice(file.lastIndexOf('.'))
    return new Response(Bun.file(file), {
      headers: {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store', // tuning loop: always fresh while editing
      },
    })
  },
})

console.log(`fps range (M1 movement + M2 range) → http://localhost:${PORT}/`)
