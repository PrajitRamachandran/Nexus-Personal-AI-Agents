import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './src/config.js'
import './src/db/schema.js'
import authRoutes from './src/routes/auth.js'
import chatRoutes from './src/routes/chat.js'
import logsRoutes from './src/routes/logs.js'
import conversationRoutes from './src/routes/conversations.js'
import { fileURLToPath } from 'url'
import path from 'path'
import { existsSync } from 'fs'
import { errorHandler } from './src/middleware/error.js'

console.log("🔥 BACKEND SERVER RUNNING")

const app = express()

// paths
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendPath = path.join(__dirname, '../frontend')

// DEBUG (remove later)
console.log('Frontend path:', frontendPath)
console.log('Index exists:', existsSync(path.join(frontendPath, 'index.html')))

// 1. Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: [
        "'self'",
        "http://localhost:11434",
        "http://192.168.1.5:11434"
      ],
      "upgrade-insecure-requests": null,
    },
  },
  originAgentCluster: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
}))

// 2. CORS
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    return callback(null, true)
  },
  credentials: true,
}))

// 3. Body parser
app.use(express.json({ limit: '2mb' }))

// 4. API routes
app.use('/api/auth', authRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/logs', logsRoutes)
app.use('/api/conversations', conversationRoutes)

// 4.5 Unknown API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

// 5. Health
app.get('/health', (_, res) => res.json({ status: 'ok' }))

// 6. FRONTEND
if (existsSync(frontendPath)) {

  // 🔥 FORCE root FIRST (before static)
  app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'))
  })

  // then static
  app.use(express.static(frontendPath))

  // 🔥 catch-all (important for SPA behavior)
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'))
  })

  console.log('Serving frontend correctly')
}

// 7. Error handler
app.use(errorHandler)

// 8. Start server
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Backend running on port ${config.port}`)
})