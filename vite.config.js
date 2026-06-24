import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { mentorReply } from './server/mentor.js'
import { generateRoadmap } from './server/roadmap.js'

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => { d += c })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}

// Generic POST-only dev middleware plugin for server-side API handlers.
// In production, host each handler as a serverless function at the same path.
function apiPlugin(name, path, handler) {
  return {
    name,
    configureServer(server) {
      server.middlewares.use(path, async (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = {}
        try { body = JSON.parse((await readBody(req)) || '{}') } catch { body = {} }
        res.setHeader('Content-Type', 'application/json')
        try {
          const result = await handler(body)
          res.statusCode = 200
          res.end(JSON.stringify(result))
        } catch (err) {
          res.statusCode = err.status || 500
          res.end(JSON.stringify({ error: err.message, code: err.code || null }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix reads ALL vars from .env (incl. non-VITE_ secrets)
  // into this Node-side config only — they are not exposed to client code.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      apiPlugin('mentor-api', '/api/mentor', (body) => mentorReply(body, env)),
      apiPlugin('roadmap-api', '/api/roadmap', (body) => generateRoadmap(body, env)),
    ],
    server: { port: 5173, open: true },
  }
})
