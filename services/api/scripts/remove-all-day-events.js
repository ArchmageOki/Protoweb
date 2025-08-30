// Script para limpiar eventos all-day previamente guardados en calendar_events.
// Uso: node services/api/scripts/remove-all-day-events.js
// Requiere variables de entorno PG_* y DB_BACKEND=pg ya configuradas.
import { initSchema } from '../src/db/pg.js'
import { createPool } from '../src/db/pg.js'

async function run(){
  await initSchema()
  const { pool } = await import('../src/db/pg.js')
  const client = await pool.connect()
  try {
    const { rowCount } = await client.query('delete from calendar_events where all_day = true')
    console.log('Eventos all-day eliminados:', rowCount)
  } finally {
    client.release()
  }
  process.exit(0)
}

run().catch(e=>{ console.error('Error limpiando all-day', e); process.exit(1) })
