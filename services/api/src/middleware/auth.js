import { verifyAccess } from '../auth/token.js'

export function requireAuth(req,res,next){
  const hdr = req.headers.authorization || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
  if(!token) return res.status(401).json({ error:'missing_token' })
  const payload = verifyAccess(token)
  if(!payload) return res.status(401).json({ error:'invalid_token' })
  req.user = { id: payload.sub, ver: payload.ver }
  req.accessToken = token
  next()
}
