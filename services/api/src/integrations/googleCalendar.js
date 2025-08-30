import fetch from 'node-fetch'
import { pool } from '../db/pg.js'
import { nanoid } from 'nanoid'

// --- Estado OAuth temporal para proteger contra CSRF ---
// Guardamos pares state -> { userId, exp }
// Vida corta (5 minutos). En producción convendría usar Redis si hay múltiples instancias.
const oauthStateStore = new Map()
export function createOauthState(userId){
  const v = nanoid(32)
  oauthStateStore.set(v, { userId, exp: Date.now() + 5*60*1000 })
  return v
}
export function validateAndConsumeState(userId, state){
  if(!state) return false
  const entry = oauthStateStore.get(state)
  if(!entry) return false
  if(entry.userId !== userId) return false
  if(Date.now() > entry.exp) { oauthStateStore.delete(state); return false }
  oauthStateStore.delete(state)
  return true
}
// Limpieza periódica muy ligera
setInterval(()=>{
  const now = Date.now()
  for(const [k,v] of oauthStateStore.entries()){
    if(now > v.exp) oauthStateStore.delete(k)
  }
}, 60*1000).unref?.()

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars'

function cfg(){
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env
  if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!GOOGLE_REDIRECT_URI) throw new Error('Missing Google OAuth env vars')
  return { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI }
}

export function buildAuthUrl(state, { scope='events', codeChallenge } = {}){
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = cfg()
  // Escopos predefinidos (podemos soportar incremental en el futuro)
  const scopesMap = {
  // readonly: listar calendarios y leer eventos
  readonly: ['https://www.googleapis.com/auth/calendar.readonly'],
  // events: se amplía para permitir listar calendarios (calendar.readonly) y gestionar eventos
  events: ['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.readonly'],
  // full: acceso completo (si en futuro se requiere administrar calendarios)
  full: ['https://www.googleapis.com/auth/calendar']
  }
  const scopes = scopesMap[scope] || scopesMap.events
  const scopeParam = encodeURIComponent(scopes.join(' '))
  const s = encodeURIComponent(state||'')
  // PKCE opcional: si se pasa codeChallenge se añade.
  const pkce = codeChallenge ? `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256` : ''
  return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&scope=${scopeParam}&access_type=offline&prompt=consent&state=${s}${pkce}`
}

export async function exchangeCode(code, { code_verifier } = {}){
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = cfg()
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code'
  })
  if(code_verifier) body.set('code_verifier', code_verifier)
  const r = await fetch(GOOGLE_TOKEN_URL, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body })
  if(!r.ok) throw new Error('token_exchange_failed')
  return r.json()
}

export async function refreshTokens(userId){
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = cfg()
  const acc = await getAccount(userId)
  if(!acc) return null
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: acc.refresh_token,
    grant_type: 'refresh_token'
  })
  const r = await fetch(GOOGLE_TOKEN_URL, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body })
  if(!r.ok){ console.error('[google] refresh fail', r.status); return null }
  const data = await r.json()
  const expiry = new Date(Date.now() + (data.expires_in||3600)*1000).toISOString()
  await pool.query('update google_calendar_accounts set access_token=$2, token_type=$3, scope=coalesce($4,scope), expiry=$5, updated_at=now() where user_id=$1', [userId, data.access_token, data.token_type||'Bearer', data.scope||null, expiry])
  return getAccount(userId)
}

export async function upsertAccount(userId, { access_token, refresh_token, token_type, scope, expires_in, calendar_id }){
  const expiry = new Date(Date.now() + (expires_in||3600)*1000).toISOString()
  await pool.query(`insert into google_calendar_accounts(user_id,access_token,refresh_token,token_type,scope,expiry,calendar_id)
    values($1,$2,$3,$4,$5,$6,$7)
    on conflict(user_id) do update set access_token=excluded.access_token,refresh_token=excluded.refresh_token,token_type=excluded.token_type,scope=excluded.scope,expiry=excluded.expiry,calendar_id=excluded.calendar_id,updated_at=now()`,
    [userId, access_token, refresh_token, token_type||'Bearer', scope||null, expiry, calendar_id])
}

export async function getAccount(userId){
  const { rows } = await pool.query('select * from google_calendar_accounts where user_id=$1', [userId])
  return rows[0]||null
}

async function authHeader(userId){
  let acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  if(Date.now() + 60000 > Date.parse(acc.expiry)){
    acc = await refreshTokens(userId) || acc
  }
  return { Authorization: `${acc.token_type||'Bearer'} ${acc.access_token}` }
}

export async function listRemoteChanges(userId){
  const acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  if(!acc.calendar_id) throw new Error('no_calendar_selected')
  const headers = await authHeader(userId)
  const params = new URLSearchParams({ singleEvents:'true', showDeleted:'true', maxResults:'2500', orderBy:'startTime' })
  if(acc.sync_token) params.set('syncToken', acc.sync_token)
  else params.set('timeMin', new Date(Date.now()-30*24*3600*1000).toISOString())
  const url = `${GOOGLE_EVENTS_BASE}/${encodeURIComponent(acc.calendar_id)}/events?${params}`
  const r = await fetch(url, { headers })
  if(r.status===410){ // sync token invalid -> full resync
    await pool.query('update google_calendar_accounts set sync_token=null where user_id=$1', [userId])
    return listRemoteChanges(userId)
  }
  if(!r.ok) throw new Error('google_list_failed')
  return r.json()
}

export async function applySync(userId){
  const acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  if(!acc.calendar_id) throw new Error('no_calendar_selected')
  const data = await listRemoteChanges(userId)
  const client = await pool.connect()
  try {
    await client.query('begin')
    for(const ev of data.items||[]){
      if(ev.status==='cancelled'){
        await client.query('update calendar_events set deleted=true, updated_at=now() where user_id=$1 and google_event_id=$2', [userId, ev.id])
        continue
      }
      const allDay = !!ev.start?.date
      if(allDay){
        // Omitimos eventos de día completo: no se guardan en calendar_events
        continue
      }
      const startISO = ev.start?.dateTime || (ev.start?.date+'T00:00:00Z')
      let endISO
      if(allDay){
        // Google usa fin exclusivo en all-day (end.date = día siguiente). Convertimos a inclusivo (último día a las 23:59:59Z) para nuestro almacenamiento.
        // Ej: start.date=2025-08-26, end.date=2025-08-27 (1 día) -> almacenamos 2025-08-26T23:59:59Z
        try {
          const endExcl = new Date(ev.end?.date + 'T00:00:00Z') // inicio del día exclusivo
          const endInclusive = new Date(endExcl.getTime() - 24*3600*1000) // último día real
          const y = endInclusive.getUTCFullYear()
          const m = String(endInclusive.getUTCMonth()+1).padStart(2,'0')
          const d = String(endInclusive.getUTCDate()).padStart(2,'0')
          endISO = `${y}-${m}-${d}T23:59:59Z`
        } catch {
          endISO = ev.end?.dateTime || (ev.end?.date+'T23:59:59Z')
        }
      } else {
        endISO = ev.end?.dateTime || (ev.end?.date+'T23:59:59Z')
      }
      const title = ev.summary || '(Sin título)'
      const description = ev.description || null
      // Intentar enlazar evento local existente sin google_event_id: coincidencia por start_at y título para evitar duplicados
      const { rows: matchRows } = await client.query(
        `select id from calendar_events 
         where user_id=$1 and google_event_id is null and deleted is not true 
           and start_at=$2 and title=$3 
         limit 1`, [userId, startISO, title])
      if(matchRows.length){
        await client.query(`update calendar_events 
          set google_event_id=$3, google_etag=$4, end_at=$5, all_day=$6, description=$7, calendar_id=$8, deleted=false, updated_at=now()
          where user_id=$1 and id=$2`, [userId, matchRows[0].id, ev.id, ev.etag||null, endISO, allDay, description, acc.calendar_id])
        continue // evitar insert duplicado
      }
      await client.query(`insert into calendar_events(id,user_id,title,description,start_at,end_at,all_day,google_event_id,google_etag,deleted,calendar_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10)
        on conflict (user_id, google_event_id) do update set title=excluded.title,description=excluded.description,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,google_etag=excluded.google_etag,deleted=false,calendar_id=excluded.calendar_id,updated_at=now()`,
        [nanoid(), userId, title, description, startISO, endISO, allDay, ev.id, ev.etag||null, acc.calendar_id])
    }
    if(data.nextSyncToken){
      await client.query('update google_calendar_accounts set sync_token=$2,last_sync_at=now(),updated_at=now() where user_id=$1', [userId, data.nextSyncToken])
    }
    await client.query('commit')
  } catch(e){ await client.query('rollback'); throw e } finally { client.release() }
}

export async function createRemoteEvent(userId, local){
  const acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  const headers = { ...(await authHeader(userId)), 'Content-Type':'application/json' }
  const body = local.all_day ? (()=>{
    // Nuestro modelo guarda fin inclusivo (último día 23:59:59Z). Google necesita fin exclusivo (día siguiente al último a las 00:00).
    const startDate = local.start_at.slice(0,10)
    const endInclusive = new Date(local.end_at)
    const endExclusive = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), endInclusive.getUTCDate()+1))
    const y = endExclusive.getUTCFullYear(); const m = String(endExclusive.getUTCMonth()+1).padStart(2,'0'); const d = String(endExclusive.getUTCDate()).padStart(2,'0')
    return {
      summary: local.title,
      description: local.description||undefined,
      start:{ date: startDate },
      end:{ date: `${y}-${m}-${d}` }
    }
  })() : {
    summary: local.title,
    description: local.description||undefined,
    start:{ dateTime: local.start_at },
    end:{ dateTime: local.end_at }
  }
  const r = await fetch(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(acc.calendar_id)}/events`, { method:'POST', headers, body: JSON.stringify(body) })
  if(!r.ok) throw new Error('google_create_failed')
  return r.json()
}

export async function patchRemoteEvent(userId, googleEventId, local){
  const acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  const headers = { ...(await authHeader(userId)), 'Content-Type':'application/json' }
  const body = local.all_day ? (()=>{
    const startDate = local.start_at.slice(0,10)
    const endInclusive = new Date(local.end_at)
    const endExclusive = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), endInclusive.getUTCDate()+1))
    const y = endExclusive.getUTCFullYear(); const m = String(endExclusive.getUTCMonth()+1).padStart(2,'0'); const d = String(endExclusive.getUTCDate()).padStart(2,'0')
    return {
      summary: local.title,
      description: local.description||undefined,
      start:{ date: startDate },
      end:{ date: `${y}-${m}-${d}` }
    }
  })() : {
    summary: local.title,
    description: local.description||undefined,
    start:{ dateTime: local.start_at },
    end:{ dateTime: local.end_at }
  }
  const r = await fetch(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(acc.calendar_id)}/events/${googleEventId}`, { method:'PATCH', headers, body: JSON.stringify(body) })
  if(!r.ok) throw new Error('google_patch_failed')
  return r.json()
}

export async function deleteRemoteEvent(userId, googleEventId){
  const acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  const headers = await authHeader(userId)
  const r = await fetch(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(acc.calendar_id)}/events/${googleEventId}`, { method:'DELETE', headers })
  if(r.status!==204 && r.status!==200){ console.error('[google] delete failed', r.status) }
}

// ---- CALENDAR LIST MANAGEMENT ----
export async function listCalendars(userId){
  const acc = await getAccount(userId)
  if(!acc) throw new Error('no_google_account')
  const headers = await authHeader(userId)
  // Primer intento pidiendo mínimo rol writer
  let url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer'
  let r = await fetch(url, { headers })
  if(!r.ok){
    const status = r.status
    let bodyText = ''
    try { bodyText = await r.text() } catch{}
    console.error('[google][calendars] fallo primer intento', status, bodyText.slice(0,500))
    // Reintentar sin minAccessRole (algunos tokens pueden dar 400 si el scope no cubre listing filtrado)
    url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'
    r = await fetch(url, { headers })
    if(!r.ok){
      let bodyText2=''; try { bodyText2 = await r.text() } catch{}
      console.error('[google][calendars] fallo segundo intento', r.status, bodyText2.slice(0,500))
      // Detectar scope insuficiente
      if((bodyText||bodyText2).includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')){
        const err = new Error('insufficient_scope')
        err.status = status
        err.body = bodyText || bodyText2
        throw err
      }
      const err = new Error('calendar_list_failed')
      err.status = status
      err.body = bodyText || bodyText2
      throw err
    }
  }
  const data = await r.json()
  // Filtrar sólo calendarios con acceso >= writer (writer u owner)
  const allowed = (data.items||[]).filter(c => ['owner','writer'].includes(c.accessRole))
  return allowed.map(c=>({ id: c.id, summary: c.summary, primary: !!c.primary, accessRole: c.accessRole }))
}

export async function setCalendar(userId, calendar_id){
  const before = await getAccount(userId)
  await pool.query('update google_calendar_accounts set calendar_id=$2, sync_token=null, updated_at=now() where user_id=$1', [userId, calendar_id])
  if(!before?.calendar_id || before.calendar_id !== calendar_id){
    await applySync(userId).catch(e=> console.error('[google][sync] after setCalendar failed', e.message))
  }
  return getAccount(userId)
}
