import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  listLocalLlmModels,
  selectAvailableActiveModel,
  setActiveModel,
} from '../services/modelService.js'

const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const models = await listLocalLlmModels()
    const activeModel = selectAvailableActiveModel(models)
    res.json({ activeModel, models })
  } catch (err) {
    next(err)
  }
})

router.post('/active', requireAuth, async (req, res, next) => {
  try {
    const requestedModel = String(req.body?.model || '').trim()

    if (!requestedModel) {
      return res.status(400).json({ error: 'model is required' })
    }

    const models = await listLocalLlmModels()
    const exists = models.some(model => model.name === requestedModel)

    if (!exists) {
      return res.status(400).json({ error: 'Model is not pulled locally' })
    }

    const activeModel = setActiveModel(requestedModel)
    res.json({ activeModel, models })
  } catch (err) {
    next(err)
  }
})

export default router
