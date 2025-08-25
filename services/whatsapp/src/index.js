import express from 'express';

// Servidor base limpio (placeholder) para nuevo módulo de mensajería
const app = express();
app.use(express.json());

app.get('/health', (_req,res)=> res.json({ ok:true, service:'mensajes-core', version:1 }));

// Placeholder endpoints (por definir en el nuevo diseño)
app.get('/messages', (_req,res)=> res.json({ items: [], note: 'Endpoint placeholder; implementar capa de campañas/envíos.' }));

// Fallback 404
app.use((req,res)=> res.status(404).json({ error:'not_found', path:req.path }));

const PORT = process.env.PORT || 4001;
app.listen(PORT, ()=> console.log('[mensajes-core] Servicio limpio escuchando en puerto', PORT));
