import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import authRoutes, { authMetrics } from './auth/routes.js'
import { startRefreshCleanup } from './db/pg.js'
import { requireAuth } from './middleware/auth.js'
import dataRoutes from './routes-data.js'

const app = express()
// CORS dinámico: permite localhost y rangos 192.168.x.x:5173 (desarrollo LAN)
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173'
])
app.use(cors({
  origin: (origin, cb) => {
    if(!origin) return cb(null, true) // peticiones same-origin o curl
    if(allowedOrigins.has(origin) || /^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin)) return cb(null, true)
    return cb(new Error('CORS not allowed'))
  },
  credentials: true
}))
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req,res)=> res.json({ ok:true, service:'api', ts:Date.now() }))

app.use('/auth', authRoutes)
app.use('/data', dataRoutes)

// Ruta protegida de ejemplo
app.get('/me', requireAuth, (req,res)=> {
  res.json({ ok:true, user: req.user })
})

// Métricas muy simples (texto)
app.get('/metrics', (_req,res)=>{
  res.type('text/plain').send(
    Object.entries(authMetrics).map(([k,v])=>`auth_${k} ${v}`).join('\n') + '\n'
  )
})

// 404
app.use((req,res)=> res.status(404).json({ error:'not_found' }))

const PORT = process.env.PORT || 4002
app.listen(PORT, ()=> {
  console.log('[api] escuchando en', PORT)
  startRefreshCleanup()
})
