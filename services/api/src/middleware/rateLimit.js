// Rate limiting muy simple en memoria (por IP + ruta clave)
// Para entorno de producción migrar a un store distribuido (Redis) y usar algoritmos tipo token bucket/leaky bucket.

const buckets = new Map() // key -> { count, reset }

function key(ip, name){
  return ip+'|'+name
}

export function rateLimit({ windowMs=60_000, max=30, name='global' }={}){
  return (req,res,next)=>{
    const ip = req.ip || req.connection.remoteAddress || 'unknown'
    const k = key(ip, name)
    const now = Date.now()
    let b = buckets.get(k)
    if(!b || b.reset < now){ b = { count:0, reset: now + windowMs }; buckets.set(k,b) }
    b.count++
    if(b.count > max){
      const retry = Math.ceil((b.reset - now)/1000)
      res.setHeader('Retry-After', retry)
      return res.status(429).json({ error:'rate_limited', retry_after: retry })
    }
    next()
  }
}

// Variante con escalado para protección de login (window corta + límite bajo)
export const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, name:'login' })
export const registerLimiter = rateLimit({ windowMs: 60_000, max: 6, name:'register' })
