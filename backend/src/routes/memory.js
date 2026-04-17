import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getAllMemory, deleteMemory, saveMemory } from '../services/memoryService.js'

const router = Router()

// GET /api/memory — list all long-term memories for current user
router.get('/', requireAuth, (req, res, next) => {
  try {
    const memories = getAllMemory(req.user.id)
    res.json({ memories })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/memory/:id — delete a specific memory (user-scoped)
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const deleted = deleteMemory(Number(req.params.id), req.user.id)
    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' })
    }
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/memory — manually add a memory
router.post('/', requireAuth, (req, res, next) => {
  try {
    const { content, context, category } = req.body
    if (!content) {
      return res.status(400).json({ error: 'content is required' })
    }
    saveMemory(req.user.id, [{
      content,
      context: context ?? '',
      category: category ?? 'personal',
    }])
    res.status(201).json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
