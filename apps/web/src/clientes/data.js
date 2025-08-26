// Datos reales cargados desde la API
import { authFetch, apiBase } from '../auth'

export const clientes = [] // mutable, otros módulos lo importan

function mapApiToCliente(r){
  // r: registro de la API (snake_case)
  const nacimiento = r.birth_date ? new Date(r.birth_date) : null
  const ultima = r.last_appointment_at ? new Date(r.last_appointment_at) : null
  return {
    id: r.id,
  nombre: r.first_name || (r.full_name ? r.full_name.split(' ')[0] : ''),
  apellidos: r.last_name || (r.full_name ? r.full_name.split(' ').slice(1).join(' ') : ''),
  movil: r.mobile || '',
    instagram: r.instagram ? (r.instagram.startsWith('@')? r.instagram : '@'+r.instagram) : '@',
    dni: r.dni || '',
    direccion: r.address || '',
    codigoPostal: r.postal_code || '',
    nacimiento,
    visitas: r.visits_count ?? 0,
    dineroTotal: r.total_amount != null ? Number(r.total_amount) : 0,
    ultimaCita: ultima,
    citas: [], // pendiente: cargar citas reales cuando exista endpoint
  notas: r.notes || '',
  vip: !!r.is_vip
  }
}

export async function cargarClientes(){
  try {
    const r = await authFetch(apiBase + '/data/clients')
    if(!r.ok) throw new Error('http '+r.status)
    const data = await r.json()
    const arr = Array.isArray(data.items) ? data.items : []
    clientes.splice(0, clientes.length, ...arr.map(mapApiToCliente))
    return clientes
  } catch(e){
    console.error('[clientes] fallo cargando', e)
    clientes.splice(0, clientes.length) // dejar vacío si error
    return clientes
  }
}

export async function crearCliente(payload){
  const r = await authFetch(apiBase + '/data/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
  if(!r.ok){
    let err
    try { err = await r.json() } catch { err = { error:'create_failed' } }
    const e = new Error(err.error||'create_failed'); e.code = err.error; e.field = err.field; e.status = r.status; throw e
  }
  const data = await r.json()
  const cli = mapApiToCliente(data.item)
  clientes.unshift(cli)
  return cli
}

export async function actualizarCliente(id, payload){
  const r = await authFetch(apiBase + '/data/clients/'+encodeURIComponent(id), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
  if(!r.ok){
    let err
    try { err = await r.json() } catch { err = { error:'update_failed' } }
    const e = new Error(err.error||'update_failed'); e.code = err.error; e.field = err.field; e.status = r.status; throw e
  }
  const data = await r.json()
  const cli = mapApiToCliente(data.item)
  const idx = clientes.findIndex(c=>c.id===id)
  if(idx>=0) clientes[idx] = cli
  else clientes.push(cli)
  return cli
}

export async function borrarCliente(id){
  const r = await authFetch(apiBase + '/data/clients/'+encodeURIComponent(id), { method:'DELETE' })
  if(!r.ok) throw new Error('delete_failed')
  const idx = clientes.findIndex(c=>c.id===id)
  if(idx>=0) clientes.splice(idx,1)
}
