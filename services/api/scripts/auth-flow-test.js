// Script rápido para probar register -> login -> refresh
// Ejecutar: node services/api/scripts/auth-flow-test.js
import assert from 'assert'

const BASE = 'http://localhost:4002'

async function main(){
  const email = 'test+'+Date.now()+'@example.com'
  const password = 'Passw0rd!'
  console.log('Registrando', email)
  let res = await fetch(BASE+'/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) })
  const reg = await res.json()
  assert(reg.ok, 'Registro no ok '+JSON.stringify(reg))
  console.log('Registro OK')

  res = await fetch(BASE+'/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) })
  const cookies = res.headers.get('set-cookie') || ''
  const login = await res.json()
  assert(login.ok && login.accessToken, 'Login fallo '+JSON.stringify(login))
  console.log('Login OK access exp', login.accessExp)

  // usar /me
  res = await fetch(BASE+'/me', { headers:{ Authorization: 'Bearer '+login.accessToken } })
  const me = await res.json()
  assert(me.ok && me.user, '/me fallo '+JSON.stringify(me))
  console.log('Me OK', me.user)

  // refresh
  res = await fetch(BASE+'/auth/refresh', { method:'POST', headers:{ 'Cookie': cookies } })
  const refresh = await res.json()
  assert(refresh.ok && refresh.accessToken, 'Refresh fallo '+JSON.stringify(refresh))
  console.log('Refresh OK nuevo exp', refresh.accessExp)
  console.log('Flujo completo OK')
}

main().catch(e=>{ console.error('Fallo flujo', e); process.exit(1) })
