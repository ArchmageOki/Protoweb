import { Router } from 'express'
import { nanoid } from 'nanoid'
import multer from 'multer'
import fs from 'fs'
import path from 'path'

// ---- Config subida PDF consentimiento ----
const CONSENTS_DIR = process.env.CONSENTS_DIR || path.resolve(process.cwd(), 'consents')
try { fs.mkdirSync(CONSENTS_DIR, { recursive: true }) } catch(_e){}
const consentStorage = multer.diskStorage({
  destination: (_req,_file,cb)=> cb(null, CONSENTS_DIR),
  filename: (req,file,cb)=> cb(null, `${req.user.id}-consentimiento_generico.pdf`)
})
const uploadConsent = multer({
  storage: consentStorage,
  fileFilter: (_req,file,cb)=> {
    if(file.mimetype === 'application/pdf') return cb(null,true)
    cb(new Error('invalid_mime'))
  },
  limits: { fileSize: 5*1024*1024 }
})
import { requireAuth } from './middleware/auth.js'
import { 
  pgCreateClient, pgListClients, pgGetClient, pgUpdateClient, pgDeleteClient,
  pgCreateEvent, pgListEvents, pgGetEvent, pgUpdateEvent, pgDeleteEvent, pgCompleteEvent,
  pgGetWhatsappSession, pgUpsertWhatsappSession,
  pgInsertWhatsappMessage, pgListWhatsappMessages,
  pgGetUserSettings, pgUpsertUserSettings,
  pgListCompletedEventsForClient,
  pgRecalcClientCompletedStats,
  pgOutboxInsert, pgOutboxListPending, pgOutboxCancel, pgOutboxGet,
  pgCreateClientCompletionToken
} from './db/pg.js'
import { buildAuthUrl, exchangeCode, upsertAccount, getAccount, applySync, createRemoteEvent, patchRemoteEvent, deleteRemoteEvent, validateAndConsumeState, createOauthState, listCalendars, setCalendar } from './integrations/googleCalendar.js'
import { pool } from './db/pg.js'
import { pgAttachGoogleEvent, pgUpdateGoogleEtag } from './db/pg.js'

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
  if(body.is_vip != null) body.is_vip = !!body.is_vip
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

// Histórico de citas completadas por cliente
r.get('/clients/:id/appointments/completed', async (req,res)=>{
  const client = await pgGetClient(req.user.id, req.params.id)
  if(!client) return res.status(404).json({ error:'not_found' })
  const { limit } = req.query
  let lim = parseInt(limit,10); if(isNaN(lim) || lim<=0) lim=200
  try {
    const items = await pgListCompletedEventsForClient(req.user.id, req.params.id, lim)
    res.json({ ok:true, items })
  } catch(e){
    console.error('[clients][history] error', e.message)
    res.status(500).json({ error:'history_failed' })
  }
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
  if(body.is_vip != null) body.is_vip = !!body.is_vip
  try {
    const row = await pgUpdateClient(req.user.id, req.params.id, body)
    if(!row) return res.status(404).json({ error:'not_found' })
    res.json({ ok:true, item: row })
  } catch(e){
    let msg='update_failed', field=null
    if(e.code==='23505'){
      if(e.detail && e.detail.includes('mobile')){ msg='duplicate_mobile'; field='mobile' }
      else if(e.detail && e.detail.includes('dni')){ msg='duplicate_dni'; field='dni' }
    }
    res.status(400).json({ error: msg, field })
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
  const { title, description=null, start_at, end_at, all_day=false, client_id=null, completed_design=false, extra_check_1=false, extra_check_2=false, extra_check_3=false, total_amount=null, paid_amount=null, notes=null, is_completed=false } = req.body||{}
  if(typeof title !== 'string' || !title.trim()) return res.status(400).json({ error:'invalid_input' })
  if(!start_at || !end_at) return res.status(400).json({ error:'invalid_input' })
  const s = new Date(start_at); const e = new Date(end_at)
  if(isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error:'invalid_range' })
  // Cliente obligatorio
  if(!client_id || typeof client_id !== 'string' || !client_id.trim()) return res.status(400).json({ error:'client_required' })
  // Validar importes
  let tAmt = total_amount
  let pAmt = paid_amount
  if(tAmt!==null && tAmt!==undefined && tAmt!==''){ tAmt = Number(tAmt); if(!isFinite(tAmt) || tAmt < 0) return res.status(400).json({ error:'invalid_total_amount' }) }
  else tAmt = null
  if(pAmt!==null && pAmt!==undefined && pAmt!==''){ pAmt = Number(pAmt); if(!isFinite(pAmt) || pAmt < 0) return res.status(400).json({ error:'invalid_paid_amount' }) }
  else pAmt = null
  if(tAmt!=null && pAmt!=null && pAmt > tAmt) return res.status(400).json({ error:'paid_gt_total' })
  let finalClientId = null
  let clientNeedsCompletion = false
  let completionToken = null
  if(client_id){
    const c = await pgGetClient(req.user.id, client_id)
    if(!c) return res.status(400).json({ error:'invalid_client' })
    finalClientId = c.id
    // Comprobar campos faltantes (excepto instagram opcional, mobile obligatorio ya existe)
    const missing = []
    const isEmpty = v => v === null || v === undefined || (typeof v === 'string' && !v.trim())
    if(isEmpty(c.first_name)) missing.push('first_name')
    if(isEmpty(c.last_name)) missing.push('last_name')
    if(isEmpty(c.mobile)) missing.push('mobile') // debería existir siempre
    if(isEmpty(c.dni)) missing.push('dni')
    if(isEmpty(c.address)) missing.push('address')
    if(isEmpty(c.postal_code)) missing.push('postal_code')
    if(isEmpty(c.birth_date)) missing.push('birth_date')
    console.log('[client-completion] Evaluación cliente', c.id, 'missing=', missing)
    if(missing.length>0){
      clientNeedsCompletion = true
      const tokenId = nanoid()
      await pgCreateClientCompletionToken(tokenId, req.user.id, c.id)
      completionToken = tokenId
      const base = process.env.PUBLIC_APP_ORIGIN || 'http://localhost:5173'
      const urlDatos = `${base}/completar-datos.html?token=${tokenId}`
      const urlConsent = `${base}/consentimiento-whatsapp.html?token=${tokenId}`
      console.log('[client-completion] URL completar-datos:', urlDatos)
      console.log('[client-completion] URL consentimiento:', urlConsent)
    }
  }
  const row = await pgCreateEvent(nanoid(), req.user.id, { title: title.trim(), description, start_at: s.toISOString(), end_at: e.toISOString(), all_day: !!all_day, client_id: finalClientId, completed_design: !!completed_design, extra_check_1: !!extra_check_1, extra_check_2: !!extra_check_2, extra_check_3: !!extra_check_3, total_amount: tAmt, paid_amount: pAmt, notes, is_completed: !!is_completed })
  // Si hay cuenta Google, crear también remoto (async best-effort)
  getAccount(req.user.id).then(acc=>{
    if(acc){
      createRemoteEvent(req.user.id, row).then(googleEv=>{
        pgAttachGoogleEvent(req.user.id, row.id, googleEv.id, googleEv.etag||null).catch(e=>console.error('[google][attach] fallo', e.message))
      }).catch(err=> console.error('[google][create] fallo', err.message))
    }
  })
  res.status(201).json({ ok:true, item: row, client_completion: clientNeedsCompletion ? { token: completionToken, completar_url: `${process.env.PUBLIC_APP_ORIGIN||'http://localhost:5173'}/completar-datos.html?token=${completionToken}`, consentimiento_url: `${process.env.PUBLIC_APP_ORIGIN||'http://localhost:5173'}/consentimiento-whatsapp.html?token=${completionToken}` } : null })
})

r.get('/events/:id', async (req,res)=>{
  const row = await pgGetEvent(req.user.id, req.params.id)
  if(!row) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true, item: row })
})

r.put('/events/:id', async (req,res)=>{
  const { title, description=null, start_at, end_at, all_day=false, client_id=null, completed_design=false, extra_check_1=false, extra_check_2=false, extra_check_3=false, total_amount=null, paid_amount=null, notes=null, is_completed=false } = req.body||{}
  if(typeof title !== 'string' || !title.trim()) return res.status(400).json({ error:'invalid_input' })
  if(!start_at || !end_at) return res.status(400).json({ error:'invalid_input' })
  const s = new Date(start_at); const e = new Date(end_at)
  if(isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error:'invalid_range' })
  // Cliente obligatorio
  if(!client_id || typeof client_id !== 'string' || !client_id.trim()) return res.status(400).json({ error:'client_required' })
  // Validar importes
  let tAmt = total_amount
  let pAmt = paid_amount
  if(tAmt!==null && tAmt!==undefined && tAmt!==''){ tAmt = Number(tAmt); if(!isFinite(tAmt) || tAmt < 0) return res.status(400).json({ error:'invalid_total_amount' }) } else tAmt = null
  if(pAmt!==null && pAmt!==undefined && pAmt!==''){ pAmt = Number(pAmt); if(!isFinite(pAmt) || pAmt < 0) return res.status(400).json({ error:'invalid_paid_amount' }) } else pAmt = null
  if(tAmt!=null && pAmt!=null && pAmt > tAmt) return res.status(400).json({ error:'paid_gt_total' })
  let finalClientId = null
  if(client_id){
    const c = await pgGetClient(req.user.id, client_id)
    if(!c) return res.status(400).json({ error:'invalid_client' })
    finalClientId = c.id
  }
  const row = await pgUpdateEvent(req.user.id, req.params.id, { title: title.trim(), description, start_at: s.toISOString(), end_at: e.toISOString(), all_day: !!all_day, client_id: finalClientId, completed_design: !!completed_design, extra_check_1: !!extra_check_1, extra_check_2: !!extra_check_2, extra_check_3: !!extra_check_3, total_amount: tAmt, paid_amount: pAmt, notes, is_completed: !!is_completed })
  if(!row) return res.status(404).json({ error:'not_found' })
  getAccount(req.user.id).then(acc=>{
    if(acc && row.google_event_id){
      patchRemoteEvent(req.user.id, row.google_event_id, row).then(googleEv=>{
        if(googleEv.etag) pgUpdateGoogleEtag(req.user.id, row.id, googleEv.etag).catch(e=>console.error('[google][etag] fallo', e.message))
      }).catch(err=> console.error('[google][patch] fallo', err.message))
    }
  })
  res.json({ ok:true, item: row })
})

// Marcar evento como completado (idempotente). Incrementa visits_count del cliente asociado una sola vez.
r.post('/events/:id/complete', async (req,res)=>{
  try {
    const ev = await pgGetEvent(req.user.id, req.params.id)
    if(!ev) return res.status(404).json({ error:'not_found' })
    if(ev.is_completed){ return res.json({ ok:true, item: ev, already:true }) }
    const updated = await pgCompleteEvent(req.user.id, req.params.id)
    if(!updated) return res.status(400).json({ error:'cannot_complete' })
    if(updated.client_id){
      try { await pgRecalcClientCompletedStats(req.user.id, updated.client_id) } catch(e){ console.error('[events][complete][recalc]', e.message) }
    }
    res.json({ ok:true, item: updated })
  } catch(e){
    console.error('[events][complete] error', e.message)
    res.status(500).json({ error:'complete_failed' })
  }
})

r.delete('/events/:id', async (req,res)=>{
  console.log('[events][delete] intento', req.params.id, 'user', req.user.id)
  const existing = await pgGetEvent(req.user.id, req.params.id)
  if(!existing) return res.status(404).json({ error:'not_found' })
  // Intentar borrar remoto primero (best-effort)
  if(existing.google_event_id){
    getAccount(req.user.id).then(acc=>{ if(acc){ deleteRemoteEvent(req.user.id, existing.google_event_id).catch(err=> console.error('[google][delete] fallo', err.message)) } })
  }
  const ok = await pgDeleteEvent(req.user.id, req.params.id)
  console.log('[events][delete] resultado', ok)
  if(!ok) return res.status(404).json({ error:'not_found' })
  // Si era un evento finalizado, recalcular estadísticas del cliente (visitas, total, last_appointment_at, completed_event_ids)
  if(existing.is_completed && existing.client_id){
    try { await pgRecalcClientCompletedStats(req.user.id, existing.client_id) } catch(e){ console.error('[events][delete][recalc]', e.message) }
  }
  res.json({ ok:true })
})

// ---- GOOGLE CALENDAR AUTH ----
r.get('/integrations/google/status', async (req,res)=>{
  const acc = await getAccount(req.user.id)
  if(acc && typeof acc.calendar_id === 'string' && !acc.calendar_id.trim()){
    // Normalizar valores vacíos a null si quedaron así por migraciones
    try { await pool.query('update google_calendar_accounts set calendar_id=null where user_id=$1 and (calendar_id=$2 or calendar_id=\'\')', [req.user.id, acc.calendar_id]) } catch(_e){}
    acc.calendar_id = null
  }
  const pending = acc ? (acc.calendar_id == null) : false
  res.json({ ok:true, connected: !!acc, account: acc ? { calendar_id: acc.calendar_id, expiry: acc.expiry, last_sync_at: acc.last_sync_at, scope: acc.scope, pending, needs_reauth: !!acc.needs_reauth } : null })
})

r.get('/integrations/google/authurl', (req,res)=>{
  try {
    const { scope='events', pkce_challenge } = req.query||{}
    const state = createOauthState(req.user.id)
    const url = buildAuthUrl(state, { scope, codeChallenge: pkce_challenge })
    res.json({ ok:true, url, state })
  } catch(e){ res.status(400).json({ error:'authurl_failed' }) }
})

r.post('/integrations/google/callback', async (req,res)=>{
  const { code, state, code_verifier, calendar_id=null } = req.body||{}
  if(!code) return res.status(400).json({ error:'missing_code' })
  if(!validateAndConsumeState(req.user.id, state)) return res.status(400).json({ error:'invalid_state' })
  try {
  const data = await exchangeCode(code, { code_verifier })
  // Guardar cuenta con calendar_id null (placeholder) hasta que el usuario elija
  await upsertAccount(req.user.id, { ...data, calendar_id: calendar_id || null })
  res.json({ ok:true, pendingCalendarSelect: true })
  } catch(e){ res.status(400).json({ error:'oauth_failed' }) }
})

// Callback alternativo vía GET (si se prefiere redirigir directamente desde Google)
r.get('/integrations/google/callback', async (req,res)=>{
  const { code, state } = req.query||{}
  if(!code) return res.status(400).send('missing_code')
  if(!validateAndConsumeState(req.user.id, state)) return res.status(400).send('invalid_state')
  try {
  const data = await exchangeCode(code)
  await upsertAccount(req.user.id, { ...data, calendar_id: null })
  res.redirect('/calendario.html?google_auth=1')
  } catch(e){ res.status(400).send('oauth_failed') }
})

r.post('/integrations/google/sync', async (req,res)=>{
  try {
    await applySync(req.user.id)
    res.json({ ok:true })
  } catch(e){
  console.error('[google][sync] fallo', e.message)
  res.status(400).json({ error:'sync_failed', code: e.message })
  }
})

// Desconectar y eliminar cuenta Google
r.delete('/integrations/google/account', async (req,res)=>{
  try {
    // Eliminar cuenta
    await pool.query('delete from google_calendar_accounts where user_id=$1', [req.user.id])
    // Borrar eventos locales (requisito: eliminarlos de la DB, permanecen en Google)
    await pool.query('delete from calendar_events where user_id=$1', [req.user.id])
    res.json({ ok:true, deletedLocal:true })
  } catch(e){
    console.error('[google][disconnect] fallo', e.message)
    res.status(400).json({ error:'disconnect_failed' })
  }
})

// Listar calendarios disponibles (requiere cuenta conectada)
r.get('/integrations/google/calendars', async (req,res)=>{
  try {
    const items = await listCalendars(req.user.id)
    res.json({ ok:true, items })
  } catch(e){
    const code = e.status || 400
    if(e.message==='insufficient_scope'){
      return res.status(400).json({ error:'insufficient_scope', detail:'El token no incluye permisos para listar calendarios. Reautoriza añadiendo calendar.readonly.', status: code })
    }
    res.status(400).json({ error:'calendar_list_failed', detail: e.body?.slice?.(0,300) || e.message, status: code })
  }
})

// Seleccionar calendario activo
r.post('/integrations/google/calendar', async (req,res)=>{
  const { calendar_id } = req.body||{}
  if(!calendar_id) return res.status(400).json({ error:'missing_calendar_id' })
  try {
    const acc = await setCalendar(req.user.id, calendar_id)
    res.json({ ok:true, account:{ calendar_id: acc.calendar_id } })
  } catch(e){ res.status(400).json({ error:'set_calendar_failed' }) }
})

// ---- WHATSAPP SESSION ----
r.get('/whatsapp/session', async (req,res)=>{
  const sess = await pgGetWhatsappSession(req.user.id)
  res.json({ ok:true, session: sess || null })
})

// Proxies al microservicio de whatsapp (si está corriendo en localhost:4001)
import fetch from 'node-fetch'
// Auto-spawn opcional del microservicio de WhatsApp si no está levantado.
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
const WHATSAPP_SERVICE_BASE = process.env.WHATSAPP_SERVICE_BASE || 'http://localhost:4001'
let waProcess = null
let waProcessStarting = false
let waNextSpawnAttempt = 0
async function ensureWhatsappServiceSpawn(){
  // Desactivado explícitamente
  if(process.env.WHATSAPP_AUTO_SPAWN === 'false') return
  // En producción sólo si se autoriza
  if(process.env.NODE_ENV === 'production' && process.env.WHATSAPP_AUTO_SPAWN !== 'true') return
  // Ya hay proceso controlado
  if(waProcess || waProcessStarting) return
  // Backoff
  if(Date.now() < waNextSpawnAttempt) return
  // Comprobar si el servicio ya está arriba externamente
  try {
    const ctrl = new AbortController()
    const t = setTimeout(()=>ctrl.abort(), 1500)
    const r = await fetch(WHATSAPP_SERVICE_BASE + '/health', { signal: ctrl.signal })
    clearTimeout(t)
    if(r.ok){
      // Servicio ya disponible; no spawnear
      return
    }
  } catch(_ignored){ /* ignorar y continuar con spawn */ }
  waProcessStarting = true
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const repoRoot = path.resolve(__dirname, '../../..')
    const waDir = path.join(repoRoot, 'services', 'whatsapp')
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    waProcess = spawn(cmd, ['run','dev'], { cwd: waDir, stdio:'inherit', env: process.env })
    waProcess.on('exit', (code,signal)=>{ waProcess=null; console.log('[whatsapp][autospawn] proceso terminado', code, signal) })
    console.log('[whatsapp][autospawn] lanzado en', waDir)
  } catch(e){ 
    console.error('[whatsapp][autospawn] fallo al lanzar', e.code || '', e.message)
    // Backoff si falla
    waNextSpawnAttempt = Date.now() + 10000
  }
  finally { waProcessStarting = false }
}
// ---- WHATSAPP PROXIES ----
r.get('/whatsapp/status', async (req,res)=>{
  try {
  // Asegurar que el microservicio esté arrancado
  await ensureWhatsappServiceSpawn()
    const r2 = await fetch(WHATSAPP_SERVICE_BASE + '/whatsapp/status', { 
      headers:{ 'Authorization':'Bearer '+req.accessToken } 
    })
    const j = await r2.json().catch(()=>({}))
    // Completar con phone_number almacenado si falta
    try {
      if(!j.phone_number && !j.phoneNumber){
        const sess = await pgGetWhatsappSession(req.user.id)
        if(sess?.phone_number) j.phone_number = sess.phone_number
        else if(sess?.session_json){
          // Heurística para extraer número del session_json almacenado
          try {
            const sj = sess.session_json
            let raw = sj?.me?.id || sj?.me?.wid || sj?.wid || sj?.user?.id || null
            if(raw && typeof raw === 'string'){
              const at = raw.indexOf('@'); if(at>0) raw = raw.slice(0, at)
              let digits = raw.replace(/[^0-9]/g,'')
              if(digits.length >= 9){
                if(!digits.startsWith('34') && digits.length===9) digits = '34'+digits
                j.phone_number = '+'+digits
              }
            }
          } catch(_e) { /* silencioso */ }
        }
      }
    } catch(_e){}
    res.status(r2.status).json(j)
  } catch(e){ 
    res.status(200).json({ status:'UNAVAILABLE', error:'service_down' }) 
  }
})

r.post('/whatsapp/start', async (req,res)=>{
  try {
  await ensureWhatsappServiceSpawn()
    const r2 = await fetch(WHATSAPP_SERVICE_BASE + '/whatsapp/start', { 
      method:'POST', 
      headers:{ 'Authorization':'Bearer '+req.accessToken } 
    })
    const j = await r2.json().catch(()=>({}))
    res.status(r2.status).json(j)
  } catch(e){
    res.status(502).json({ error:'whatsapp_service_unreachable' })
  }
})

r.post('/whatsapp/reset', async (req,res)=>{
  try {
  await ensureWhatsappServiceSpawn()
    const r2 = await fetch(WHATSAPP_SERVICE_BASE + '/whatsapp/reset', { 
      method:'POST', 
      headers:{ 'Authorization':'Bearer '+req.accessToken } 
    })
    const j = await r2.json().catch(()=>({}))
    res.status(r2.status).json(j)
  } catch(e){ 
    res.status(502).json({ error:'whatsapp_service_unreachable' }) 
  }
})

r.post('/whatsapp/send', async (req,res)=>{
  try {
  await ensureWhatsappServiceSpawn()
    const r2 = await fetch(WHATSAPP_SERVICE_BASE + '/whatsapp/send', { 
      method:'POST', 
      headers:{ 'Authorization':'Bearer '+req.accessToken, 'Content-Type':'application/json' }, 
      body: JSON.stringify(req.body||{}) 
    })
    const j = await r2.json().catch(()=>({}))
    res.status(r2.status).json(j)
  } catch(e){ 
    res.status(502).json({ error:'whatsapp_service_unreachable' }) 
  }
})

r.put('/whatsapp/session', async (req,res)=>{
  let { phone_number=null, status='inactive', session_json=null } = req.body||{}
  // Normalizar status a minúsculas
  if(typeof status === 'string') status = status.toLowerCase()
  if(status && !['inactive','connecting','ready','error'].includes(status)) return res.status(400).json({ error:'invalid_status' })
  // Intentar derivar phone_number si no viene explícito
  if(!phone_number && session_json){
    try {
      const sj = session_json
      let raw = sj?.me?.id || sj?.me?.wid || sj?.wid || sj?.user?.id || null
      if(raw && typeof raw === 'string'){
        const at = raw.indexOf('@'); if(at>0) raw = raw.slice(0, at)
        let digits = raw.replace(/[^0-9]/g,'')
        if(digits.length >= 9){
          if(!digits.startsWith('34') && digits.length===9) digits = '34'+digits
          phone_number = '+'+digits
        }
      }
    } catch(_e){ /* ignorar */ }
  }
  const saved = await pgUpsertWhatsappSession(req.user.id, { phone_number, status, session_json })
  res.json({ ok:true, session: saved })
})

// ---- WHATSAPP MESSAGES ----
// Listado paginado del historial (por ahora sólo mensajes salientes registrados)
r.get('/whatsapp/messages', async (req,res)=>{
  let { limit='50', page='1' } = req.query
  const allowedSizes = [10,25,50,100,200]
  let size = parseInt(limit,10); if(isNaN(size) || !allowedSizes.includes(size)) size = 50
  let p = parseInt(page,10); if(isNaN(p) || p<1) p=1
  const offset = (p-1)*size
  try {
    const { items, total } = await pgListWhatsappMessages(req.user.id, { limit:size, offset })
    const hasMore = (p*size) < total
    res.json({ ok:true, items, page:p, limit:size, has_more: hasMore, total })
  } catch(e){
    console.error('[whatsapp][messages][list] error', e.message)
    res.status(500).json({ error:'list_failed' })
  }
})

// ---- WHATSAPP OUTBOX (cola programada) ----
r.get('/whatsapp/outbox', async (req,res)=>{
  try {
    const rows = await pgOutboxListPending(req.user.id)
    res.json({ ok:true, items: rows })
  } catch(e){
    console.error('[whatsapp][outbox][list] error', e.message)
    res.status(500).json({ error:'list_failed' })
  }
})
r.post('/whatsapp/outbox', async (req,res)=>{
  const { client_id=null, phone, client_name=null, instagram=null, message_text, scheduled_at } = req.body||{}
  if(!phone || typeof phone !== 'string') return res.status(400).json({ error:'invalid_phone' })
  if(!message_text || typeof message_text !== 'string') return res.status(400).json({ error:'invalid_message' })
  let sched = scheduled_at ? new Date(scheduled_at) : null
  if(!sched || isNaN(sched)) return res.status(400).json({ error:'invalid_scheduled_at' })
  try {
    const row = await pgOutboxInsert(nanoid(), req.user.id, { client_id, phone: phone.replace(/[^0-9+]/g,''), client_name, instagram, message_text: message_text.slice(0,5000), scheduled_at: sched.toISOString() })
    res.status(201).json({ ok:true, item: row })
  } catch(e){
    console.error('[whatsapp][outbox][create] error', e.message)
    res.status(500).json({ error:'create_failed' })
  }
})
r.post('/whatsapp/outbox/:id/cancel', async (req,res)=>{
  try {
    const row = await pgOutboxCancel(req.params.id, req.user.id)
    if(!row) return res.status(404).json({ error:'not_found_or_not_cancellable' })
    res.json({ ok:true, item: row })
  } catch(e){
    res.status(500).json({ error:'cancel_failed' })
  }
})
r.get('/whatsapp/outbox/:id', async (req,res)=>{
  const row = await pgOutboxGet(req.params.id, req.user.id)
  if(!row) return res.status(404).json({ error:'not_found' })
  res.json({ ok:true, item: row })
})

// Historial de mensajes para la interfaz (alias a /whatsapp/messages)
r.get('/whatsapp/history', async (req,res)=>{
  try {
    const { items } = await pgListWhatsappMessages(req.user.id, { limit: 100, offset: 0 })
    res.json({ ok: true, messages: items })
  } catch(e){
    console.error('[whatsapp][history] error', e.message)
    res.status(500).json({ error:'list_failed' })
  }
})

// Endpoint provisional para registrar un mensaje enviado (se usará al implementar envío real)
r.post('/whatsapp/messages', async (req,res)=>{
  const { client_id=null, calendar_event_id=null, phone, client_name=null, instagram=null, message_text, message_id=null, status='sent', direction='outgoing', sent_at=null } = req.body||{}
  if(!phone || typeof phone !== 'string') return res.status(400).json({ error:'invalid_phone' })
  if(!message_text || typeof message_text !== 'string') return res.status(400).json({ error:'invalid_message' })
  const trimmed = message_text.slice(0,5000)
  try {
    const row = await pgInsertWhatsappMessage(nanoid(), req.user.id, { client_id, calendar_event_id, phone: phone.replace(/[^0-9+]/g,''), client_name, instagram, message_text: trimmed, message_id, status, direction, sent_at })
    res.status(201).json({ ok:true, item: row })
  } catch(e){
    console.error('[whatsapp][messages][create] error', e.message)
    res.status(500).json({ error:'create_failed' })
  }
})

// ---- USER SETTINGS ----
r.get('/settings', async (req,res)=>{
  const row = await pgGetUserSettings(req.user.id)
  if(!row) return res.json({ ok:true, settings: { extra_checks:{}, clientes:{}, auto_title_config:{}, auto_title_enabled:true, business_needs_consent:false } })
  const consent_fixed_elements = Array.isArray(row.consent_fixed_elements) ? row.consent_fixed_elements : []
  const consent_signature_rect = (row.consent_signature_rect && typeof row.consent_signature_rect==='object' && !Array.isArray(row.consent_signature_rect)) ? row.consent_signature_rect : {}
  res.json({ ok:true, settings: {
    extra_checks: row.extra_checks || {},
    clientes: row.clientes || {},
    auto_title_config: row.auto_title_config || {},
    auto_title_enabled: typeof row.auto_title_enabled === 'boolean' ? row.auto_title_enabled : true,
    business_needs_consent: !!row.business_needs_consent,
    consent_pdf_info: row.consent_pdf_info || {},
  consent_field_map: row.consent_field_map || {},
    consent_fixed_elements,
    consent_signature: row.consent_signature || null,
    consent_signature_rect
  } })
})
r.put('/settings', async (req,res)=>{
  const body = req.body||{}
  try {
    const existing = await pgGetUserSettings(req.user.id)
    const extra_checks = body.hasOwnProperty('extra_checks') ? (body.extra_checks||{}) : (existing?.extra_checks || {})
    const clientes = body.hasOwnProperty('clientes') ? (body.clientes||{}) : (existing?.clientes || {})
    const auto_title_config = body.hasOwnProperty('auto_title_config') ? (body.auto_title_config||{}) : (existing?.auto_title_config || {})
    const auto_title_enabled = body.hasOwnProperty('auto_title_enabled') ? !!body.auto_title_enabled : (typeof existing?.auto_title_enabled === 'boolean' ? existing.auto_title_enabled : true)
    const business_needs_consent = body.hasOwnProperty('business_needs_consent') ? !!body.business_needs_consent : (existing?.business_needs_consent || false)
    const consent_pdf_info = body.hasOwnProperty('consent_pdf_info') ? (body.consent_pdf_info||{}) : (existing?.consent_pdf_info || {})
    const consent_field_map = body.hasOwnProperty('consent_field_map') ? (body.consent_field_map||{}) : (existing?.consent_field_map || {})
    let consent_fixed_elements_raw = body.hasOwnProperty('consent_fixed_elements') ? (body.consent_fixed_elements??[]) : (existing?.consent_fixed_elements || [])
    // Si llega como string intentar parsear
    if(typeof consent_fixed_elements_raw === 'string'){
      try { const parsed = JSON.parse(consent_fixed_elements_raw); if(Array.isArray(parsed)) consent_fixed_elements_raw = parsed } catch(_e) { consent_fixed_elements_raw = [] }
    }
    // Si llega como objeto {id:{...}} convertir a array
    if(!Array.isArray(consent_fixed_elements_raw) && consent_fixed_elements_raw && typeof consent_fixed_elements_raw==='object'){
      consent_fixed_elements_raw = Object.values(consent_fixed_elements_raw)
    }
    // Parsear elementos que sean string individual
    if(Array.isArray(consent_fixed_elements_raw)){
      consent_fixed_elements_raw = consent_fixed_elements_raw.map(el=>{
        if(typeof el === 'string'){
          try { const p = JSON.parse(el); return p } catch(_e){ return null }
        }
        return el
      }).filter(Boolean)
    }
    const consent_signature = body.hasOwnProperty('consent_signature') ? (body.consent_signature||null) : (existing?.consent_signature || null)
    const consent_signature_rect_raw = body.hasOwnProperty('consent_signature_rect') ? (body.consent_signature_rect||{}) : (existing?.consent_signature_rect || {})
  const consent_fixed_elements = Array.isArray(consent_fixed_elements_raw) ? consent_fixed_elements_raw.filter(el=> el && typeof el==='object').map(el=>({
      id: typeof el.id==='string'? el.id : ('f_'+Math.random().toString(36).slice(2,8)),
      text: typeof el.text==='string'? el.text.slice(0,500):'',
      x: (typeof el.x==='number' && isFinite(el.x))? el.x : null,
      y: (typeof el.y==='number' && isFinite(el.y))? el.y : null,
      fontSize: (typeof el.fontSize==='number' && isFinite(el.fontSize))? el.fontSize : 12
  ,page: 1
    })) : []
  // Log de depuración (se puede quitar después)
  // Log eliminado: fixed_elements_sanitized_count
    let consent_signature_rect = (consent_signature_rect_raw && typeof consent_signature_rect_raw==='object' && !Array.isArray(consent_signature_rect_raw))? { ...consent_signature_rect_raw }: {}
    if(consent_signature_rect.x!=null){
      ['x','y','w','h','ratio'].forEach(k=>{ if(typeof consent_signature_rect[k] !== 'number' || !isFinite(consent_signature_rect[k])) delete consent_signature_rect[k] })
      consent_signature_rect.page=1
    }
    const saved = await pgUpsertUserSettings(req.user.id, { extra_checks, clientes, auto_title_config, auto_title_enabled, business_needs_consent, consent_pdf_info, consent_field_map, consent_fixed_elements, consent_signature, consent_signature_rect })
    res.json({ ok:true, settings: {
      extra_checks: saved.extra_checks,
      clientes: saved.clientes,
      auto_title_config: saved.auto_title_config,
      auto_title_enabled: saved.auto_title_enabled,
      business_needs_consent: saved.business_needs_consent,
      consent_pdf_info: saved.consent_pdf_info || {},
      consent_field_map: saved.consent_field_map || {},
      consent_fixed_elements: Array.isArray(saved.consent_fixed_elements)? saved.consent_fixed_elements: [],
      consent_signature: saved.consent_signature || null,
      consent_signature_rect: (saved.consent_signature_rect && typeof saved.consent_signature_rect==='object' && !Array.isArray(saved.consent_signature_rect)) ? saved.consent_signature_rect : {}
    } })
  } catch(e){
    console.error('[settings][put] error', e)
    res.status(400).json({ error:'save_failed' })
  }
})

// Subir plantilla PDF consentimiento
r.post('/settings/consent-pdf', uploadConsent.single('file'), async (req,res)=>{
  try {
    if(!req.file) return res.status(400).json({ error:'missing_file' })
    const stat = fs.statSync(req.file.path)
    const existing = await pgGetUserSettings(req.user.id)
    const consent_pdf_info = { filename: path.basename(req.file.filename), size: stat.size, mime: req.file.mimetype, uploaded_at: new Date().toISOString() }
    const consent_field_map = existing?.consent_field_map || {}
    const extra_checks = existing?.extra_checks || {}
    const clientes = existing?.clientes || {}
    const auto_title_config = existing?.auto_title_config || {}
    const auto_title_enabled = typeof existing?.auto_title_enabled === 'boolean' ? existing.auto_title_enabled : true
    const business_needs_consent = !!existing?.business_needs_consent
    const saved = await pgUpsertUserSettings(req.user.id, { extra_checks, clientes, auto_title_config, auto_title_enabled, business_needs_consent, consent_pdf_info, consent_field_map })
    res.json({ ok:true, consent_pdf_info: saved.consent_pdf_info })
  } catch(e){
    console.error('[settings][consent-pdf][upload] error', e.message)
    res.status(400).json({ error:'upload_failed', detail: e.message })
  }
})
// Descargar plantilla PDF (si existe)
r.get('/settings/consent-pdf', async (req,res)=>{
  try {
    const existing = await pgGetUserSettings(req.user.id)
    const fname = existing?.consent_pdf_info?.filename
    if(!fname) return res.status(404).json({ error:'not_found' })
    const full = path.join(CONSENTS_DIR, fname)
    if(!fs.existsSync(full)) return res.status(404).json({ error:'not_found' })
    res.setHeader('Content-Type','application/pdf')
    res.sendFile(full)
  } catch(e){ res.status(400).json({ error:'fetch_failed' }) }
})

export default r
