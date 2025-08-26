import argon2 from 'argon2'
import { nanoid } from 'nanoid'
// Cambiamos de almacenamiento en memoria a store persistente
import { PASSWORD_HASH_MEMORY, PASSWORD_HASH_PARALLELISM, PASSWORD_HASH_TIME } from '../config.js'
import * as pgAdapter from '../db/pg.js'
await pgAdapter.initSchema()

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: PASSWORD_HASH_MEMORY, timeCost: PASSWORD_HASH_TIME, parallelism: PASSWORD_HASH_PARALLELISM }

export async function createUser(email, password){
  email = email.trim().toLowerCase()
  const id = nanoid()
  const password_hash = await argon2.hash(password, ARGON_OPTS)
  const created = await pgAdapter.pgCreateUser(id, email, password_hash)
  return created || { id, email, created_at: new Date().toISOString() }
}

export async function findUserByEmail(email){
  return pgAdapter.pgFindUserByEmail(email.trim().toLowerCase())
}

export async function verifyPassword(user, password){
  return argon2.verify(user.password_hash, password)
}

export function recordLoginSuccess(user){
  user.failed_attempts = 0
  user.locked_until = null
  user.last_login_at = new Date().toISOString()
  pgAdapter.pgUpdateUserLoginSuccess(user.id)
}

export function recordLoginFail(user){
  const now = Date.now()
  user.failed_attempts = (user.failed_attempts||0) + 1
  if (user.failed_attempts >= 5){
    const lockMinutes = Math.min(60, 2 ** (user.failed_attempts - 5)) // backoff exponencial, máx 60m
    user.locked_until = new Date(now + lockMinutes*60*1000).toISOString()
  }
  pgAdapter.pgRecordLoginFail(user.id, user.failed_attempts, user.locked_until)
}

export function isLocked(user){
  if(!user.locked_until) return false
  return Date.now() < Date.parse(user.locked_until)
}

export async function updatePassword(userId, newPassword){
  const hash = await argon2.hash(newPassword, ARGON_OPTS)
  // Incrementar password_version para invalidar access tokens antiguos
  await pgAdapter.pool.query('update users set password_hash=$2, password_version = password_version + 1 where id=$1', [userId, hash])
}
