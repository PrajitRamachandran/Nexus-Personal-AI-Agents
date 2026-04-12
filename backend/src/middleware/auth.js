import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' })
  }

  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, config.jwtSecret)

req.user = {
  id: decoded.userId,
  username: decoded.username
}
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}