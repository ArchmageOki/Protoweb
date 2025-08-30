import { Router } from 'express'
import { requireAuth } from './middleware/auth.js'
import { nanoid } from 'nanoid'
import { 
  pgCreateClient, pgListClients, pgGetClient, pgUpdateClient, pgDeleteClient,
  pgCreateEvent, pgListEvents, pgGetEvent, pgUpdateEvent, pgDeleteEvent, pgCompleteEvent,
  pgGetWhatsappSession, pgUpsertWhatsappSession,
  pgGetUserSettings, pgUpsertUserSettings,
  pgListCompletedEventsForClient,
  pgRecalcClientCompletedStats
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
  if(client_id){
    const c = await pgGetClient(req.user.id, client_id)
    if(!c) return res.status(400).json({ error:'invalid_client' })
    finalClientId = c.id
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
  res.status(201).json({ ok:true, item: row })
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
  res.json({ ok:true, connected: !!acc, account: acc ? { calendar_id: acc.calendar_id, expiry: acc.expiry, last_sync_at: acc.last_sync_at, scope: acc.scope, pending: !acc.calendar_id } : null })
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

r.put('/whatsapp/session', async (req,res)=>{
  const { phone_number=null, status='inactive', session_json=null } = req.body||{}
  if(status && !['inactive','connecting','ready','error'].includes(status)) return res.status(400).json({ error:'invalid_status' })
  const saved = await pgUpsertWhatsappSession(req.user.id, { phone_number, status, session_json })
  res.json({ ok:true, session: saved })
})

// ---- USER SETTINGS ----
r.get('/settings', async (req,res)=>{
  const row = await pgGetUserSettings(req.user.id)
  if(!row) return res.json({ ok:true, settings: { extra_checks:{} } })
  res.json({ ok:true, settings: { extra_checks: row.extra_checks || {} } })
})
r.put('/settings', async (req,res)=>{
  const body = req.body||{}
  const { extra_checks={} } = body
  try {
    const saved = await pgUpsertUserSettings(req.user.id, { extra_checks })
    res.json({ ok:true, settings: { extra_checks: saved.extra_checks } })
  } catch(e){
    console.error('[settings][put] error', e.message)
    res.status(400).json({ error:'save_failed' })
  }
})

export default r
