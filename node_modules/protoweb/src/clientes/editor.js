// Editor lateral de clientes (extraído de clientes.js)
import { clientes, crearCliente, actualizarCliente } from './data'
import { toInputDate, toDisplayDate, parseDisplayDate, formatDate } from './utils-fechas'
import { aplicarFiltros } from './filters'
import { renderClienteHistory } from './history'
import { authFetch, apiBase } from '../auth'

let clienteEditorMounted = false
let clienteEditorMinOpenUntil = 0
let clienteEditorClosing = false
let clienteEditorCloseAnimHandler = null
let clienteEditorCloseTransitionHandler = null
let clienteEditorCloseFallbackTimeout = null
let clienteEditorSession = 0

function cancelClienteEditorClosing(){
  if(!clienteEditorClosing) return
  const overlay = document.querySelector('.cliente-editor-overlay')
  const panel = overlay?.querySelector('.cliente-editor-panel')
  if(panel && clienteEditorCloseAnimHandler){ panel.removeEventListener('animationend', clienteEditorCloseAnimHandler) }
  if(overlay && clienteEditorCloseTransitionHandler){ overlay.removeEventListener('transitionend', clienteEditorCloseTransitionHandler) }
  if(clienteEditorCloseFallbackTimeout){ clearTimeout(clienteEditorCloseFallbackTimeout) }
  panel?.classList.remove('is-exit')
  overlay?.classList.remove('hidden')
  overlay?.classList.add('is-open')
  clienteEditorClosing = false
  clienteEditorCloseAnimHandler = null
  clienteEditorCloseTransitionHandler = null
  clienteEditorCloseFallbackTimeout = null
}
function openClienteEditor(id){
  const cliente = clientes.find(c=>c.id===id)
  if(!cliente) return
  if(!clienteEditorMounted) mountClienteEditor()
  cancelClienteEditorClosing()
  clienteEditorSession++
  populateClienteEditor(cliente)
  // Cargar histórico de citas completadas en segundo plano
  fetchClienteHistory(cliente).catch(()=>{})
  const ov = document.querySelector('.cliente-editor-overlay')
  if(ov){
    ov.classList.remove('hidden')
    void ov.offsetWidth
    ov.classList.add('is-open')
    const panel = ov.querySelector('.cliente-editor-panel')
    if(panel){ panel.classList.remove('is-exit'); void panel.offsetWidth; panel.classList.add('is-enter') }
    clienteEditorMinOpenUntil = Date.now() + 500
  }
  document.body.style.overflow='hidden'
}
function closeClienteEditor(force=false){
  const overlay = document.querySelector('.cliente-editor-overlay')
  if(!overlay) return
  const form = overlay.querySelector('#cliente-editor-form')
  if(Date.now() < clienteEditorMinOpenUntil) return
  const sessionAtClose = clienteEditorSession
  if(!force && form && isEditorDirty(form)){
    if(!window.confirm('Hay cambios sin guardar. ¿Deseas descartarlos?')) return
  }
  const panel = overlay.querySelector('.cliente-editor-panel')
  if(panel){
    panel.classList.remove('is-enter'); panel.classList.add('is-exit')
    overlay.classList.remove('is-open')
    clienteEditorClosing = true
    clienteEditorCloseAnimHandler = (ev)=>{
      if(ev.target!==panel) return
      if(clienteEditorSession !== sessionAtClose){ panel.classList.remove('is-exit'); clienteEditorClosing=false; return }
      panel.removeEventListener('animationend', clienteEditorCloseAnimHandler)
      const hide = ()=>{
        if(clienteEditorSession !== sessionAtClose) return
        overlay.classList.add('hidden')
        overlay.removeEventListener('transitionend', clienteEditorCloseTransitionHandler)
        panel.classList.remove('is-exit')
        document.body.style.overflow=''
        clienteEditorClosing=false
        clienteEditorCloseAnimHandler=null
        clienteEditorCloseTransitionHandler=null
        if(clienteEditorCloseFallbackTimeout){ clearTimeout(clienteEditorCloseFallbackTimeout); clienteEditorCloseFallbackTimeout=null }
      }
      let transitioned=false
      clienteEditorCloseTransitionHandler = (e)=>{ if(e.target===overlay){ transitioned=true; hide() } }
      overlay.addEventListener('transitionend', clienteEditorCloseTransitionHandler, { once:true })
      clienteEditorCloseFallbackTimeout = setTimeout(()=>{ if(!transitioned) hide() },320)
    }
    panel.addEventListener('animationend', clienteEditorCloseAnimHandler)
  } else {
    overlay.classList.remove('is-open')
    overlay.addEventListener('transitionend', function hide(e){ if(e.target===overlay){ overlay.classList.add('hidden'); overlay.removeEventListener('transitionend', hide) } })
    document.body.style.overflow=''
  }
}
function mountClienteEditor(){
  clienteEditorMounted = true
  const overlay = document.createElement('div')
  overlay.className='cliente-editor-overlay hidden'
  overlay.innerHTML = `
    <div class="cliente-editor-panel" role="dialog" aria-modal="true" aria-labelledby="cliente-editor-title" style="position:relative;">
      <div class="cliente-editor-resize-handle" data-ce-resize></div>
      <div class="cliente-editor-header">
        <h3 id="cliente-editor-title" class="text-sm font-semibold flex items-center gap-2">Editar cliente <span class="cliente-editor-badge" data-ce-id></span></h3>
        <button type="button" class="cliente-editor-close" data-ce-close aria-label="Cerrar">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18 18 6M6 6l12 12"/></svg>
        </button>
      </div>
  <form class="cliente-editor-form flex flex-col gap-4 cliente-editor-body" id="cliente-editor-form" novalidate>
        <div><label>Nombre</label><input name="nombre" type="text" /><div class="cliente-editor-error-text hidden" data-error-for="nombre"></div></div>
        <div><label>Apellidos</label><input name="apellidos" type="text" /><div class="cliente-editor-error-text hidden" data-error-for="apellidos"></div></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label>Móvil <span class="req-indicator" aria-hidden="true" title="Campo obligatorio">*</span></label><input name="movil" type="text" pattern="^[0-9]{9}$" required /><div class="cliente-editor-error-text hidden" data-error-for="movil"></div></div>
          <div><label>DNI</label><input name="dni" type="text" maxlength="12" /><div class="cliente-editor-error-text hidden" data-error-for="dni"></div></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label>Dirección</label><input name="direccion" type="text" /><div class="cliente-editor-error-text hidden" data-error-for="direccion"></div></div>
          <div><label>Código postal</label><input name="codigoPostal" type="text" maxlength="5" pattern="^[0-9]{5}$" /><div class="cliente-editor-error-text hidden" data-error-for="codigoPostal"></div></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label>Instagram</label><input name="instagram" type="text" /><div class="cliente-editor-error-text hidden" data-error-for="instagram"></div></div>
          <div><label>Nacimiento</label><input name="nacimiento" type="date" /><div class="cliente-editor-error-text hidden" data-error-for="nacimiento"></div></div>
        </div>
  <div class="grid grid-cols-3 gap-3" data-metrics-block>
          <div><label>Citas totales</label><input name="visitas" type="number" min="0" readonly class="cliente-editor-readonly" /></div>
          <div><label>Dinero total</label><input name="dineroTotal" type="text" readonly class="cliente-editor-readonly" /></div>
          <div><label>Última cita</label><input name="ultimaCita" type="date" readonly class="cliente-editor-readonly" /></div>
        </div>
  <div><label>Notas</label><textarea name="notas"></textarea></div>
  <div class="flex items-center gap-2"><input id="cliente-vip" name="vip" type="checkbox" /><label for="cliente-vip">VIP</label></div>
      </form>
      <div class="cliente-editor-footer"><button type="button" class="btn-secondary" data-ce-cancel>Cancelar</button><button type="submit" form="cliente-editor-form" class="btn-primary">Guardar</button></div>
    </div>`
  document.body.appendChild(overlay)
  // Cerrar con click completo fuera
  let overlayMouseDownOutside=false
  overlay.addEventListener('mousedown', e=>{ overlayMouseDownOutside = (e.target===overlay) })
  overlay.addEventListener('mouseup', e=>{ if(e.target===overlay && overlayMouseDownOutside){ if(overlay.getAttribute('data-resizing')!=='1' && overlay.getAttribute('data-just-resized')!=='1') closeClienteEditor(true) } overlayMouseDownOutside=false })
  overlay.addEventListener('touchstart', e=>{ if(e.target===overlay) overlayMouseDownOutside=true }, {passive:true})
  overlay.addEventListener('touchend', e=>{ if(e.target===overlay && overlayMouseDownOutside){ if(overlay.getAttribute('data-resizing')!=='1' && overlay.getAttribute('data-just-resized')!=='1') closeClienteEditor(true) } overlayMouseDownOutside=false })
  overlay.querySelector('[data-ce-close]')?.addEventListener('click', e=>{ e.preventDefault(); closeClienteEditor(true) })
  overlay.querySelector('[data-ce-cancel]')?.addEventListener('click', e=>{ e.preventDefault(); closeClienteEditor(true) })
  adaptDateInputsForIOS(overlay)
  const form = overlay.querySelector('#cliente-editor-form')
  // Instagram prefijo
  if(form){
    const ig = form.querySelector('input[name="instagram"]')
    if(ig && !ig.__igPrefixed){
      const ensurePrefix=()=>{ if(!ig.value.startsWith('@')) ig.value='@'+ig.value.replace(/@+/g,'').trim(); if(ig.value==='') ig.value='@' }
      ig.addEventListener('focus', ()=>{ if(ig.value.trim()==='') ig.value='@'; requestAnimationFrame(()=>{ try{ ig.setSelectionRange(ig.value.length, ig.value.length) }catch{} }) })
      ig.addEventListener('keydown', e=>{ const s=ig.selectionStart,ePos=ig.selectionEnd; if(e.key==='Backspace' && s<=1 && ePos<=1){ e.preventDefault(); return } if(e.key==='Delete' && s===0 && ePos===0){ e.preventDefault(); return } })
      ig.addEventListener('paste', e=>{ e.preventDefault(); const text=(e.clipboardData.getData('text')||'').replace(/\s+/g,'').replace(/^@+/,''); const s=ig.selectionStart,ePos=ig.selectionEnd; let before=ig.value.slice(0,s), after=ig.value.slice(ePos); if(!before.startsWith('@')) before='@'; ig.value=before+text+after; ensurePrefix(); const pos=before.length+text.length; try{ ig.setSelectionRange(pos,pos) }catch{} ig.dispatchEvent(new Event('input',{bubbles:true})) })
      ig.addEventListener('input', ensurePrefix)
      ig.addEventListener('cut', e=>{ const s=ig.selectionStart,ePos=ig.selectionEnd; if(s===0 && ePos<=1){ e.preventDefault(); return } requestAnimationFrame(()=>ensurePrefix()) })
      ig.__igPrefixed=true
    }
  }
  // Redimensionado lateral
  const panel = overlay.querySelector('.cliente-editor-panel')
  const handle = overlay.querySelector('[data-ce-resize]')
  if(panel && handle){
    const computeMinWidth = ()=>{ try { const clone=panel.cloneNode(true); clone.style.position='absolute'; clone.style.left='-9999px'; clone.style.top='-9999px'; clone.style.visibility='hidden'; clone.style.height='auto'; clone.style.maxWidth='none'; const baseWidth=panel.getBoundingClientRect().width||420; clone.style.width=baseWidth+'px'; document.body.appendChild(clone); const metricsBlock=clone.querySelector('.grid.grid-cols-3'); if(!metricsBlock){ document.body.removeChild(clone); return 320 } const labels=Array.from(metricsBlock.querySelectorAll('label')).slice(0,3); if(!labels.length){ document.body.removeChild(clone); return 320 } const singleLineHeight=Math.max(...labels.map(l=>l.offsetHeight)); let minWidthFound=baseWidth; for(let w=Math.floor(baseWidth); w>=280; w-=4){ clone.style.width=w+'px'; const wrapped=labels.some(l=>l.offsetHeight>singleLineHeight); if(wrapped){ minWidthFound=w+4; break } if(w===280) minWidthFound=w } document.body.removeChild(clone); minWidthFound=Math.max(280, Math.min(baseWidth, minWidthFound)); return minWidthFound } catch { return 320 } }
    let DYNAMIC_MIN_W = computeMinWidth(); const MAX_W=640; if(DYNAMIC_MIN_W>MAX_W) DYNAMIC_MIN_W=MAX_W; panel.setAttribute('data-min-width', String(DYNAMIC_MIN_W))
    try { const ua=navigator.userAgent||''; const isIPad=/iPad/.test(ua)||(/Macintosh/.test(ua)&&'ontouchend' in document); if(isIPad) handle.classList.add('is-touch') } catch{}
    let startX=0,startWidth=0,resizing=false; const MIN_W=DYNAMIC_MIN_W
    const onMove=e=>{ if(!resizing) return; const clientX=e.touches?e.touches[0].clientX:e.clientX; const delta=startX-clientX; let newW=startWidth+delta; if(newW<MIN_W) newW=MIN_W; if(newW>MAX_W) newW=MAX_W; panel.style.maxWidth=newW+'px'; panel.style.width='100%'; e.preventDefault() }
    const onUp=()=>{ if(!resizing) return; resizing=false; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); document.removeEventListener('touchmove',onMove); document.removeEventListener('touchend',onUp); document.body.classList.remove('cursor-ew-resize','select-none'); overlay.removeAttribute('data-resizing'); overlay.setAttribute('data-just-resized','1'); setTimeout(()=>overlay.removeAttribute('data-just-resized'),100) }
    const onDown=e=>{ const clientX=e.touches?e.touches[0].clientX:e.clientX; resizing=true; startX=clientX; startWidth=panel.getBoundingClientRect().width; document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp); document.addEventListener('touchmove',onMove,{passive:false}); document.addEventListener('touchend',onUp); document.body.classList.add('cursor-ew-resize','select-none'); overlay.setAttribute('data-resizing','1'); e.preventDefault() }
    handle.addEventListener('mousedown',onDown); handle.addEventListener('touchstart',onDown,{passive:false})
  }
  form.addEventListener('submit', e=>{
    e.preventDefault()
    const fd = new FormData(form)
    const id = form.getAttribute('data-current-id')
    let cli = id ? clientes.find(c=>c.id===id) : null
    const nombre = fd.get('nombre').toString().trim()
    const apellidos = fd.get('apellidos').toString().trim()
  // Normalizar móvil: quitar no dígitos, conservar últimos 9 si >9
  let movilRaw = fd.get('movil').toString().trim()
  let movil = movilRaw.replace(/\D+/g,'')
  if(movil.length>9) movil = movil.slice(-9)
    const dni = fd.get('dni').toString().trim()
    const instagram = fd.get('instagram').toString().trim()
    const direccion = fd.get('direccion')?.toString().trim() || ''
    const codigoPostal = fd.get('codigoPostal')?.toString().trim() || ''
    let nacimiento; const rawNac=fd.get('nacimiento')?.toString().trim(); if(rawNac){ if(/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/.test(rawNac)) nacimiento = parseDisplayDate(rawNac) || cli?.nacimiento || null; else nacimiento = new Date(rawNac); if(isNaN(nacimiento?.getTime())) nacimiento = cli?.nacimiento || null } else nacimiento = cli?.nacimiento || null
    const visitas = parseInt(fd.get('visitas')) || 0
    let ultimaCita; const rawUlt=fd.get('ultimaCita')?.toString().trim(); if(rawUlt){ if(/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/.test(rawUlt)) ultimaCita = parseDisplayDate(rawUlt) || cli?.ultimaCita || null; else ultimaCita = new Date(rawUlt); if(isNaN(ultimaCita?.getTime())) ultimaCita = cli?.ultimaCita || null } else ultimaCita = cli?.ultimaCita || null
  const notas = fd.get('notas').toString()
  const vip = fd.get('vip') === 'on'
    const movilErrEl = form.querySelector('[data-error-for="movil"]')
    if(movilErrEl){ movilErrEl.classList.add('hidden'); movilErrEl.textContent='' }
    // Comprobación local de duplicados (móvil y dni) entre clientes cargados
    const duplicates = []
    const currentId = cli ? cli.id : null
    if(movil){
      const found = clientes.find(c=>c.movil===movil && c.id!==currentId)
      if(found) duplicates.push('movil')
    }
    if(dni){
      const foundD = clientes.find(c=>c.dni && c.dni === dni && c.id!==currentId)
      if(foundD) duplicates.push('dni')
    }
    // Si hay duplicados locales, marcar ambos campos y cancelar el envío
    if(duplicates.length){
      duplicates.forEach(field=>{
        const el = form.querySelector(`[name="${field}"]`)
        const errEl = form.querySelector(`[data-error-for="${field}"]`)
        if(el) el.classList.add('cliente-editor-invalid')
        if(errEl){ errEl.textContent = `Error al guardar, el ${field==='movil'?'móvil':'DNI'} ya pertenece a un cliente.`; errEl.classList.remove('hidden') }
      })
      submitBtn.disabled = false
      submitBtn.textContent = prevLabel
      return
    }
    let createdId=null
    // Área de estado
  let statusEl = form.querySelector('.cliente-editor-status')
  if(!statusEl){ statusEl = document.createElement('div'); statusEl.className='cliente-editor-status text-xs text-slate-500'; form.appendChild(statusEl) }
  const updateStatus = (msg, cls='text-slate-500')=>{ statusEl.textContent=msg; statusEl.className='cliente-editor-status mt-1 '+cls }
    const submitBtn = document.querySelector('.cliente-editor-footer button.btn-primary')
    submitBtn.disabled = true
    const prevLabel = submitBtn.textContent
  submitBtn.textContent = 'Guardando...';
  updateStatus('Guardando cambios...');
  (async () => {
      try {
        if(!cli){
          const nuevo = await crearCliente({ first_name: nombre, last_name: apellidos, mobile: movil, dni, instagram: instagram.replace(/^@+/,'') || null, address: direccion, postal_code: codigoPostal, birth_date: nacimiento? nacimiento.toISOString().slice(0,10): null, visits_count: 0, total_amount: 0, notes: notas, is_vip: vip })
          createdId = nuevo.id
        } else {
          await actualizarCliente(cli.id, { first_name: nombre, last_name: apellidos, mobile: movil, dni, instagram: instagram.replace(/^@+/,'') || null, address: direccion, postal_code: codigoPostal, birth_date: nacimiento? nacimiento.toISOString().slice(0,10): null, visits_count: visitas, last_appointment_at: ultimaCita? ultimaCita.toISOString(): null, notes: notas, is_vip: vip })
        }
    form.dataset.original = JSON.stringify(collectFormSnapshot(form))
    aplicarFiltros()
  // Mostrar globo flotante central
  showClienteBalloon(createdId ? 'Cliente guardado correctamente' : 'Cliente modificado correctamente')
  if(createdId){ setTimeout(()=>{ const row=document.querySelector(`tr.cliente-row[data-id="${createdId}"]`); if(row){ row.classList.add('cliente-row-flash'); setTimeout(()=>row.classList.remove('cliente-row-flash'),2000) } },40) }
  // Cerrar tras breve delay
  setTimeout(()=> closeClienteEditor(true), 300)
// Globo flotante central para confirmación
function showClienteBalloon(msg){
  let balloon = document.createElement('div')
  balloon.className = 'cliente-balloon-fixed'
  balloon.textContent = msg
  Object.assign(balloon.style, {
    position: 'fixed',
    left: '50%',
    top: '32px',
    transform: 'translateX(-50%)',
    background: 'rgba(34,197,94,0.75)',
    color: '#fff',
    fontSize: '1.1rem',
    fontWeight: 'bold',
    padding: '16px 32px',
    borderRadius: '16px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
    zIndex: 9999,
    opacity: '0',
    transition: 'opacity 0.2s'
  })
  document.body.appendChild(balloon)
  setTimeout(()=>{ balloon.style.opacity='1' },10)
  setTimeout(()=>{ balloon.style.opacity='0'; setTimeout(()=>balloon.remove(),300) }, 1800)
}
      } catch(e){
        let errMsg = 'Error guardando cliente'
        let field = null
        if(e && (e.code==='duplicate_mobile' || e.code==='duplicate_dni')){
          field = e.code==='duplicate_mobile' ? 'movil' : 'dni'
          errMsg = `Error al guardar, el ${field==='movil'?'móvil':'DNI'} ya pertenece a un cliente.`
        }
        if(field){
          const el = form.querySelector(`[name="${field}"]`)
          const errEl = form.querySelector(`[data-error-for="${field}"]`)
          if(el){ el.classList.add('cliente-editor-invalid') }
          if(errEl){ errEl.textContent = errMsg; errEl.classList.remove('hidden') }
        }
        updateStatus(errMsg,'text-rose-600')
      } finally {
        submitBtn.disabled = false
        submitBtn.textContent = prevLabel
      }
    })()
  })
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !overlay.classList.contains('hidden')){ const av=document.querySelector('.attachment-viewer-overlay.is-open'); if(av) return; closeClienteEditor(true) } })
  setTimeout(()=>{ try { const p=overlay.querySelector('.cliente-editor-panel'); if(p){ const prev=p.getAttribute('data-min-width'); const recompute=()=>{ const clone=p.cloneNode(true); clone.style.position='absolute'; clone.style.left='-9999px'; clone.style.top='-9999px'; clone.style.visibility='hidden'; clone.style.height='auto'; clone.style.maxWidth='none'; const baseWidth=p.getBoundingClientRect().width||420; clone.style.width=baseWidth+'px'; document.body.appendChild(clone); const metricsBlock=clone.querySelector('.grid.grid-cols-3'); const labels=metricsBlock?Array.from(metricsBlock.querySelectorAll('label')).slice(0,3):[]; let result=320; if(labels.length){ const singleLineHeight=Math.max(...labels.map(l=>l.offsetHeight)); result=baseWidth; for(let w=Math.floor(baseWidth); w>=280; w-=4){ clone.style.width=w+'px'; const wrapped=labels.some(l=>l.offsetHeight>singleLineHeight); if(wrapped){ result=w+4; break } if(w===280) result=w } } document.body.removeChild(clone); result=Math.max(280, Math.min(640,result)); return result }; const newMin=recompute(); if(newMin && newMin !== Number(prev)){ p.setAttribute('data-min-width', String(newMin)) } } } catch{} },30)
  let resizeTO; window.addEventListener('resize', ()=>{ clearTimeout(resizeTO); resizeTO=setTimeout(()=>{ const p=overlay.querySelector('.cliente-editor-panel'); if(!p) return; const current=p.getBoundingClientRect().width; const recompute=()=>{ const clone=p.cloneNode(true); clone.style.position='absolute'; clone.style.left='-9999px'; clone.style.top='-9999px'; clone.style.visibility='hidden'; clone.style.height='auto'; clone.style.maxWidth='none'; clone.style.width=current+'px'; document.body.appendChild(clone); const metricsBlock=clone.querySelector('.grid.grid-cols-3'); const labels=metricsBlock?Array.from(metricsBlock.querySelectorAll('label')).slice(0,3):[]; let result=320; if(labels.length){ const singleLineHeight=Math.max(...labels.map(l=>l.offsetHeight)); result=current; for(let w=Math.floor(current); w>=280; w-=4){ clone.style.width=w+'px'; const wrapped=labels.some(l=>l.offsetHeight>singleLineHeight); if(wrapped){ result=w+4; break } if(w===280) result=w } } document.body.removeChild(clone); result=Math.max(280, Math.min(640,result)); return result }; const newMin=recompute(); p.setAttribute('data-min-width', String(newMin)) },120) })
  form.addEventListener('input', ()=> updateDirtyIndicator(form))
  overlay.addEventListener('click', e=>{ const btn=e.target.closest('[data-history-toggle]'); if(!btn) return; const panel=overlay.querySelector('[data-history-panel]'); if(!panel) return; const open=!panel.classList.contains('hidden'); if(open){ panel.classList.add('hidden'); btn.setAttribute('aria-expanded','false') } else { panel.classList.remove('hidden'); btn.setAttribute('aria-expanded','true') } })
}
function populateClienteEditor(c){
  const overlay = document.querySelector('.cliente-editor-overlay'); if(!overlay) return
  const form = overlay.querySelector('#cliente-editor-form'); form.setAttribute('data-current-id', c.id)
  overlay.querySelector('[data-ce-id]').textContent = c.id
  // Mostrar bloque métricas al editar
  const metrics = overlay.querySelector('[data-metrics-block]')
  if(metrics) metrics.classList.remove('hidden')
  form.nombre.value = c.nombre; form.apellidos.value = c.apellidos; form.movil.value = c.movil; form.dni.value = c.dni
  if(form.direccion) form.direccion.value = c.direccion || ''
  if(form.codigoPostal) form.codigoPostal.value = c.codigoPostal || ''
  form.instagram.value = c.instagram.startsWith('@')? c.instagram : ('@'+c.instagram)
  form.nacimiento.value = c.nacimiento ? toInputDate(c.nacimiento) : ''
  form.visitas.value = c.visitas ?? 0
  if(form.dineroTotal) form.dineroTotal.value = c.dineroTotal!=null ? c.dineroTotal.toFixed(2)+' €' : ''
  if(form.ultimaCita && form.ultimaCita.getAttribute('data-date-adapted')==='1'){ form.ultimaCita.value = c.ultimaCita ? toDisplayDate(c.ultimaCita) : '' } else { form.ultimaCita.value = c.ultimaCita ? toInputDate(c.ultimaCita) : '' }
  form.notas.value = c.notas || ''
  const vipChk = form.querySelector('#cliente-vip'); if(vipChk) vipChk.checked = !!c.vip
  form.dataset.original = JSON.stringify(collectFormSnapshot(form))
  updateDirtyIndicator(form)
  renderClienteHistory(c)
}
async function fetchClienteHistory(cliente){
  try {
    const r = await authFetch(apiBase + '/data/clients/'+encodeURIComponent(cliente.id)+'/appointments/completed?limit=200')
    if(!r.ok) return
    const j = await r.json()
    const items = Array.isArray(j.items)? j.items : []
    // Mapear a forma esperada por renderClienteHistory: { fecha, notas, priceTotal, pricePaid, adjuntos:[] }
    const mapped = items.map(ev=>({
      // Convertir a Date para que formatDate() genere dd/mm/aaaa correctamente
      fecha: (function(){
        const raw = ev.completed_at || ev.start_at
        if(!raw) return null
        const d = new Date(raw)
        return isNaN(d.getTime()) ? null : d
      })(),
      notas: ev.notes || ev.description || '',
      priceTotal: ev.total_amount!=null? Number(ev.total_amount): null,
      pricePaid: ev.paid_amount!=null? Number(ev.paid_amount): null,
      adjuntos: []
    }))
    cliente.citas = mapped
    renderClienteHistory(cliente)
  } catch(e){ console.error('[cliente][history] fallo', e.message) }
}
function adaptDateInputsForIOS(root){
  const ua = navigator.userAgent || ''
  const isiPad = (/iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document))
  if(!isiPad) return
  ;['ultimaCita'].forEach(name=>{ const inp=root.querySelector(`input[name="${name}"]`); if(!inp||inp.getAttribute('data-date-adapted')==='1') return; if(inp.type!=='date') return; const val=inp.value; inp.type='text'; inp.placeholder='dd/mm/aaaa'; inp.inputMode='numeric'; inp.pattern='[0-9]{2}/[0-9]{2}/[0-9]{4}'; inp.setAttribute('data-date-adapted','1'); if(val){ const d=new Date(val); if(!isNaN(d.getTime())) inp.value=toDisplayDate(d) } inp.addEventListener('blur', ()=>{ const t=inp.value.trim(); if(!t){ inp.classList.remove('cliente-editor-invalid'); return } const d=parseDisplayDate(t); if(!d){ inp.classList.add('cliente-editor-invalid') } else { inp.classList.remove('cliente-editor-invalid'); inp.value=toDisplayDate(d) } }) })
}
function collectFormSnapshot(form){
  return { nombre:form.nombre.value.trim(), apellidos:form.apellidos.value.trim(), movil:form.movil.value.trim(), dni:form.dni.value.trim(), direccion:form.direccion?.value.trim()||'', codigoPostal:form.codigoPostal?.value.trim()||'', instagram:form.instagram.value.trim(), nacimiento:form.nacimiento.value, visitas:form.visitas.value, dineroTotal:form.dineroTotal?.value||'', ultimaCita:form.ultimaCita.value, notas:form.notas.value, vip: form.querySelector('#cliente-vip')?.checked ? 1:0 }
}
function isEditorDirty(form){ if(!form?.dataset.original) return false; try { return JSON.stringify(JSON.parse(form.dataset.original)) !== JSON.stringify(collectFormSnapshot(form)) } catch { return false } }
function updateDirtyIndicator(form){ const header=document.getElementById('cliente-editor-title'); if(!header) return; const dirty=isEditorDirty(form); let dot=header.querySelector('.cliente-editor-dirty'); if(dirty && !dot){ dot=document.createElement('span'); dot.className='cliente-editor-dirty'; dot.textContent='•'; dot.style.color='#dc2626'; dot.style.fontWeight='700'; dot.style.marginLeft='4px'; header.appendChild(dot) } else if(!dirty && dot){ dot.remove() } }

function nuevoCliente(){
  if(!clienteEditorMounted) mountClienteEditor()
  cancelClienteEditorClosing(); clienteEditorSession++
  const ov=document.querySelector('.cliente-editor-overlay')
  if(ov){ ov.classList.remove('hidden'); void ov.offsetWidth; ov.classList.add('is-open'); const panel=ov.querySelector('.cliente-editor-panel'); if(panel){ panel.classList.remove('is-exit'); void panel.offsetWidth; panel.classList.add('is-enter') } }
  document.body.style.overflow='hidden'
  const form = ov.querySelector('#cliente-editor-form')
  if(form){
    form.reset();
    form.setAttribute('data-current-id','');
    form.nombre.value=''; form.apellidos.value=''; form.movil.value=''; form.dni.value='';
    if(form.direccion) form.direccion.value=''; if(form.codigoPostal) form.codigoPostal.value='';
    form.instagram.value='@'; form.nacimiento.value='';
    form.visitas.value='0'; if(form.dineroTotal) form.dineroTotal.value=''; form.ultimaCita.value='';
    form.notas.value='';
  const vipChk = form.querySelector('#cliente-vip'); if(vipChk) vipChk.checked = false
    const idBadge = ov.querySelector('[data-ce-id]'); if(idBadge) idBadge.textContent='Nuevo'
    // Ocultar bloque métricas en modo nuevo
    const metrics = ov.querySelector('[data-metrics-block]'); if(metrics) metrics.classList.add('hidden')
    form.dataset.original = JSON.stringify(collectFormSnapshot(form));
    updateDirtyIndicator(form)
  }
}
function editarCliente(id){ openClienteEditor(id) }

export { nuevoCliente, editarCliente }