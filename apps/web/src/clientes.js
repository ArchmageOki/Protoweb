import './style.css'
// Primera fase de modularización: utilidades y datos extraídos a ./clientes/*. Mantener API existente.
import { initClientes } from './clientes/init'
import { initSidebar } from './layout/sidebar'

// Inicializar sidebar (responsivo + colapso persistente)
initSidebar()
initClientes()

// No editar este archivo, usar ./clientes/*.js