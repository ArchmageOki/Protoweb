// Migra usuarios y refresh tokens desde data.json (JSON store) a PostgreSQL.
// PRE: Ajusta variables de entorno PG_* y DB_BACKEND=pg antes de ejecutar.
import fs from 'fs'
import path from 'path'
import { initSchema, pgCreateUser, pgInsertRefresh } from '../src/db/pg.js'

async function run(){
  const dataFile = path.resolve(process.cwd(), 'services', 'api', 'data', 'data.json')
  if(!fs.existsSync(dataFile)){
    console.error('No existe data.json'); process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(dataFile,'utf8'))
  await initSchema()
  const users = raw.users || {}
  let uCount=0, rCount=0
  for(const email of Object.keys(users)){
    const u = users[email]
    await pgCreateUser(u.id, u.email, u.password_hash, u.failed_attempts||0, u.locked_until, u.created_at, u.last_login_at, u.password_version||1)
    uCount++
  }
  const refresh = raw.refresh || {}
  const nowSec = Math.floor(Date.now()/1000)
  for(const id of Object.keys(refresh)){
    const r = refresh[id]
    if(r.exp < nowSec) continue // saltar expirados
    await pgInsertRefresh(id, r.userId, r.exp, r.revoked||false)
    rCount++
  }
  console.log('Migración completada usuarios:', uCount, 'refresh activos:', rCount)
  process.exit(0)
}

run().catch(e=>{ console.error('Error migración', e); process.exit(1) })
