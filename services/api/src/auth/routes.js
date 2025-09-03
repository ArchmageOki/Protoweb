import { Router } from 'express'
import { createUser, findUserByEmail, isLocked, recordLoginFail, recordLoginSuccess, verifyPassword, updatePassword } from '../models/userStore.js'
import { issueTokens, rotateRefresh, consumeRefresh, detectReuse } from './token.js'
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js'
import * as pgAdapter from '../db/pg.js'

const router = Router()

// Métricas simples en memoria
export const authMetrics = {
  login_success: 0,
  login_fail: 0,
  refresh_success: 0,
  refresh_fail: 0,
  refresh_reuse_detected: 0
}

const IS_PROD = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly:true, secure: IS_PROD, sameSite: IS_PROD ? 'lax' : 'strict', path:'/' }

function passwordStrong(p){
  if(typeof p !== 'string' || p.length < 8) return false
  let cats = 0
  if(/[A-Z]/.test(p)) cats++
  if(/[a-z]/.test(p)) cats++
  if(/\d/.test(p)) cats++
  if(/[^A-Za-z0-9]/.test(p)) cats++
  return cats >= 3
}

router.post('/register', registerLimiter, async (req,res)=>{
  try {
    const { email, password } = req.body||{}
  if(typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error:'invalid_input' })
  if(!passwordStrong(password)) return res.status(400).json({ error:'weak_password' })
    const user = await createUser(email, password)
    // Crear token de verificación de email (24h)
  // Invalidar tokens previos y crear nuevo
  await pgAdapter.pgInvalidateEmailVerificationsForUser(user.id)
  const id = (await import('nanoid')).nanoid()
  const exp = Math.floor(Date.now()/1000) + 24*60*60
  await pgAdapter.pgInsertEmailVerification(id, user.id, exp)
    let verificationLink = null
    if(!IS_PROD){
      const base = process.env.DEV_FRONTEND_ORIGIN || 'http://localhost:5173'
      verificationLink = `${base}/verificar-email.html?token=${id}`
      console.log(`[email][verify] link => ${verificationLink}`)
    }
    res.status(201).json({ ok:true, user, verificationPending: true, verificationLink })
  } catch(e){
    if(e.message === 'email_exists') return res.status(409).json({ error:'email_exists' })
    res.status(500).json({ error:'internal_error' })
  }
})

router.post('/login', loginLimiter, async (req,res)=>{
  const { email, password } = req.body||{}
  if(typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error:'invalid_credentials' })
  const user = await findUserByEmail(email)
  if(!user){ await new Promise(r=>setTimeout(r, 200)); return res.status(401).json({ error:'invalid_credentials' }) }
  if(isLocked(user)) return res.status(429).json({ error:'locked', until: user.locked_until })
  const ok = await verifyPassword(user, password).catch(()=>false)
  if(!ok){ recordLoginFail(user); authMetrics.login_fail++; return res.status(401).json({ error:'invalid_credentials' }) }
  if(!user.email_verified){
    // No revelar demasiada info si quisieras, pero aquí damos error específico
    return res.status(403).json({ error:'email_not_verified' })
  }
  if(!user.active_account){
    return res.status(403).json({ error:'inactive_account' })
  }
  recordLoginSuccess(user)
  const tokens = await issueTokens(user)
  // Refresh token en cookie HttpOnly
  authMetrics.login_success++
  res.cookie('rt', tokens.refreshToken, { ...COOKIE_BASE, maxAge: 1000 * (tokens.refreshExp - Math.floor(Date.now()/1000)) })
  res.json({ ok:true, accessToken: tokens.accessToken, accessExp: tokens.accessExp })
})

router.post('/refresh', async (req,res)=>{
  const rt = req.cookies?.rt
  if(!rt){
    console.warn('[auth][refresh] falta cookie rt')
    return res.status(401).json({ error:'no_refresh' })
  }
  const rec = await consumeRefresh(rt)
  if(!rec){
    // Intentar detectar reuse de un token ya rotado/revocado
    const reuse = await detectReuse(rt)
    if(reuse){
      authMetrics.refresh_reuse_detected++
      // Revocar todos los refresh del usuario implicado (defensa)
      await pgAdapter.pgRevokeAllUserRefresh(reuse.userId)
    }
    console.warn('[auth][refresh] token inválido o revocado', rt)
    authMetrics.refresh_fail++
    return res.status(401).json({ error:'invalid_refresh' })
  }
  let rot = null
  if(rec.alt){
    console.warn('[auth][refresh] usando fallback alt token por carrera')
    rot = await rotateRefresh(rec.id)
  } else {
    rot = await rotateRefresh(rt)
  }
  if(!rot){
    console.warn('[auth][refresh] fallo al rotar', rt)
    return res.status(401).json({ error:'refresh_rotation_failed' })
  }
  const user = await pgAdapter.pgFindUserById(rot.userId)
  if(!user){
    console.warn('[auth][refresh] usuario no encontrado', rot.userId)
    return res.status(401).json({ error:'user_missing' })
  }
  const { accessToken, accessExp } = await issueTokens(user)
  authMetrics.refresh_success++
  res.cookie('rt', rot.newId, { ...COOKIE_BASE, maxAge: 1000*(rec.exp - Math.floor(Date.now()/1000)) })
  res.json({ ok:true, accessToken, accessExp })
})

router.post('/logout', async (req,res)=>{
  const rt = req.cookies?.rt
  if(rt){
    const existing = await pgAdapter.pgGetRefresh(rt)
    if(existing) await pgAdapter.pgRevokeRefresh(rt)
  res.clearCookie('rt', { path:'/' })
  }
  res.json({ ok:true })
})

// Solicitud de recuperación: genera token de un solo uso (simulado: respondemos id; en producción enviar por email)
router.post('/forgot', async (req,res)=>{
  const { email } = req.body||{}
  if(typeof email !== 'string') return res.status(400).json({ error:'invalid_input' })
  const user = await findUserByEmail(email)
  // Respuesta uniforme para no filtrar existencia
  if(!user){ await new Promise(r=>setTimeout(r,150)); return res.json({ ok:true }) }
  const id = (await import('nanoid')).nanoid()
  const exp = Math.floor(Date.now()/1000) + 15*60 // 15 min
  await pgAdapter.pgInvalidatePasswordResetsForUser(user.id)
  await pgAdapter.pgInsertPasswordReset(id, user.id, exp)
  // Aquí enviar email con enlace: /reset?token=...
  let resetLink = null
  if(!IS_PROD){
    const base = process.env.DEV_FRONTEND_ORIGIN || 'http://localhost:5173'
    resetLink = `${base}/reset.html?token=${id}`
    console.log(`[email][reset] link => ${resetLink}`)
  }
  res.json({ ok:true, resetLink: IS_PROD ? undefined : resetLink })
})

// Reset: requiere token válido y nueva contraseña
router.post('/reset', async (req,res)=>{
  const { token, password } = req.body||{}
  if(typeof token !== 'string' || typeof password !== 'string') return res.status(400).json({ error:'invalid_input' })
  if(!passwordStrong(password)) return res.status(400).json({ error:'weak_password' })
  const rec = await pgAdapter.pgGetPasswordReset(token)
  if(!rec){ return res.status(400).json({ error:'invalid_token' }) }
  const nowSec = Math.floor(Date.now()/1000)
  if(rec.used || rec.exp < nowSec){ return res.status(400).json({ error:'invalid_token' }) }
  await updatePassword(rec.user_id, password)
  await pgAdapter.pgMarkPasswordResetUsed(token)
  // Revocar refresh tokens existentes por seguridad
  await pgAdapter.pgRevokeAllUserRefresh(rec.user_id)
  res.json({ ok:true })
})

// Validación previa de token de reset sin consumirlo
router.post('/reset-validate', async (req,res)=>{
  const { token } = req.body||{}
  if(typeof token !== 'string') return res.status(400).json({ error:'invalid_input' })
  const rec = await pgAdapter.pgGetPasswordReset(token)
  if(!rec){ return res.status(400).json({ error:'invalid_token' }) }
  const nowSec = Math.floor(Date.now()/1000)
  if(rec.used || rec.exp < nowSec){ return res.status(400).json({ error:'invalid_token' }) }
  res.json({ ok:true })
})

// Verificar email
router.post('/verify-email', async (req,res)=>{
  const { token } = req.body||{}
  if(typeof token !== 'string') return res.status(400).json({ error:'invalid_input' })
  const rec = await pgAdapter.pgGetEmailVerification(token)
  if(!rec) return res.status(400).json({ error:'invalid_token' })
  const nowSec = Math.floor(Date.now()/1000)
  if(rec.used || rec.exp < nowSec) return res.status(400).json({ error:'invalid_token' })
  await pgAdapter.pgMarkEmailVerificationUsed(token)
  await pgAdapter.pgMarkUserEmailVerified(rec.user_id)
  res.json({ ok:true })
})

// Reenviar verificación (si aún no verificado)
router.post('/resend-verification', async (req,res)=>{
  const { email } = req.body||{}
  if(typeof email !== 'string') return res.status(400).json({ error:'invalid_input' })
  const user = await findUserByEmail(email)
  // Respuesta uniforme
  if(!user){ await new Promise(r=>setTimeout(r,100)); return res.json({ ok:true }) }
  if(user.email_verified){ return res.json({ ok:true, alreadyVerified:true }) }
  await pgAdapter.pgInvalidateEmailVerificationsForUser(user.id)
  const id = (await import('nanoid')).nanoid()
  const exp = Math.floor(Date.now()/1000) + 24*60*60
  await pgAdapter.pgInsertEmailVerification(id, user.id, exp)
  if(!IS_PROD){
    const base = process.env.DEV_FRONTEND_ORIGIN || 'http://localhost:5173'
    console.log(`[email][verify][resend] link => ${base}/verificar-email.html?token=${id}`)
  }
  res.json({ ok:true })
})

export default router
// Endpoint temporal de depuración (eliminar en producción)
router.get('/refresh-debug', async (req,res)=>{
  const rt = req.cookies?.rt || null
  let record = null
  if(rt){
    try { record = await pgAdapter.pgGetRefresh(rt) } catch(e){ record = { error: e.message } }
  }
  res.json({ rt_present: !!rt, record: record ? { exists:true, revoked:record.revoked, exp:record.exp, user_id:record.user_id } : { exists:false } })
})
