// Pruebas manuales con email/clave fijos
// Email: juanmatest@testing.com Password: Passw0rd!
// Ejecutar: node services/api/scripts/manual-auth-run.js
const EMAIL = 'juanmatest@testing.com'
const PASSWORD = 'Passw0rd!'
const BASE = 'http://localhost:4002'

async function jsonOrText(res){
  const txt = await res.text()
  try { return JSON.parse(txt) } catch { return txt }
}

async function main(){
  console.log('--- REGISTRO ---')
  let res = await fetch(BASE+'/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:EMAIL, password:PASSWORD }) })
  let body = await jsonOrText(res)
  console.log('Status', res.status, body)

  console.log('--- REGISTRO DUPLICADO ---')
  res = await fetch(BASE+'/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:EMAIL, password:PASSWORD }) })
  body = await jsonOrText(res)
  console.log('Status', res.status, body)

  console.log('--- LOGIN CORRECTO ---')
  res = await fetch(BASE+'/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:EMAIL, password:PASSWORD }) })
  const setCookie = res.headers.get('set-cookie') || ''
  body = await jsonOrText(res)
  console.log('Status', res.status, 'Set-Cookie:', setCookie)
  console.log('Body', body)
  const access = body.accessToken
  const refreshCookie = (setCookie.split(';')[0])

  console.log('--- /ME ---')
  res = await fetch(BASE+'/me', { headers:{ Authorization: 'Bearer '+access } })
  body = await jsonOrText(res)
  console.log('Status', res.status, body)

  console.log('--- REFRESH CORRECTO ---')
  res = await fetch(BASE+'/auth/refresh', { method:'POST', headers:{ Cookie: refreshCookie } })
  const refreshSet = res.headers.get('set-cookie') || ''
  body = await jsonOrText(res)
  console.log('Status', res.status, 'Set-Cookie:', refreshSet)
  console.log('Body', body)

  console.log('--- REFRESH INVALIDO ---')
  res = await fetch(BASE+'/auth/refresh', { method:'POST', headers:{ Cookie: 'rt=inventado123' } })
  body = await jsonOrText(res)
  console.log('Status', res.status, body)

  console.log('--- LOGIN FALLIDO x6 PARA BLOQUEO ---')
  for(let i=1;i<=6;i++){
    res = await fetch(BASE+'/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:EMAIL, password:'Wrong'+i }) })
    body = await jsonOrText(res)
    console.log('Intento', i, 'Status', res.status, body)
    if(res.status === 429) break
  }
  console.log('--- FIN PRUEBAS ---')
}

main().catch(e=>{ console.error('Error pruebas', e); process.exit(1) })
