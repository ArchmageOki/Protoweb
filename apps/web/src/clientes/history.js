// Histórico de citas y expansión de adjuntos por fila
import { clientes } from './data'
import { formatDate } from './utils-fechas'
import { PREVIEW_IMAGE_SRC, PREVIEW_FALLBACK_DATA } from './attachments'

export function renderClienteHistory(cliente){
  const overlay = document.querySelector('.cliente-editor-overlay')
  if(!overlay) return
  let container = overlay.querySelector('[data-history-container]')
  if(!container){
    const notasWrapper = overlay.querySelector('textarea[name="notas"]').closest('div')
    container = document.createElement('div')
    container.setAttribute('data-history-container','')
    container.innerHTML = `
      <div class="pt-2 border-t border-slate-200 mt-2">
        <button type="button" data-history-toggle aria-expanded="false" class="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors">
          <span>Histórico de citas</span>
          <span class="inline-flex items-center gap-1 text-[10px] tracking-wide" data-history-meta></span>
        </button>
        <div class="mt-2 hidden max-h-52 overflow-auto border border-slate-200 rounded bg-slate-50" data-history-panel>
          <table class="w-full text-[11px]">
            <thead class="bg-slate-100 text-slate-600 sticky top-0">
              <tr>
                <th class="text-left px-2 py-1 font-medium whitespace-nowrap w-0" style="width:1%">Fecha</th>
                <th class="text-left px-2 py-1 font-medium whitespace-nowrap w-0" style="width:1%" title="Importe total de la cita">Importe</th>
                <th class="text-left px-2 py-1 font-medium">Notas</th>
                <th class="text-left px-2 py-1 font-medium">Adjuntos</th>
              </tr>
            </thead>
            <tbody data-history-rows></tbody>
          </table>
        </div>
      </div>`
    notasWrapper.after(container)
  }
  const meta = container.querySelector('[data-history-meta]')
  const tbody = container.querySelector('[data-history-rows]')
  if(!tbody) return
  tbody.textContent=''
  const citas = Array.isArray(cliente.citas)? cliente.citas : []
  if(citas.length===0){
    const tr = document.createElement('tr')
    tr.innerHTML = `<td colspan="4" class="px-2 py-2 text-slate-500 italic">Sin citas</td>`
    tbody.appendChild(tr)
  } else {
    citas.forEach((ci, idx) => {
      const tr = document.createElement('tr')
      tr.className='border-t border-slate-200'
      const fecha = formatDate(ci.fecha)
      const count = (ci.adjuntos && ci.adjuntos.length) || 0
      const adjBadge = count ? `<button type="button" data-cita-adj-btn data-cita-index="${idx}" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-medium hover:bg-slate-300 transition" title="Ver ${count} adjunto${count!==1?'s':''}">📎 ${count}</button>` : '—'
      const importe = (ci.priceTotal!=null ? ci.priceTotal.toFixed(2)+' €' : '—') + (ci.pricePaid!=null && ci.pricePaid !== ci.priceTotal ? ` <span class="text-[10px] text-slate-500" title="Pagado">(${ci.pricePaid.toFixed(2)} €)</span>` : '')
  // Nuevo orden: Fecha | Importe | Notas | Adjuntos
  tr.innerHTML = `<td class="px-2 py-1 whitespace-nowrap w-0" style="width:1%">${fecha}</td><td class="px-2 py-1 whitespace-nowrap w-0" style="width:1%" title="Total${ci.pricePaid!=null?` / Pagado`:''}">${importe}</td><td class="px-2 py-1">${ci.notas || '—'}</td><td class="px-2 py-1 text-slate-600">${adjBadge}</td>`
      tbody.appendChild(tr)
    })
  }
  if(meta){ meta.textContent = `${citas.length} registro${citas.length!==1?'s':''}` }
}

// Delegación para expandir adjuntos (antes en clientes.js)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-cita-adj-btn]')
  if(!btn) return
  const overlay = btn.closest('.cliente-editor-overlay')
  if(!overlay) return
  const form = overlay.querySelector('#cliente-editor-form')
  const id = form?.getAttribute('data-current-id')
  const cliente = clientes.find(c=>c.id===id)
  if(!cliente) return
  const idx = parseInt(btn.getAttribute('data-cita-index'),10)
  const cita = cliente.citas && cliente.citas[idx]
  if(!cita) return
  let next = btn.closest('tr')?.nextElementSibling
  let removed = false
  while(next && next.hasAttribute('data-adj-row')){
    removed = true
    const toRemove = next
    next = next.nextElementSibling
    toRemove.remove()
  }
  if(removed) return
  let baseRow = btn.closest('tr')
  if(!baseRow) return
  const adj = Array.isArray(cita.adjuntos)? cita.adjuntos : []
  if(!adj.length) return
  adj.forEach((name, attIndex) => {
    const row = document.createElement('tr')
    row.setAttribute('data-adj-row','')
    row.className='bg-white border-t border-slate-200'
    const lower = name.toLowerCase()
    let thumb
    if(lower.endsWith('.pdf')){
      thumb = `<button type="button" data-open-attachment data-attachment-name="${name}" data-attachment-type="pdf" data-client-id="${cliente.id}" data-cita-index="${idx}" data-attachment-index="${attIndex}" class="w-14 h-10 flex items-center justify-center rounded border border-slate-300 bg-red-50 text-[10px] font-semibold text-red-700 hover:bg-red-100 transition" title="Ver PDF">PDF</button>`
    } else {
      thumb = `<button type="button" data-open-attachment data-attachment-name="${name}" data-attachment-type="image" data-client-id="${cliente.id}" data-cita-index="${idx}" data-attachment-index="${attIndex}" class="w-14 h-10 rounded border border-slate-300 bg-slate-100 overflow-hidden group" title="Ver imagen"><img src="${PREVIEW_IMAGE_SRC}" alt="${name}" class="w-full h-full object-cover group-hover:opacity-90" onerror="this.onerror=null;this.src='${PREVIEW_FALLBACK_DATA}';" /></button>`
    }
    row.innerHTML = `<td class="px-2 py-1 text-[11px] text-slate-500"></td><td class="px-2 py-2" colspan="2"><div class="flex items-center gap-3">${thumb}<span class="text-[11px] font-medium text-slate-700" title="${name}">${name}</span></div></td>`
    baseRow.parentNode.insertBefore(row, baseRow.nextElementSibling)
    baseRow = row
  })
})
