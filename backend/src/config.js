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
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
  dbPath: resolveBackendPath(process.env.DB_PATH || './data/platform.db'),
}

if (!config.jwtSecret) {
  console.error('FATAL: JWT_SECRET is not set in .env')
  process.exit(1)
}
