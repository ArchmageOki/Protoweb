// Generación de datos mock y catálogo
import { randomDate } from './utils-fechas'

const nombres = ['Laura','Marco','Lucía','Carlos','Sofía','Javier','Marta','Andrés','Elena','Pablo','Clara','David','Nuria','Hugo','Paula','Raúl','Irene','Adrián','Noelia','Sergio','Celia','Iván','Patricia','Gonzalo','Alba','Rubén','Aitana','Diego','Sara']
const apellidos1 = ['García','López','Martínez','Sánchez','Pérez','Gómez','Fernández','Díaz','Ruiz','Hernández','Jiménez','Iglesias','Vargas','Castro','Navarro','Romero','Torres','Domínguez','Vega','Cortés']
const apellidos2 = ['Ruiz','Díaz','López','García','Santos','del Río','Prieto','Lorenzo','Gallardo','Benítez','Suárez','Mendoza','Blanco','León','Marín','Campos','Aguilar','Bravo','Caballero','Fuentes']
const notasPool = ['','Prefiere mañanas','Alergia leve a látex','Color piel II','Tatuaje previo','Sesión larga','Necesita recordatorio','Pago parcial','Revisión pendiente','Traer referencia']
const tiposVia = ['Calle','Avda.','Paseo','Camino','Plaza']
const nombresVia = ['Sol','Luna','Mar','Olivo','Encina','Rosal','Real','Castilla','Mayor','Nueva','Centro','Jardín','Río','Álamo']

function randomItem(arr){ return arr[Math.floor(Math.random()*arr.length)] }

export function makeCliente(i){
  const nombre = randomItem(nombres)
  const a1 = randomItem(apellidos1)
  const a2 = randomItem(apellidos2)
  const movil = String(Math.floor(600000000 + Math.random()*399999999))
  const instaHandle = (nombre+a1).toLowerCase().replace(/[^a-z]/g,'')
  const dni = `${String(Math.floor(10000000 + Math.random()*89999999))}${'TRWAGMYFPDXBNJZSQVHLCKE'[Math.floor(Math.random()*23)]}`
  const direccion = `${randomItem(tiposVia)} ${randomItem(nombresVia)} ${Math.floor(Math.random()*120)+1}`
  const codigoPostal = String(Math.floor(Math.random()*90000)+10000)
  const nacimiento = randomDate(1975,2005)
  const lastDate = new Date(Date.now() - Math.floor(Math.random()*360)*86400000)
  const nota = randomItem(notasPool)
  const visitas = Math.floor(Math.random()*15)+1
  const citas = []
  let refDate = new Date(lastDate)
  for(let k=0;k<visitas;k++){
    const d = new Date(refDate)
    refDate = new Date(refDate.getTime() - (7 + Math.floor(Math.random()*33))*86400000)
    const priceTotal = Number((50 + Math.random()*200).toFixed(2))
    const pricePaid = Math.random()<0.25 ? Number((priceTotal * (0.3 + Math.random()*0.5)).toFixed(2)) : priceTotal
    citas.push({ fecha: d, notas: randomItem(notasPool) || '—', adjuntos: Math.random()<0.3 ? [ 'foto_'+(1+Math.floor(Math.random()*3))+'.png' ] : [], priceTotal, pricePaid })
  }
  citas.sort((a,b)=> b.fecha - a.fecha)
  if(citas.length){
    if(!citas[0].adjuntos.includes('Prueba.jpg')) citas[0].adjuntos.unshift('Prueba.jpg')
    if(!citas[0].adjuntos.includes('Prueba.pdf')) citas[0].adjuntos.push('Prueba.pdf')
  }
  const dineroTotal = citas.reduce((sum,c)=> sum + (c.priceTotal||0), 0)
  return {
    id: 'c'+i,
    nombre,
    apellidos: `${a1} ${a2}`,
    movil,
    instagram: '@'+instaHandle,
    dni,
    direccion,
    codigoPostal,
    nacimiento,
    visitas,
    dineroTotal: Number(dineroTotal.toFixed(2)),
    ultimaCita: lastDate,
    citas,
    notas: nota
  }
}

export const clientes = Array.from({length:100}, (_,i)=> makeCliente(i+1))
