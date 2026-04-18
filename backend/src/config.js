import dotenv from 'dotenv'
import { dirname, isAbsolute, resolve } from 'path'
import { fileURLToPath } from 'url'

const srcDir = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(srcDir, '..')

dotenv.config({ path: resolve(backendDir, '.env') })

function resolveBackendPath(filePath) {
  if (isAbsolute(filePath)) return filePath
  return resolve(backendDir, filePath)
}

export const config = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET,
  ollamaHost: 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
  // Dedicated embedding model — MUST be an embedding-capable model.
  // Pull with: ollama pull nomic-embed-text
  embedModel: process.env.EMBED_MODEL || 'nomic-embed-text',
  // Model used for auto-generating conversation titles (uses chat model by default — already loaded, zero extra latency).
  // Override with a lighter model via TITLE_MODEL env var if desired.
  titleModel: process.env.TITLE_MODEL || process.env.OLLAMA_MODEL || 'gemma3:4b',
  dbPath: resolveBackendPath(process.env.DB_PATH || './data/platform.db'),
  adminUsername: process.env.ADMIN_USERNAME || '',
}

if (!config.jwtSecret) {
  console.error('FATAL: JWT_SECRET is not set in .env')
  process.exit(1)
}
