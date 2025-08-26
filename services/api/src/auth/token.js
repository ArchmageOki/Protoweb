import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import { ACCESS_TOKEN_TTL_SEC, JWT_ACCESS_SECRET, REFRESH_TOKEN_TTL_SEC } from '../config.js'
import * as pgAdapter from '../db/pg.js'

export async function issueTokens(user){
  const nowSec = Math.floor(Date.now()/1000)
  const accessPayload = { sub: user.id, ver: user.password_version, iat: nowSec }
  const accessToken = jwt.sign(accessPayload, JWT_ACCESS_SECRET, { algorithm:'HS256', expiresIn: ACCESS_TOKEN_TTL_SEC })
  const refreshId = nanoid()
  const refreshExp = nowSec + REFRESH_TOKEN_TTL_SEC
  await pgAdapter.pgInsertRefresh(refreshId, user.id, refreshExp)
  return { accessToken, refreshToken: refreshId, accessExp: nowSec + ACCESS_TOKEN_TTL_SEC, refreshExp }
}

export function rotateRefresh(oldId){
  return pgAdapter.pgRotateRefresh(oldId, nanoid())
}

export function verifyAccess(token){
  try { return jwt.verify(token, JWT_ACCESS_SECRET) } catch { return null }
}

export async function consumeRefresh(id){
  const rec = await pgAdapter.pgGetRefresh(id)
  if(!rec || rec.revoked) return null
  const nowSec = Math.floor(Date.now()/1000)
  if(rec.exp < nowSec) return null
  return { userId: rec.user_id, exp: rec.exp, revoked: rec.revoked }
}

export async function detectReuse(id){
  // Si llega un id inexistente, podría ser reuse si previamente existió y fue rotado; aquí simplificado solo diferencia inexistente vs revocado
  const rec = await pgAdapter.pgGetRefresh(id)
  if(rec && rec.revoked){
    return { userId: rec.user_id, revoked:true }
  }
  return null
}
