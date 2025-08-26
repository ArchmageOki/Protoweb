// Inicialización de la tabla de clientes (bootstrap logic extraída)
// Idempotente: se puede llamar varias veces sin duplicar listeners
import { filtered, setPageSize, setCurrentPage, setFiltered } from './state'
import { renderClientes, toggleSort } from './render'
import { aplicarFiltros } from './filters'
import { cargarClientes, clientes } from './data'
import { nuevoCliente, editarCliente } from './editor'
import './attachments' // side-effects (visor de adjuntos)

let _inited = false

export function initClientes(){
  if(_inited) return
  const run = () => {
    if(_inited) return
    _inited = true
    // Cargar datos reales y luego aplicar filtros
    cargarClientes().then(()=>{
      setFiltered(window.__clientes_debug = [...clientes])
      aplicarFiltros()
    })
    // Sort headers (delegación)
    const thead = document.querySelector('thead')
    thead?.addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]')
      if(!th) return
      toggleSort(th.getAttribute('data-sort'))
    })
    // Page size selector
    const sizeSel = document.getElementById('clientes-page-size')
    sizeSel?.addEventListener('change', () => {
      const ps = parseInt(sizeSel.value,10) || 50
      setPageSize(ps)
      setCurrentPage(1)
      renderClientes(filtered)
    })
    // Paginación
    document.addEventListener('click', e => {
      const btn = e.target.closest('#clientes-pagination button[data-page]')
      if(!btn) return
      const p = parseInt(btn.getAttribute('data-page'),10)
      if(!isNaN(p)){
        setCurrentPage(p)
        renderClientes(filtered)
      }
    })
    // Click en fila -> editar
    document.addEventListener('click', e => {
      const tr = e.target.closest('tr.cliente-row')
      if(!tr) return
      if(e.target.closest('a')) return
      editarCliente(tr.dataset.id)
    })
    // Botón nuevo cliente
    const btnNuevo = document.getElementById('cliente-add')
    btnNuevo?.addEventListener('click', e => { e.preventDefault(); nuevoCliente() })
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true })
  else run()
}
