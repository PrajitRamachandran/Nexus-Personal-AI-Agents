import { db } from '../db/index.js'
import { config } from '../config.js'

const ACTIVE_MODEL_KEY = 'active_ollama_model'

let activeModelCache = null

function normalizeModelName(model) {
  return String(model || '').trim()
}

function isLikelyEmbeddingModel(model) {
  const name = normalizeModelName(model.name).toLowerCase()
  const family = String(model.details?.family || '').toLowerCase()
  const families = Array.isArray(model.details?.families)
    ? model.details.families.map(item => String(item).toLowerCase())
    : []

  return (
    name.includes('embed') ||
    name.includes('embedding') ||
    name.includes('nomic-embed') ||
    name.includes('all-minilm') ||
    name.includes('bge-') ||
    name.includes('e5-') ||
    name.includes('snowflake-arctic-embed') ||
    family.includes('bert') ||
    families.some(item => item.includes('bert'))
  )
}

export function getActiveModel() {
  if (activeModelCache) return activeModelCache

  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(ACTIVE_MODEL_KEY)
    activeModelCache = normalizeModelName(row?.value) || config.ollamaModel
  } catch {
    activeModelCache = config.ollamaModel
  }

  return activeModelCache
}

export function setActiveModel(model) {
  const normalized = normalizeModelName(model)
  if (!normalized) {
    throw new Error('Model name is required')
  }

  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(ACTIVE_MODEL_KEY, normalized)

  activeModelCache = normalized
  return normalized
}

export async function listLocalLlmModels() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`, {
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`Ollama model list failed with status ${res.status}`)
    }

    const data = await res.json()
    const models = Array.isArray(data.models) ? data.models : []

    return models
      .filter(model => model?.name && !isLikelyEmbeddingModel(model))
      .map(model => ({
        name: model.name,
        modified_at: model.modified_at ?? null,
        size: model.size ?? null,
        digest: model.digest ?? null,
        details: model.details ? {
          family: model.details.family ?? null,
          parameter_size: model.details.parameter_size ?? null,
          quantization_level: model.details.quantization_level ?? null,
        } : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timed out while loading local Ollama models')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export function selectAvailableActiveModel(models) {
  const activeModel = getActiveModel()
  const hasActive = models.some(model => model.name === activeModel)

  if (hasActive || models.length === 0) {
    return activeModel
  }

  const configured = models.find(model => model.name === config.ollamaModel)
  const fallback = configured?.name ?? models[0].name
  return setActiveModel(fallback)
}
