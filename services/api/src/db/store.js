// Persistencia sencilla en disco usando un archivo JSON.
// Objetivo: reemplazar uso directo de memory.js sin añadir dependencias nativas.
// Estructura: { users: { email -> user }, usersById: { id -> email }, refresh: { tokenId -> { userId, exp, revoked } } }
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.resolve(process.cwd(), 'services', 'api', 'data')
const DATA_FILE = path.join(DATA_DIR, 'data.json')

function ensureDir(){
	if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true })
}

let state = { users:{}, usersById:{}, refresh:{} }

function load(){
	try {
		ensureDir()
		if(fs.existsSync(DATA_FILE)){
			const raw = fs.readFileSync(DATA_FILE, 'utf8')
			const parsed = JSON.parse(raw)
			if(parsed && typeof parsed === 'object') state = { users:{}, usersById:{}, refresh:{}, ...parsed }
			// reconstruir índice usersById si falta
			if(!state.usersById || Object.keys(state.usersById).length === 0){
				state.usersById = {}
				for (const email of Object.keys(state.users)){
					const u = state.users[email]
						// tolerar datos antiguos sin id
					if(u && u.id) state.usersById[u.id] = email
				}
			}
		}
	} catch(e){
		console.error('[store] error cargando data.json', e)
	}
}

load()

let saveTimer = null
function scheduleSave(){
	if(saveTimer) return
	saveTimer = setTimeout(()=>{
		try {
			ensureDir()
			fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(state, null, 2))
			fs.renameSync(DATA_FILE + '.tmp', DATA_FILE)
		} catch(e){
			console.error('[store] error guardando', e)
		} finally {
			saveTimer = null
		}
	}, 150) // debounce 150ms
}

// Utilidades de normalización
function normEmail(email){ return email.trim().toLowerCase() }

// API pública del store
export const store = {
	getUserByEmail(email){
		return state.users[normEmail(email)] || null
	},
	getUserById(id){
		const email = state.usersById[id]
		return email ? state.users[email] : null
	},
	createUser(user){
		const email = normEmail(user.email)
		if(state.users[email]) throw new Error('email_exists')
		state.users[email] = { ...user, email }
		if(user.id) state.usersById[user.id] = email
		scheduleSave()
		return { ...state.users[email] }
	},
	saveUser(user){
		const email = normEmail(user.email)
		if(!state.users[email]) throw new Error('user_not_found')
		state.users[email] = { ...user, email }
		if(user.id) state.usersById[user.id] = email
		scheduleSave()
	},
	// Refresh tokens
	createRefresh(id, userId, exp){
		state.refresh[id] = { userId, exp, revoked:false }
		scheduleSave()
	},
	getRefresh(id){
		return state.refresh[id] || null
	},
	revokeRefresh(id){
		const rec = state.refresh[id]
		if(rec){ rec.revoked = true; scheduleSave() }
	},
	rotateRefresh(oldId){
		const rec = state.refresh[oldId]
		if(!rec || rec.revoked) return null
		const nowSec = Math.floor(Date.now()/1000)
		if (rec.exp < nowSec){ delete state.refresh[oldId]; scheduleSave(); return null }
		rec.revoked = true
		const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
		state.refresh[newId] = { userId: rec.userId, exp: rec.exp, revoked:false }
		scheduleSave()
		return { newId, userId: rec.userId, exp: rec.exp }
	}
}

	// Limpieza periódica de tokens refresh expirados o revocados antiguos
	function cleanup(){
		const nowSec = Math.floor(Date.now()/1000)
		let removed = 0
		for (const [id, rec] of Object.entries(state.refresh)){
			if(rec.exp < nowSec || (rec.revoked && rec.exp < nowSec + 60)) { // si ya expiró o revocado pasado el exp
				delete state.refresh[id]
				removed++
			}
		}
		if(removed){
			scheduleSave()
			if(process.env.NODE_ENV !== 'production') console.log('[store] cleanup refresh eliminados:', removed)
		}
	}

	setInterval(cleanup, 60_000).unref()
