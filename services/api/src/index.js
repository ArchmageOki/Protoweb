import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import authRoutes, { authMetrics } from './auth/routes.js'
import { startRefreshCleanup, pool } from './db/pg.js'
import { applySync } from './integrations/googleCalendar.js'
import { requireAuth } from './middleware/auth.js'
import dataRoutes from './routes-data.js'
import { pgGetClient, pgUpdateClient, pgCreateClientCompletionToken, pgGetClientCompletionToken, pgMarkClientCompletionTokenUsed } from './db/pg.js'
import { startOutboxWorker } from './whatsapp-outbox-worker.js'

const app = express()
// CORS
// 1) Endpoints públicos con token (no requieren cookies ni auth) => permitir cualquier origen
app.use('/public/client-completion', cors({ origin: true }))
// 2) Rutas protegidas: lista blanca de orígenes conocidos de SPA
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173'
])
// Permitir origen LAN actual si se pasa DEV_LAN_HOST (ej: 192.168.1.100)
if(process.env.DEV_LAN_HOST){
  allowedOrigins.add(`http://${process.env.DEV_LAN_HOST}:5173`)
}
const protectedCors = cors({
  origin: (origin, cb) => {
    if(!origin) return cb(null, true)
    if(allowedOrigins.has(origin) || /^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin)) return cb(null, true)
    return cb(new Error('CORS not allowed'))
  },
  credentials: true
})
app.use(['/auth','/data','/whatsapp','/integrations','/metrics','/health','/me'], protectedCors)
// Fallback: cualquier otra ruta (no pública) que se añada en el futuro también tendrá CORS si empieza por estas bases
app.use((req,res,next)=>{
  if(req.path.startsWith('/auth')||req.path.startsWith('/data')||req.path.startsWith('/whatsapp')||req.path.startsWith('/integrations')||req.path.startsWith('/metrics')||req.path.startsWith('/health')||req.path==='/me'){
    return protectedCors(req,res,next)
  }
  next()
})
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req,res)=> res.json({ ok:true, service:'api', ts:Date.now() }))

app.use('/auth', authRoutes)
app.use('/data', dataRoutes)

// ---- Rutas públicas para completar datos cliente (token) ----
function tokenExpired(t){
  if(!t) return true
  const created = new Date(t.created_at)
  if(isNaN(created)) return true
  const now = Date.now()
  const sevenDays = 7*24*60*60*1000
  return (now - created.getTime()) > sevenDays
}
app.get('/public/client-completion/:token', async (req,res)=>{
  try {
    const t = await pgGetClientCompletionToken(req.params.token)
    if(!t || t.used || tokenExpired(t)) return res.status(404).json({ error:'invalid_token' })
    const client = await pgGetClient(t.user_id, t.client_id)
    if(!client) return res.status(404).json({ error:'client_not_found' })
    const { first_name,last_name,mobile,dni,address,postal_code,birth_date,instagram } = client
    res.json({ ok:true, client:{ first_name,last_name,mobile,dni,address,postal_code,birth_date,instagram }, token: t.id, expires_at: new Date(new Date(t.created_at).getTime()+7*24*60*60*1000).toISOString() })
  } catch(e){ res.status(400).json({ error:'fetch_failed' }) }
})
// Actualiza datos (no consume token todavía)
app.post('/public/client-completion/:token', async (req,res)=>{
  try {
    const t = await pgGetClientCompletionToken(req.params.token)
    if(!t || t.used || tokenExpired(t)) return res.status(404).json({ error:'invalid_token' })
    const { first_name, last_name, mobile, dni, address, postal_code, birth_date, instagram } = req.body||{}
    const required = { first_name, last_name, mobile, dni, address, postal_code, birth_date }
    for(const [k,v] of Object.entries(required)){
      if(typeof v !== 'string' || !v.trim()) return res.status(400).json({ error:'missing_field', field: k })
    }
    const updated = await pgUpdateClient(t.user_id, t.client_id, { first_name:first_name.trim(), last_name:last_name.trim(), mobile: mobile.trim(), dni:dni.trim(), address:address.trim(), postal_code:postal_code.trim(), birth_date: birth_date, instagram: instagram || null })
    res.json({ ok:true, client_id: updated.id })
  } catch(e){
    console.error('[public][client-completion][save] error', e.message)
    res.status(400).json({ error:'save_failed' })
  }
})
// Finaliza consentimiento: marca whatsapp_consent y consume token
app.post('/public/client-completion/:token/consent', async (req,res)=>{
  try {
    const t = await pgGetClientCompletionToken(req.params.token)
    if(!t || t.used || tokenExpired(t)) return res.status(404).json({ error:'invalid_token' })
    const { whatsapp_consent=false } = req.body||{}
    const client = await pgGetClient(t.user_id, t.client_id)
    if(!client) return res.status(404).json({ error:'client_not_found' })
    await pgUpdateClient(t.user_id, t.client_id, { whatsapp_consent: !!whatsapp_consent })
    await pgMarkClientCompletionTokenUsed(t.id)
    res.json({ ok:true })
  } catch(e){
    console.error('[public][client-completion][consent] error', e.message)
    res.status(400).json({ error:'consent_failed' })
  }
})

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
  startOutboxWorker()
  // Scheduler simple para sincronizar cuentas Google cada 5 minutos
  const interval = +(process.env.GOOGLE_SYNC_INTERVAL_MS || 5*60*1000)
  // Refresco proactivo al arrancar: actualizar tokens caducados ya
  ;(async ()=>{
    try {
      await pool.query('alter table google_calendar_accounts add column if not exists needs_reauth boolean not null default false')
      const { rows } = await pool.query('select user_id, expiry, needs_reauth from google_calendar_accounts')
      for(const r of rows){
        if(r.needs_reauth) continue
        if(!r.expiry || Date.now() > Date.parse(r.expiry)){
          // Forzar refresh inmediato
          try { await pool.query('select 1') /* noop */ } catch(_e){}
        }
      }
    } catch(e){ console.error('[google][startup-refresh] error', e.message) }
  })()
  setInterval(async ()=>{
    try {
      const { rows } = await pool.query('select user_id, needs_reauth from google_calendar_accounts')
      for(const r of rows){
        if(r.needs_reauth) continue
        applySync(r.user_id).catch(e=>console.error('[google][sync] fallo user', r.user_id, e.message))
      }
    } catch(e){ console.error('[google][sync] scheduler error', e.message) }
  }, interval)
})
