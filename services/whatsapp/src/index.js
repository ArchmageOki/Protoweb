import whatsappPkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';
import path from 'path';

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
  if (existing?.state && existing.state !== 'disconnected' && existing.state !== 'auth_failure' && !opts.forceReset) return existing;
  if (existing && (existing.state === 'disconnected' || existing.state === 'auth_failure' || opts.forceReset)) {
    try { await existing.client?.destroy(); } catch {}
    await cleanSession(phone);
    clients.delete(phone);
  }


  // Headless false por defecto (a menos que WHATSAPP_HEADLESS=1 o se pase en opts)
  const headless = (typeof opts.headless === 'boolean') ? opts.headless : (process.env.WHATSAPP_HEADLESS === '1');
  // Entrada inicial
  const entry = { state: 'idle', qr: null, phone, client: null, mode: 'qr' };
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
      entry.state = 'disconnected';
      console.warn('[whatsapp]', phone, 'DISCONNECTED', reason);
      try { await entry.client?.destroy(); } catch {}
      await cleanSession(phone);
      // Marcamos para permitir nuevo pairing inmediato
      entry.state = 'cleaned';
    });
    c.on('message', async (msg) => { if (msg.body?.toLowerCase() === 'ping') await msg.reply('pong'); });
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
app.use(express.json());

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

// Enviar media (imagen/documento) con caption opcional
app.post('/whatsapp/send-media', async (req,res)=>{
  try {
    const { phone, to, filename, mimetype, data, caption } = req.body || {};
    if(!phone || !to || !filename || !mimetype || !data) return res.status(400).json({ error: 'phone, to, filename, mimetype, data requeridos' });
    const entry = clients.get(String(phone));
    if(!entry || entry.state !== 'ready') return res.status(409).json({ error: 'cliente no listo' });
    const jid = to.includes('@c.us') ? to : to.replace(/[^0-9]/g,'') + '@c.us';
    const media = new MessageMedia(mimetype, data, filename);
    await entry.client.sendMessage(jid, media, { caption: caption || '' });
    res.json({ ok: true });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló envío media' });
  }
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
    const data = chats.slice(0, limit).map(c => ({
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
    }));
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
    let fetchSize = beforeTs ? Math.min(limit * 4, 500) : Math.min(limit + 20, 300);
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
    const data = slice.map(m => ({
      id: m.id?.id,
      fromMe: m.fromMe,
      author: m.author || null,
      timestamp: m.timestamp,
      type: m.type,
      body: (m.type === 'chat' ? (m.body||'') : `[${m.type}]`)
    }));
    res.json({ phone, chatId, messages: data, hasMore, oldestTs: data.length ? data[0].timestamp : null });
  } catch(e){
    res.status(500).json({ error: e.message || 'falló historial mensajes' });
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
