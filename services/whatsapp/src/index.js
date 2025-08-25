import whatsappPkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { EventEmitter } from 'events';

// Compatibilidad CommonJS: desestructurar exports
const { Client, LocalAuth, MessageMedia } = whatsappPkg;

// Gestión multi-cliente en memoria (phone -> { client, state, pairingCode })
const clients = new Map();

// Estados posibles: idle | pairing | qr | ready | disconnected | auth_failure

// Limpieza robusta de carpeta de sesión (maneja EBUSY en Windows)
async function removeDirRecursive(target, retries = 5, delayMs = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(target)) {
        await fs.promises.rm(target, { recursive: true, force: true });
      }
      return true;
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  return !fs.existsSync(target);
}

async function cleanSession(phone) {
  const sessionDir = path.join(process.cwd(), '.wwebjs_auth', `session-${phone}`);
  const cacheDir = path.join(process.cwd(), '.wwebjs_cache', `session-${phone}`);
  try {
    await removeDirRecursive(sessionDir);
    await removeDirRecursive(cacheDir);
    console.log('[whatsapp]', phone, 'Carpeta de sesión eliminada');
  } catch (e) {
    console.warn('[whatsapp]', phone, 'No se pudo eliminar carpeta de sesión:', e.message || e);
  }
}

async function cleanAllSessions() {
  console.log('[whatsapp] Limpieza global de sesiones iniciada');
  // Destruir clientes activos
  for (const entry of clients.values()) {
    try { await entry.client?.destroy(); } catch {}
  }
  clients.clear();
  const authRoot = path.join(process.cwd(), '.wwebjs_auth');
  const cacheRoot = path.join(process.cwd(), '.wwebjs_cache');
  try { await removeDirRecursive(authRoot); } catch (e) { console.warn('[whatsapp] No se pudo borrar auth root:', e.message||e); }
  try { await removeDirRecursive(cacheRoot); } catch (e) { console.warn('[whatsapp] No se pudo borrar cache root:', e.message||e); }
  console.log('[whatsapp] Limpieza global finalizada');
}

async function createOrGetClient(phone, opts = {}) {
  phone = phone.replace(/[^0-9]/g, '');
  if (!phone) throw new Error('Número inválido');
  const existing = clients.get(phone);
  const REUSABLE_STATES = new Set(['idle','pairing','qr','ready','initializing']);
  if (existing?.state && REUSABLE_STATES.has(existing.state) && !opts.forceReset) return existing;
  if (existing && (!REUSABLE_STATES.has(existing.state) || opts.forceReset)) {
    try { await existing.client?.destroy(); } catch {}
    await cleanSession(phone);
    clients.delete(phone);
  }


  // Headless false por defecto (a menos que WHATSAPP_HEADLESS=1 o se pase en opts)
  const headless = (typeof opts.headless === 'boolean') ? opts.headless : (process.env.WHATSAPP_HEADLESS === '1');
  // Entrada inicial
  const entry = { state: 'idle', qr: null, phone, client: null, mode: 'qr', bus: new EventEmitter(), streams: new Set() };
  clients.set(phone, entry);

  const authStrategy = new LocalAuth({ clientId: phone });
  const baseConfig = {
    authStrategy,
    puppeteer: { headless, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
  };

  function wireEvents(c){
    c.on('qr', (qr) => {
      entry.qr = qr; entry.state = 'qr';
      console.log('[whatsapp]', phone, 'QR disponible');
      if (process.env.SHOW_QR === '1') qrcode.generate(qr, { small: true });
    });
    c.on('ready', () => {
      entry.state = 'ready';
      console.log('[whatsapp]', phone, 'READY');
      // Pre-cargar chats (warming) para evitar lista vacía inicial
      (async () => {
        for (let i=0;i<6;i++) {
          try {
            const chats = await entry.client.getChats();
            if (chats?.length) {
              console.log('[whatsapp]', phone, 'Chats precargados:', chats.length);
              break;
            }
          } catch {}
          await new Promise(r => setTimeout(r, 1000));
        }
      })();
      // Persistir como último usado
      try {
        const metaDir = path.join(process.cwd(), '.wwebjs_auth');
        fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(path.join(metaDir, 'last-used.json'), JSON.stringify({ phone, ts: Date.now() }, null, 2));
      } catch (e) {
        console.warn('[whatsapp]', phone, 'No se pudo escribir last-used.json', e.message || e);
      }
    });
    c.on('authenticated', () => { console.log('[whatsapp]', phone, 'AUTHENTICATED'); });
    c.on('auth_failure', (m) => { entry.state = 'auth_failure'; console.error('[whatsapp]', phone, 'AUTH FAILURE', m); });
    c.on('disconnected', async (reason) => {
      console.warn('[whatsapp]', phone, 'DISCONNECTED', reason);
      entry.state = 'disconnected';
      try { await entry.client?.destroy(); } catch {}
      await cleanSession(phone);
      // Auto re-init: pequeño retardo para evitar loops rápidos
      setTimeout(async ()=>{
        if(entry.state !== 'disconnected') return; // ya cambiado quizá por reset manual
        console.log('[whatsapp]', phone, 'Intentando auto reinicialización tras disconnect');
        try {
          const newEntry = await createOrGetClient(phone, { headless: true, forceReset: false });
          console.log('[whatsapp]', phone, 'Auto reinicio lanzado, estado:', newEntry.state);
        } catch(e){ console.error('[whatsapp]', phone, 'Fallo auto reinicio:', e.message||e); }
      }, 3000);
    });
    c.on('message', async (msg) => {
      if (msg.body?.toLowerCase() === 'ping') await msg.reply('pong');
      // Emitir actualización de chat y mensaje nuevo (solo si no es nuestro para evitar duplicar optimistas)
      try {
        const chat = await msg.getChat();
        const summary = buildChatSummary(chat);
        if(summary){
          entry.bus.emit('chat_update', summary);
          if(!msg.fromMe){
            entry.bus.emit('message_new', { chatId: summary.id, message: simplifyMessage(msg) });
          }
        }
      } catch {}
    });
  }

  let client;
  try {
    // Solo QR: no pasamos pairWithPhoneNumber
    client = new Client(baseConfig);
  } catch (e) {
    console.error('[whatsapp]', phone, 'No se pudo crear cliente:', e?.message || e);
    entry.state = 'error';
    return entry;
  }

  entry.client = client;
  entry.state = 'initializing';
  wireEvents(client);
  try {
    await client.initialize();
  } catch (e) {
  const msg = e?.message || String(e);
  console.error('[whatsapp]', phone, 'Fallo inicializando cliente:', msg);
  entry.state='error';
  }
  return entry;
}

// Servidor HTTP
const app = express();
// Límite ampliado para permitir payloads base64 de imágenes/documentos.
// Configurable vía WHATSAPP_JSON_LIMIT (ej: '25mb')
// Nota: PDFs y otros documentos crecen ~33% al codificarse en base64. Ajusta según tus necesidades.
const JSON_LIMIT = process.env.WHATSAPP_JSON_LIMIT || '50mb';
app.use(express.json({ limit: JSON_LIMIT }));
// Multer para multipart (archivos grandes sin inflar base64 innecesariamente)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: (parseInt(process.env.WHATSAPP_MEDIA_MAX_MB||'45') * 1024 * 1024) } });

// CORS mínimo para desarrollo
app.use((req,res,next)=>{ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); if(req.method==='OPTIONS') return res.end(); next(); });

app.get('/whatsapp/status', (req,res)=>{
  const phone = (req.query.phone||'').toString().replace(/[^0-9]/g,'');
  if (phone) {
    const entry = clients.get(phone);
    if(!entry) return res.json({ phone, state: 'absent' });
  return res.json({ phone, state: entry.state, qr: entry.state==='qr' ? entry.qr : null });
  }
  // listado
  const list = Array.from(clients.values()).map(e => ({ phone: e.phone, state: e.state }));
  res.json({ clients: list });
});

app.post('/whatsapp/start', async (req,res)=>{
  try {
    const phone = (req.body?.phone||'').toString();
    const headless = req.body?.headless !== undefined ? !!req.body.headless : true;
  const forceReset = !!req.body?.reset;
    if(!phone) return res.status(400).json({ error: 'phone requerido' });
  const entry = await createOrGetClient(phone, { headless, forceReset });
  res.json({ phone: entry.phone, state: entry.state, qr: entry.state==='qr' ? entry.qr : null, headless, mode: entry.mode });
  } catch (e) {
    res.status(500).json({ error: e.message || 'error' });
  }
});

app.post('/whatsapp/logout', async (req,res)=>{
  const phone = (req.body?.phone||'').toString().replace(/[^0-9]/g,'');
  if(!phone) return res.status(400).json({ error: 'phone requerido' });
  const entry = clients.get(phone);
  if(!entry) return res.status(404).json({ error: 'no existe sesión' });
  try {
    await entry.client?.destroy();
  } catch {}
  await cleanSession(phone);
  clients.delete(phone);
  res.json({ phone, state: 'destroyed' });
});

// Forzar limpieza sin tener cliente en memoria
app.post('/whatsapp/reset', async (req,res)=>{
  const phone = (req.body?.phone||'').toString().replace(/[^0-9]/g,'');
  if(!phone) return res.status(400).json({ error: 'phone requerido' });
  const entry = clients.get(phone);
  if (entry) {
    try { await entry.client?.destroy(); } catch {}
    clients.delete(phone);
  }
  await cleanSession(phone);
  res.json({ phone, state: 'reset' });
});

// Reset global
app.post('/whatsapp/reset-all', async (_req,res)=>{
  await cleanAllSessions();
  res.json({ ok: true, state: 'all_reset' });
});

// Enviar mensaje simple
app.post('/whatsapp/send', async (req,res)=>{
  const { phone, to, message } = req.body || {};
  if(!phone || !to || !message) return res.status(400).json({ error: 'phone, to, message requeridos' });
  const entry = clients.get(String(phone));
  if(!entry || entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo' });
  try {
    const jid = to.includes('@c.us') ? to : to.replace(/[^0-9]/g,'') + '@c.us';
    await entry.client.sendMessage(jid, message);
    res.json({ ok: true });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló envío' });
  }
});

// Cache simple en memoria para avatares: phone -> { chatId: { ts, dataUrl } }
const avatarCache = new Map();

// Obtener avatar (profile picture) de un chat/contacto. Devuelve dataURL base64.
app.get('/whatsapp/chat-avatar', async (req,res)=>{
  try {
    const phone = (req.query.phone||'').toString().replace(/[^0-9]/g,'');
    const chatId = (req.query.chatId||'').toString();
    if(!phone || !chatId) return res.status(400).json({ error: 'phone y chatId requeridos' });
    const entry = clients.get(phone);
    if(!entry) return res.status(404).json({ error: 'no existe cliente' });
    if(entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo', state: entry.state });
    // Cache por 10 minutos
    const TEN_MIN = 10*60*1000;
    let phoneCache = avatarCache.get(phone);
    if(!phoneCache){ phoneCache = {}; avatarCache.set(phone, phoneCache); }
    const cached = phoneCache[chatId];
    if(cached && (Date.now() - cached.ts) < TEN_MIN){
      return res.json({ chatId, avatar: cached.dataUrl, cached: true });
    }
    let url;
    try {
      // whatsapp-web.js permite client.getProfilePicUrl(jid)
      url = await entry.client.getProfilePicUrl(chatId);
    } catch(e){ /* puede fallar si no hay foto */ }
    if(!url){
      // Sin avatar, devolver placeholder nulo
      return res.json({ chatId, avatar: null });
    }
    // Descargar y convertir a base64
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } catch(e){
      clearTimeout(timeout);
      return res.json({ chatId, avatar: null });
    }
    clearTimeout(timeout);
    if(!resp.ok){ return res.json({ chatId, avatar: null }); }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mime = resp.headers.get('content-type') || 'image/jpeg';
    const b64 = buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;
    phoneCache[chatId] = { ts: Date.now(), dataUrl };
    res.json({ chatId, avatar: dataUrl });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló avatar' });
  }
});

// Enviar media (imagen/documento) con caption opcional
app.post('/whatsapp/send-media', async (req,res)=>{
  try {
  const { phone, to, filename, mimetype, data, caption } = req.body || {};
    if(!phone || !to || !filename || !mimetype || !data) return res.status(400).json({ error: 'phone, to, filename, mimetype, data requeridos' });
    const entry = clients.get(String(phone));
    if(!entry || entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo' });
    // Validación de tamaño (aprox). data es base64 -> calcular bytes reales
    const mediaMaxMB = parseInt(process.env.WHATSAPP_MEDIA_MAX_MB || '45');
    try {
      const bytes = Buffer.byteLength(data, 'base64');
      const mb = bytes / (1024*1024);
      console.log('[whatsapp]', phone, 'upload media', { filename, mimetype, sizeMB: mb.toFixed(2) });
      if (mb > mediaMaxMB) {
        return res.status(413).json({ error: 'archivo demasiado grande', maxMB: mediaMaxMB, sizeMB: mb.toFixed(2) });
      }
    } catch {}
    const jid = to.includes('@c.us') ? to : to.replace(/[^0-9]/g,'') + '@c.us';
    const media = new MessageMedia(mimetype, data, filename);
    await entry.client.sendMessage(jid, media, { caption: caption || '' });
    res.json({ ok: true });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló envío media' });
  }
});

// Variante multipart para envíos con barra de progreso en frontend
app.post('/whatsapp/send-media-mp', upload.single('file'), async (req,res)=>{
  try {
    const { phone, to, caption } = req.body || {};
    if(!phone || !to || !req.file) return res.status(400).json({ error: 'phone, to, file requeridos' });
    const entry = clients.get(String(phone));
    if(!entry || entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo' });
    const jid = to.includes('@c.us') ? to : to.replace(/[^0-9]/g,'') + '@c.us';
    const b64 = req.file.buffer.toString('base64');
    const media = new MessageMedia(req.file.mimetype, b64, req.file.originalname);
    await entry.client.sendMessage(jid, media, { caption: caption || '' });
    res.json({ ok: true, filename: req.file.originalname, size: req.file.size });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló envío media multipart' });
  }
});

// Utilidades para formar datos consistentes
function buildChatSummary(c){
  const sid = c.id?._serialized || '';
  const server = c.id?.server || '';
  if (sid === 'status@broadcast') return null; // estados
  if (server === 'broadcast') return null; // listas difusión
  if (c.isStatus) return null;
  return {
    id: c.id?._serialized,
    name: c.name || c.pushname || c.id?.user,
    isGroup: !!c.isGroup,
    unreadCount: c.unreadCount || 0,
    lastMessage: c.lastMessage ? {
      id: c.lastMessage.id?.id,
      fromMe: c.lastMessage.fromMe,
      body: c.lastMessage.body?.slice(0,200) || '',
      timestamp: c.lastMessage.timestamp
    } : null
  };
}

function simplifyMessage(m){
  let displayBody;
  // Para conservar caption en media: usar caption si existe, si no fallback a body (en imágenes body suele contener caption)
  if(m.type === 'chat') displayBody = m.body || '';
  else if(m.type === 'image') displayBody = m.caption || m.body || '';
  else if(m.type === 'document') {
    // Mostrar filename; el caption se enviará aparte (campo caption) y el frontend lo añadirá debajo
    displayBody = m.filename || '[documento]';
  } else displayBody = `[${m.type}]`;
  return {
    id: m.id?.id,
    fromMe: m.fromMe,
    author: m.author || null,
    timestamp: m.timestamp,
    type: m.type,
    body: displayBody,
    caption: m.caption || null,
    hasMedia: !!m.hasMedia,
    mimetype: m.mimetype || null,
    filename: m.filename || null,
    filesize: m.filesize || null
  };
}

// Endpoint SSE para eventos en tiempo real
app.get('/whatsapp/events', (req,res)=>{
  const phone = (req.query.phone||'').toString().replace(/[^0-9]/g,'');
  if(!phone) return res.status(400).json({ error: 'phone requerido' });
  const entry = clients.get(phone);
  if(!entry) return res.status(404).json({ error: 'no existe cliente' });
  if(entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo', state: entry.state });
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.flushHeaders?.();

  function send(evt, data){
    try { res.write(`event: ${evt}\n`+`data: ${JSON.stringify(data)}\n\n`); } catch {}
  }

  // Registrar listeners
  const onChatUpdate = (summary)=> send('chat_update', summary);
  const onMessageNew = (payload)=> send('message_new', payload);
  entry.bus.on('chat_update', onChatUpdate);
  entry.bus.on('message_new', onMessageNew);
  entry.streams.add(res);

  // Enviar lista inicial
  (async ()=>{
    try {
      const chats = await entry.client.getChats();
      const data = chats
        .sort((a,b)=> (b.lastMessage?.timestamp||0)-(a.lastMessage?.timestamp||0))
        .slice(0,200)
        .map(buildChatSummary)
        .filter(Boolean);
      send('chat_list', { chats: data });
    } catch {}
  })();

  req.on('close', ()=>{
    entry.bus.off('chat_update', onChatUpdate);
    entry.bus.off('message_new', onMessageNew);
    entry.streams.delete(res);
    try { res.end(); } catch {}
  });
});

// Listado de chats recientes
app.get('/whatsapp/chats', async (req,res)=>{
  try {
    const phone = (req.query.phone||'').toString().replace(/[^0-9]/g,'');
    if(!phone) return res.status(400).json({ error: 'phone requerido' });
    const entry = clients.get(phone);
    if(!entry) return res.status(404).json({ error: 'no existe cliente' });
    if(entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo', state: entry.state });
    const limit = Math.min(parseInt(req.query.limit)||50, 200);
    let chats = await entry.client.getChats();
    if (!chats || !chats.length) {
      // Reintento rápido tras breve espera para casos de lista aún no sincronizada
      await new Promise(r=>setTimeout(r, 1200));
      try { chats = await entry.client.getChats(); } catch {}
    }
    // Ordenar por timestamp de último mensaje
    chats.sort((a,b)=>{
      const ta = a.lastMessage?.timestamp || 0;
      const tb = b.lastMessage?.timestamp || 0;
      return tb - ta;
    });
  const data = chats.slice(0, limit).map(buildChatSummary).filter(Boolean);
  console.log('[whatsapp]', phone, 'GET /whatsapp/chats ->', data.length);
  res.json({ phone, chats: data, empty: !data.length });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló listado chats' });
  }
});

// Historial de mensajes de un chat
app.get('/whatsapp/messages', async (req,res)=>{
  try {
    const phone = (req.query.phone||'').toString().replace(/[^0-9]/g,'');
    const chatId = (req.query.chatId||'').toString();
    const beforeTs = req.query.beforeTs ? parseInt(req.query.beforeTs) : null; // timestamp (segundos) de corte
    if(!phone || !chatId) return res.status(400).json({ error: 'phone y chatId requeridos' });
    const entry = clients.get(phone);
    if(!entry) return res.status(404).json({ error: 'no existe cliente' });
    if(entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo', state: entry.state });
    const limit = Math.min(parseInt(req.query.limit)||50, 200);
    let chat;
    try { chat = await entry.client.getChatById(chatId); } catch { return res.status(404).json({ error: 'chat no encontrado' }); }
    // Para paginación hacia atrás: ampliar progresivamente el fetch hasta tener mensajes más antiguos que beforeTs
  // fetchSize reducido para primera carga (solo lo solicitado) para mejorar latencia
  let fetchSize = beforeTs ? Math.min(limit * 4, 500) : limit;
    const MAX_FETCH = 2000; // salvaguarda
    let raw = await chat.fetchMessages({ limit: fetchSize });
    // Si necesitamos mensajes más antiguos que beforeTs y no aparecen, aumentar ventana
    if(beforeTs){
      let oldestSeen = raw.reduce((min, m)=> m.timestamp && m.timestamp < min ? m.timestamp : min, Number.MAX_SAFE_INTEGER);
      while(oldestSeen >= beforeTs && raw.length < MAX_FETCH){
        fetchSize = Math.min(fetchSize * 2, MAX_FETCH);
        raw = await chat.fetchMessages({ limit: fetchSize });
        oldestSeen = raw.reduce((min, m)=> m.timestamp && m.timestamp < min ? m.timestamp : min, Number.MAX_SAFE_INTEGER);
        if(fetchSize >= MAX_FETCH) break;
      }
    }
    let filtered = raw.filter(m => m.timestamp);
    if(beforeTs){
      filtered = filtered.filter(m => (m.timestamp || 0) < beforeTs);
    }
    // Orden descendente para seleccionar bloque de página
    filtered.sort((a,b)=> (b.timestamp||0) - (a.timestamp||0));
    const slice = filtered.slice(0, limit);
    const hasMore = filtered.length > slice.length; // quedan aún más antiguos
    slice.sort((a,b)=> (a.timestamp||0) - (b.timestamp||0));
    const data = slice.map(simplifyMessage);
    res.json({ phone, chatId, messages: data, hasMore, oldestTs: data.length ? data[0].timestamp : null });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló historial mensajes' });
  }
});

// Descargar media de un mensaje (base64)
app.get('/whatsapp/message-media', async (req,res)=>{
  try {
    const phone = (req.query.phone||'').toString().replace(/[^0-9]/g,'');
    const chatId = (req.query.chatId||'').toString();
    const messageId = (req.query.messageId||'').toString();
    if(!phone || !chatId || !messageId) return res.status(400).json({ error: 'phone, chatId, messageId requeridos' });
    const entry = clients.get(phone);
    if(!entry) return res.status(404).json({ error: 'no existe cliente' });
    if(entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo', state: entry.state });
    let chat; try { chat = await entry.client.getChatById(chatId); } catch { return res.status(404).json({ error: 'chat no encontrado' }); }
    // Buscar el mensaje (búsqueda incremental)
    let batchSize = 50; let found = null; let safety = 0;
    while(!found && safety < 5){
      const msgs = await chat.fetchMessages({ limit: batchSize });
      found = msgs.find(m => m.id?.id === messageId);
      if(found || msgs.length < batchSize) break;
      batchSize *= 2; safety++;
    }
    if(!found) return res.status(404).json({ error: 'mensaje no encontrado' });
    if(!found.hasMedia) return res.status(400).json({ error: 'mensaje sin media' });
    let media;
    try { media = await found.downloadMedia(); } catch(e){ return res.status(500).json({ error: 'no se pudo descargar media' }); }
    // media: { data (base64), mimetype, filename }
    res.json({ mimetype: media.mimetype, filename: media.filename || found.filename || null, data: media.data });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló obtener media' });
  }
});

const PORT = process.env.WHATSAPP_PORT || 4001;
app.listen(PORT, ()=>{
  console.log('[whatsapp] API escuchando en puerto', PORT);
  const initialPhone = (process.env.WHATSAPP_PHONE || '').replace(/[^0-9]/g,'');
  const autoRestore = process.env.WHATSAPP_AUTORESTORE !== '0';
  if (initialPhone) {
    console.log('[whatsapp] Arrancando número inicial', initialPhone);
    createOrGetClient(initialPhone, { headless: process.env.WHATSAPP_HEADLESS !== '0' });
  }
  if (autoRestore) {
    try {
      const authRoot = path.join(process.cwd(), '.wwebjs_auth');
      const metaFile = path.join(authRoot, 'last-used.json');
      if (fs.existsSync(metaFile)) {
        const { phone: lastPhone } = JSON.parse(fs.readFileSync(metaFile,'utf8')) || {};
        if (lastPhone && (!initialPhone || lastPhone !== initialPhone)) {
          console.log('[whatsapp] Restaurando última sesión usada:', lastPhone);
          createOrGetClient(String(lastPhone), { headless: process.env.WHATSAPP_HEADLESS !== '0' });
        } else if (!lastPhone) {
          console.log('[whatsapp] last-used.json sin phone válido');
        }
      } else {
        console.log('[whatsapp] No existe last-used.json; no se restaura');
      }
    } catch (e) {
      console.warn('[whatsapp] Error durante autoRestore última sesión:', e.message || e);
    }
  } else {
    console.log('[whatsapp] Auto-restore desactivado (WHATSAPP_AUTORESTORE=0)');
  }
});

// Handlers globales para evitar caída total por errores no capturados
let handlersRegistered = false;
if (!handlersRegistered){
  handlersRegistered = true;
  process.on('unhandledRejection', (reason) => {
    console.error('[whatsapp] UnhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[whatsapp] UncaughtException (continuando):', err);
  });
}
