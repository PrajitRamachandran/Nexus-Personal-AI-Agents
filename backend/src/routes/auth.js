import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { db } from '../db/index.js'
import { config } from '../config.js'

const router = Router()
const SALT_ROUNDS = 12

console.log("AUTH ROUTES FILE LOADED");

// REGISTER
router.post('/register', async (req, res, next) => {
  try {
    console.log("REGISTER ROUTE HIT")

    const { username, email, password } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const existingUser = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email)

    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' })
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS)

    const result = db.prepare(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
    ).run(username, email, hash)

    const token = jwt.sign(
      { userId: result.lastInsertRowid, username },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    res.status(201).json({ token, username })

  } catch (err) {
    next(err)
  }
})


// LOGIN
router.post('/login', async (req, res, next) => {
  try {
    console.log("LOGIN ROUTE HIT")

    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email)

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const match = await bcrypt.compare(password, user.password)

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    res.json({ token, username: user.username })

  } catch (err) {
    next(err)
  }
})

export default router