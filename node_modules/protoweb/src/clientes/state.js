// Estado compartido para clientes
import { clientes } from './data'

export let filtered = clientes.slice() // se actualizará tras carga API
export const columnFilters = {}
export const sortState = { key: null, dir: 1 }
export let pageSize = 10
export let currentPage = 1

export function setFiltered(list){ filtered = list }
export function setPageSize(ps){ pageSize = ps }
export function setCurrentPage(p){ currentPage = p }
