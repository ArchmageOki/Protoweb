#!/usr/bin/env node
// Script para insertar 5 clientes de prueba en la DB
import * as pgAdapter from './src/db/pg.js';
import { nanoid } from 'nanoid';

async function main() {
  await pgAdapter.initSchema();
  // Determinar usuario destino (id o email pasados como argumento opcional)
  let userId;
  const arg = process.argv[2]
  if(arg){
    // Intentar buscar por email
    const byEmail = await pgAdapter.pgFindUserByEmail(arg)
    if(byEmail) userId = byEmail.id
    else {
      // Usar como id si existe
      const check = await pgAdapter.pgFindUserById(arg)
      if(check) userId = arg
    }
    if(!userId){
      console.error(`Usuario no encontrado para '${arg}'. Usa un email o id válido.`)
      process.exit(1)
    }
  } else {
    // Sin argumento, usar primer usuario
    const res = await pgAdapter.pool.query('SELECT id FROM users LIMIT 1');
    if (res.rows.length === 0) {
      console.error('No hay usuarios en la tabla users. Crea al menos uno.');
      process.exit(1);
    }
    userId = res.rows[0].id;
  }
  console.log('Insertando clientes para usuario:', userId)
  const sampleClients = [
    { first_name:'Juan', last_name:'Pérez', mobile:'600111222', dni:'12345678A', instagram:'@juanp', address:'Calle Falsa 123', postal_code:'28080', birth_date:'1985-04-12', visits_count:3, total_amount:120.50, last_appointment_at:new Date().toISOString(), notes:'Cliente fiel' },
    { first_name:'María', last_name:'García', mobile:'600333444', dni:'87654321B', instagram:'@mgarcia', address:'Av. Siempre Viva 742', postal_code:'28013', birth_date:'1990-11-05', visits_count:1, total_amount:45.00, last_appointment_at:new Date().toISOString(), notes:'Primera visita' },
    { first_name:'Luis', last_name:'Fernández', mobile:'600555666', dni:'11223344C', instagram:'@luisf', address:'Plaza Mayor, 1', postal_code:'28012', birth_date:'1978-02-28', visits_count:5, total_amount:320.75, last_appointment_at:new Date().toISOString(), notes:'VIP' },
    { first_name:'Ana', last_name:'Martínez', mobile:'600777888', dni:'44332211D', instagram:'@anmartinez', address:'C/. de Alcalá, 50', postal_code:'28014', birth_date:'1995-07-20', visits_count:2, total_amount:80.00, last_appointment_at:new Date().toISOString(), notes:'Recomendado por Luis' },
    { first_name:'Carlos', last_name:'López', mobile:'600999000', dni:'99887766E', instagram:'@carlosl', address:'Ronda de Atocha, 27', postal_code:'28012', birth_date:'1982-03-15', visits_count:4, total_amount:200.00, last_appointment_at:new Date().toISOString(), notes:'Pago siempre a tiempo' }
  ];
  for(const data of sampleClients) {
    const id = nanoid();
    try {
      const client = await pgAdapter.pgCreateClient(id, userId, data);
      console.log('Creado cliente:', client.id, client.full_name);
    } catch(e) {
      console.error('Error creando cliente', data.first_name, data.last_name, e.message);
    }
  }
  process.exit(0);
}

main().catch(err=>{ console.error(err); process.exit(1); });
