// Visor de adjuntos de clientes (extraído de clientes.js)
import { clientes } from './data'

export const PREVIEW_IMAGE_SRC = '/Prueba.jpg'
export const PREVIEW_PDF_SRC = '/Prueba.pdf'
export const PREVIEW_FALLBACK_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJElEQVR4Xu3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAwI0GLAAAF2HPWQAAAABJRU5ErkJggg=='

let attachmentViewerMounted = false
let currentAttachmentContext = null // {clientId, citaIndex, attachments:[{name,type}], index}
let currentZoom = 1
let pan = { x:0, y:0 }
let isPanning = false
let panStart = { x:0, y:0 }
let panOrigin = { x:0, y:0 }

function mountAttachmentViewer(){
  if(attachmentViewerMounted) return
  attachmentViewerMounted = true
  const el = document.createElement('div')
  el.className='attachment-viewer-overlay'
  el.innerHTML = `
    <div class="attachment-viewer-toolbar">
      <button type="button" data-av-prev title="Anterior" class="hidden">◀</button>
      <h4 data-av-title>Adjunto</h4>
      <div class="flex items-center gap-2">
        <div class="zoom-group hidden" data-av-zoom-group>
          <button type="button" data-av-zoom-out title="Zoom -">-</button>
          <button type="button" data-av-zoom-reset title="Restablecer zoom">100%</button>
          <button type="button" data-av-zoom-in title="Zoom +">+</button>
        </div>
        <a data-av-download href="#" download class="hidden" title="Descargar">Descargar</a>
        <button type="button" data-av-next title="Siguiente" class="hidden">▶</button>
        <button type="button" data-av-close title="Cerrar">Cerrar</button>
      </div>
    </div>
    <div class="attachment-viewer-body" data-av-body></div>
    <div class="attachment-viewer-thumbs" data-av-thumbs></div>
    <div class="attachment-viewer-hint">ESC / ← → / Rueda para zoom</div>
  `
  document.body.appendChild(el)
  el.addEventListener('click', ev=>{ if(ev.target===el) closeAttachmentViewer() })
  el.querySelector('[data-av-close]').addEventListener('click', ()=> closeAttachmentViewer())
  el.querySelector('[data-av-prev]').addEventListener('click', ()=> stepAttachment(-1,true))
  el.querySelector('[data-av-next]').addEventListener('click', ()=> stepAttachment(1,true))
  el.querySelector('[data-av-zoom-in]').addEventListener('click', ()=> adjustZoom(1.25))
  el.querySelector('[data-av-zoom-out]').addEventListener('click', ()=> adjustZoom(0.8))
  el.querySelector('[data-av-zoom-reset]').addEventListener('click', ()=> resetZoom())
  document.addEventListener('keydown', ev=>{ 
    if(!el.classList.contains('is-open')) return
    if(ev.key==='Escape'){ ev.stopPropagation(); return closeAttachmentViewer() }
    if(ev.key==='ArrowLeft') return stepAttachment(-1,true)
    if(ev.key==='ArrowRight') return stepAttachment(1,true)
  })
  // Zoom con rueda (solo imágenes)
  el.addEventListener('wheel', ev => {
    if(!el.classList.contains('is-open')) return
    if(!currentAttachmentContext) return
    const item = currentAttachmentContext.attachments[currentAttachmentContext.index]
    if(item?.type!=='image') return
    if(Math.abs(ev.deltaY) > 0){
      ev.preventDefault()
      const factor = ev.deltaY < 0 ? 1.15 : 0.85
      adjustZoom(factor)
    }
  }, { passive:false })
}
function openAttachmentViewer(ctx){
  mountAttachmentViewer()
  const el = document.querySelector('.attachment-viewer-overlay')
  const cliente = clientes.find(c=>c.id===ctx.clientId)
  const cita = cliente?.citas?.[ctx.citaIndex]
  if(!cita) return
  const attachments = (cita.adjuntos||[]).map(name=>({ name, type: name.toLowerCase().endsWith('.pdf')?'pdf':'image' }))
  currentAttachmentContext = {
    clientId: ctx.clientId,
    citaIndex: ctx.citaIndex,
    attachments,
    index: Math.min(Math.max(0, ctx.attachmentIndex||0), attachments.length-1)
  }
  renderCurrentAttachment()
  requestAnimationFrame(()=>{ el.classList.add('is-open') })
}
function renderCurrentAttachment(){
  if(!currentAttachmentContext) return
  const { attachments, index } = currentAttachmentContext
  const el = document.querySelector('.attachment-viewer-overlay')
  if(!el) return
  const body = el.querySelector('[data-av-body]')
  const title = el.querySelector('[data-av-title]')
  const dl = el.querySelector('[data-av-download]')
  const prevBtn = el.querySelector('[data-av-prev]')
  const nextBtn = el.querySelector('[data-av-next]')
  const item = attachments[index]
  body.textContent=''
  let src, node
  if(item.type==='pdf'){
    src = PREVIEW_PDF_SRC
    node = document.createElement('iframe')
    node.src = src
  } else {
    src = PREVIEW_IMAGE_SRC
    node = document.createElement('img')
    node.src = src
    node.alt = item.name
    node.setAttribute('data-av-img','')
  }
  body.appendChild(node)
  title.textContent = `${item.name} (${index+1}/${attachments.length})`
  dl.classList.remove('hidden')
  dl.href = src
  dl.setAttribute('download', item.name)
  if(attachments.length>1){
    prevBtn.classList.remove('hidden')
    nextBtn.classList.remove('hidden')
    prevBtn.disabled = false
    nextBtn.disabled = false
    prevBtn.style.opacity = 1
    nextBtn.style.opacity = 1
  } else {
    prevBtn.classList.add('hidden')
    nextBtn.classList.add('hidden')
  }
  renderThumbs()
  resetZoom()
  updateZoomTransform()
}
function stepAttachment(delta, loop=false){
  if(!currentAttachmentContext) return
  const { attachments } = currentAttachmentContext
  let idx = currentAttachmentContext.index + delta
  if(loop){
    if(idx < 0) idx = attachments.length - 1
    if(idx >= attachments.length) idx = 0
  } else {
    if(idx<0 || idx>=attachments.length) return
  }
  currentAttachmentContext.index = idx
  renderCurrentAttachment()
}
function renderThumbs(){
  const el = document.querySelector('.attachment-viewer-overlay')
  if(!el || !currentAttachmentContext) return
  const bar = el.querySelector('[data-av-thumbs]')
  if(!bar) return
  bar.textContent=''
  const { attachments, index } = currentAttachmentContext
  attachments.forEach((att,i)=>{
    const th = document.createElement('div')
    th.className='attachment-viewer-thumb'+(i===index?' active':'')
    th.title = att.name
    if(att.type==='pdf'){
      th.textContent='PDF'
    } else {
      const img = document.createElement('img')
      img.src = PREVIEW_IMAGE_SRC
      img.alt = att.name
      th.appendChild(img)
    }
    th.addEventListener('click', ()=>{ currentAttachmentContext.index = i; renderCurrentAttachment() })
    bar.appendChild(th)
  })
  const active = bar.querySelector('.attachment-viewer-thumb.active')
  if(active){
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if(left < bar.scrollLeft) bar.scrollLeft = left - 4
    else if(right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth + 4
  }
}
function updateZoomTransform(){
  const img = document.querySelector('.attachment-viewer-body [data-av-img]')
  const zoomGroup = document.querySelector('[data-av-zoom-group]')
  if(!img){ if(zoomGroup) zoomGroup.classList.add('hidden'); return }
  zoomGroup.classList.remove('hidden')
  img.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${currentZoom})`
  img.style.transformOrigin = 'center center'
  img.style.transition = 'transform .08s linear'
  if(currentZoom>1){ img.classList.add('attachment-viewer-zoomed'); img.style.cursor='grab' } else { img.classList.remove('attachment-viewer-zoomed'); img.style.cursor='auto' }
  const resetBtn = document.querySelector('[data-av-zoom-reset]')
  if(resetBtn) resetBtn.textContent = Math.round(currentZoom*100)+'%'
}
function adjustZoom(factor){
  const prev = currentZoom
  currentZoom = Math.min(8, Math.max(0.25, currentZoom * factor))
  if(Math.abs(currentZoom - 1) < 0.04) currentZoom = 1
  if(prev !== currentZoom) updateZoomTransform()
}
function resetZoom(){ currentZoom = 1; pan.x=0; pan.y=0; updateZoomTransform() }

document.addEventListener('mousedown', e => {
  const img = e.target.closest('.attachment-viewer-body [data-av-img]')
  if(!img) return
  if(currentZoom<=1) return
  isPanning = true
  panStart.x = e.clientX
  panStart.y = e.clientY
  panOrigin.x = pan.x
  panOrigin.y = pan.y
  img.style.cursor='grabbing'
})
document.addEventListener('mousemove', e => {
  if(!isPanning) return
  pan.x = panOrigin.x + (e.clientX - panStart.x)
  pan.y = panOrigin.y + (e.clientY - panStart.y)
  updateZoomTransform()
})
document.addEventListener('mouseup', ()=>{
  if(!isPanning) return
  isPanning=false
  const img = document.querySelector('.attachment-viewer-body [data-av-img]')
  if(img) img.style.cursor='grab'
})
document.addEventListener('mouseleave', ()=>{ if(isPanning) isPanning=false })
function cleanupZoom(){ currentZoom=1; pan.x=0; pan.y=0; isPanning=false }
function closeAttachmentViewer(){
  const el = document.querySelector('.attachment-viewer-overlay')
  if(!el) return
  el.classList.remove('is-open')
  currentAttachmentContext=null
  cleanupZoom()
}

document.addEventListener('click', e => {
  const openBtn = e.target.closest('[data-open-attachment]')
  if(!openBtn) return
  const clientId = openBtn.getAttribute('data-client-id')
  const citaIndex = parseInt(openBtn.getAttribute('data-cita-index'),10) || 0
  const attachmentIndex = parseInt(openBtn.getAttribute('data-attachment-index'),10) || 0
  openAttachmentViewer({ clientId, citaIndex, attachmentIndex })
})

export { openAttachmentViewer }
