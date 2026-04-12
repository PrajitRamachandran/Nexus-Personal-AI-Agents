import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './src/config.js'
import './src/db/schema.js'
import authRoutes from './src/routes/auth.js'
import chatRoutes from './src/routes/chat.js'
import logsRoutes from './src/routes/logs.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { errorHandler } from './src/middleware/error.js'
import conversationRoutes from './src/routes/conversations.js'

const app = express()

// paths
const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendPath = join(__dirname, '../frontend')

// 1. Security (Helmet)
app.use(helmet({
  contentSecurityPolicy: {
    // This app is served over plain HTTP in local/LAN setups, so keep
    // Helmet from auto-upgrading requests to HTTPS on IP-based origins.
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
    // Allow backend-served pages, file:// pages, LAN IPs, and local dev ports.
    if (!origin) return callback(null, true)
    return callback(null, true)
  },
  credentials: true,
}))

// 3. Body parser
app.use(express.json({ limit: '2mb' }))

// 4. Routes
app.use('/api/auth', authRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/logs', logsRoutes)
app.use('/api/conversations', conversationRoutes)

// 4.5 Catch unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

// 5. Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }))

// 6. Static frontend
if (existsSync(frontendPath)) {
  app.use(express.static(frontendPath))
  console.log('Serving frontend from /frontend')
}

// 7. Error handler (must be last middleware)
app.use(errorHandler)

// 8. Start server
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Backend running on port ${config.port}`)
})
