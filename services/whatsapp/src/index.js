import express from 'express'
import pkg from 'whatsapp-web.js'
import QRCode from 'qrcode'
import jwt from 'jsonwebtoken'
const { Client, LocalAuth } = pkg

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change'

const app = express()
app.use(express.json())

// Multitenant: cada userId -> instancia + estado
const sessions = new Map() // userId -> { client, status, lastQrDataUrl, initializing }

function authMiddleware(req,res,next){
	const hdr = req.headers.authorization || ''
	const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
	if(!token) return res.status(401).json({ error:'missing_token' })
	try {
		const payload = jwt.verify(token, JWT_ACCESS_SECRET)
		req.user = { id: payload.sub, ver: payload.ver }
		next()
	} catch { return res.status(401).json({ error:'invalid_token' }) }
}

async function ensureSession(userId, force=false){
	let entry = sessions.get(userId)
	if(entry && !force){
		if(entry.initializing) return entry.initializing
		return entry
	}
	if(entry && force){
		try { await entry.client.destroy() } catch {}
		sessions.delete(userId)
	}
	const newEntry = { client:null, status:'INITIALIZING', lastQrDataUrl:null, initializing:null }
	sessions.set(userId, newEntry)
	const client = new Client({ authStrategy: new LocalAuth({ clientId: 'user_'+userId }), puppeteer:{ headless:true } })
	newEntry.client = client

	client.on('qr', async qr => {
		newEntry.status = 'QR'
		try { newEntry.lastQrDataUrl = await QRCode.toDataURL(qr) } catch(e){ console.error('[whatsapp]['+userId+'] QR gen error', e) }
	})
	client.on('ready', ()=> { newEntry.status='CONNECTED'; newEntry.lastQrDataUrl=null; console.log('[whatsapp]['+userId+'] READY') })
	client.on('authenticated', ()=> console.log('[whatsapp]['+userId+'] authenticated'))
	client.on('auth_failure', msg=> { console.error('[whatsapp]['+userId+'] auth_failure', msg); newEntry.status='DISCONNECTED' })
	client.on('disconnected', reason=> { console.warn('[whatsapp]['+userId+'] disconnected', reason); newEntry.status='DISCONNECTED' })

	newEntry.initializing = client.initialize().catch(err=>{ console.error('[whatsapp]['+userId+'] init error', err); newEntry.status='DISCONNECTED' }).finally(()=>{ newEntry.initializing=null })
	return newEntry.initializing
}

app.get('/health', (_req,res)=> res.json({ ok:true, service:'whatsapp', tenants: sessions.size }))

// Iniciar (o reutilizar) sesión para el usuario autenticado
app.post('/whatsapp/session/start', authMiddleware, async (req,res)=>{
	try {
		await ensureSession(req.user.id)
		res.json({ ok:true, starting:true })
	} catch(e){ res.status(500).json({ error:'init_failed' }) }
})

app.get('/whatsapp/status', authMiddleware, (req,res)=>{
	const s = sessions.get(req.user.id)
	if(!s) return res.json({ status:'NO_SESSION' })
	res.json({ status: s.status, qr: s.status==='QR' ? (s.lastQrDataUrl||null) : null })
})

app.post('/whatsapp/reset', authMiddleware, async (req,res)=>{
	try {
		await ensureSession(req.user.id, true)
		res.json({ ok:true, resetting:true })
	} catch(e){ res.status(500).json({ error:'reset_failed' }) }
})

// 404
app.use((req,res)=> res.status(404).json({ error:'not_found', path:req.path }))

const PORT = process.env.PORT || 4001
app.listen(PORT, ()=> console.log('[whatsapp] Servicio multi-tenant escuchando en puerto', PORT))
