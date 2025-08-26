import { Router } from 'express'
import { requireAuth } from './middleware/auth.js'
import { nanoid } from 'nanoid'
import { 
  pgCreateClient, pgListClients, pgGetClient, pgUpdateClient, pgDeleteClient,
  pgCreateEvent, pgListEvents, pgGetEvent, pgUpdateEvent, pgDeleteEvent,
  pgGetWhatsappSession, pgUpsertWhatsappSession
} from './db/pg.js'

const r = Router()

// Todas las rutas requieren auth
r.use(requireAuth)

// ---- CLIENTES ----
r.get('/clients', async (req,res)=>{
  const rows = await pgListClients(req.user.id)
  res.json({ ok:true, items: rows })
})

r.post('/clients', async (req,res)=>{
  const body = req.body||{}
  // Único dato obligatorio: móvil
  if(typeof body.mobile !== 'string' || !body.mobile.trim()) return res.status(400).json({ error:'mobile_required' })
  // Normalizar: quitar no dígitos
  const digits = body.mobile.replace(/[^0-9]/g,'')
  if(digits.length < 7 || digits.length > 15) return res.status(400).json({ error:'invalid_mobile' })
  body.mobile = digits
  try {
    const row = await pgCreateClient(nanoid(), req.user.id, body)
    res.status(201).json({ ok:true, item: row })
  } catch(e){
    let msg = 'create_failed', field = null
    if(e.code === '23505'){
      // Violación de restricción única
      if(e.detail && e.detail.includes('mobile')){ msg = 'duplicate_mobile'; field = 'mobile' }
      else if(e.detail && e.detail.includes('dni')){ msg = 'duplicate_dni'; field = 'dni' }
    }
    console.error('[clients][create] error', e.message, e.stack)
    res.status(400).json({ error: msg, field })
  }
})

r.get('/clients/:id', async (req,res)=>{
  const row = await pgGetClient(req.user.id, req.params.id)
  if(!row) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true, item: row })
})

r.put('/clients/:id', async (req,res)=>{
  const body = req.body||{}
  if(body.first_name && typeof body.first_name !== 'string') return res.status(400).json({ error:'invalid_input' })
  if(body.mobile){
    if(typeof body.mobile !== 'string' || !body.mobile.trim()) return res.status(400).json({ error:'invalid_mobile' })
    const digits = body.mobile.replace(/[^0-9]/g,'')
    if(digits.length < 7 || digits.length > 15) return res.status(400).json({ error:'invalid_mobile' })
    body.mobile = digits
  }
  try {
    const row = await pgUpdateClient(req.user.id, req.params.id, body)
    if(!row) return res.status(404).json({ error:'not_found' })
    res.json({ ok:true, item: row })
  } catch(e){
    res.status(500).json({ error:'update_failed' })
  }
})

r.delete('/clients/:id', async (req,res)=>{
  const ok = await pgDeleteClient(req.user.id, req.params.id)
  if(!ok) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true })
})

// ---- EVENTS ----
r.get('/events', async (req,res)=>{
  const { from=null, to=null } = req.query
  const list = await pgListEvents(req.user.id, from, to)
  res.json({ ok:true, items: list })
})

r.post('/events', async (req,res)=>{
  const { title, description=null, start_at, end_at, all_day=false } = req.body||{}
  if(typeof title !== 'string' || !title.trim()) return res.status(400).json({ error:'invalid_input' })
  if(!start_at || !end_at) return res.status(400).json({ error:'invalid_input' })
  const s = new Date(start_at); const e = new Date(end_at)
  if(isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error:'invalid_range' })
  const row = await pgCreateEvent(nanoid(), req.user.id, { title: title.trim(), description, start_at: s.toISOString(), end_at: e.toISOString(), all_day: !!all_day })
  res.status(201).json({ ok:true, item: row })
})

r.get('/events/:id', async (req,res)=>{
  const row = await pgGetEvent(req.user.id, req.params.id)
  if(!row) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true, item: row })
})

r.put('/events/:id', async (req,res)=>{
  const { title, description=null, start_at, end_at, all_day=false } = req.body||{}
  if(typeof title !== 'string' || !title.trim()) return res.status(400).json({ error:'invalid_input' })
  if(!start_at || !end_at) return res.status(400).json({ error:'invalid_input' })
  const s = new Date(start_at); const e = new Date(end_at)
  if(isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error:'invalid_range' })
  const row = await pgUpdateEvent(req.user.id, req.params.id, { title: title.trim(), description, start_at: s.toISOString(), end_at: e.toISOString(), all_day: !!all_day })
  if(!row) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true, item: row })
})

r.delete('/events/:id', async (req,res)=>{
  const ok = await pgDeleteEvent(req.user.id, req.params.id)
  if(!ok) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true })
})

// ---- WHATSAPP SESSION ----
r.get('/whatsapp/session', async (req,res)=>{
  const sess = await pgGetWhatsappSession(req.user.id)
  res.json({ ok:true, session: sess || null })
})

r.put('/whatsapp/session', async (req,res)=>{
  const { phone_number=null, status='inactive', session_json=null } = req.body||{}
  if(status && !['inactive','connecting','ready','error'].includes(status)) return res.status(400).json({ error:'invalid_status' })
  const saved = await pgUpsertWhatsappSession(req.user.id, { phone_number, status, session_json })
  res.json({ ok:true, session: saved })
})

export default r
