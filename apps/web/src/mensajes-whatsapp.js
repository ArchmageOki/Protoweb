// Lógica para poblar conversaciones y mensajes reales vía API WhatsApp
// Requisitos:
// - número de sesión guardado en localStorage bajo clave whatsapp.sessionPhone
// - backend escuchando en localhost:4001

const API_BASE = 'http://localhost:4001';
const KEY_PHONE = 'whatsapp.sessionPhone';

async function api(path, opts){
  const res = await fetch(API_BASE+path, { headers: { 'Content-Type':'application/json' }, ...opts });
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

function fmtTime(ts){
  if(!ts) return '';
  const d = new Date(ts*1000); // whatsapp-web.js timestamps son segundos
  return d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
}

const ulChats = document.getElementById('mensajes-conversaciones');
const chatLog = document.getElementById('mensajes-chat-log');
const form = document.getElementById('mensajes-chat-form');
const inputMsg = document.getElementById('mensaje-input');
const sendBtn = form?.querySelector('button[type="submit"]');
const detalle = document.getElementById('mensajes-contacto-detalle');
// Header elementos
const headerAvatar = document.getElementById('chat-header-avatar');
const headerName = document.getElementById('chat-header-name');
const headerMeta = document.getElementById('chat-header-meta');
const historialEnvio = document.getElementById('mensajes-historial');
const scrollBottomBtn = document.getElementById('mensajes-scroll-bottom');
const debugPane = document.getElementById('debug-pane');
const fileInput = document.getElementById('file-input');
const btnAttach = document.getElementById('btn-attach');
const btnEmoji = document.getElementById('btn-emoji');
const emojiPicker = document.getElementById('emoji-picker');
// Eliminados: emojiTabs, emojiSearch, emojiGrid (picker anterior)
// Elementos de previsualización de adjuntos
const attachmentPreview = document.getElementById('attachment-preview');
const attachmentName = document.getElementById('attachment-name');
const attachmentSize = document.getElementById('attachment-size');
const attachmentThumb = document.getElementById('attachment-thumb');
const attachmentRemove = document.getElementById('attachment-remove');
const uploadProgress = document.getElementById('upload-progress');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const uploadProgressText = document.getElementById('upload-progress-text');
// Visor
const mediaViewer = document.getElementById('media-viewer');
const mediaImage = document.getElementById('media-image');
const mediaClose = document.getElementById('media-close');
const mediaDownload = document.getElementById('media-download');
const mediaPdf = document.getElementById('media-pdf');

let currentChatId = null;
let chatsCache = [];
let currentMessages = []; // cache en memoria del chat activo
let oldestTs = null; // timestamp del mensaje más antiguo cargado
let hasMore = false; // indicador de más historial
let eventsSource = null; // SSE
const AVATAR_CACHE_KEY = 'wpp_avatar_cache_v1';
let avatarMem = {}; // runtime cache { chatId: dataUrl }
try {
  const stored = localStorage.getItem(AVATAR_CACHE_KEY);
  if(stored){ avatarMem = JSON.parse(stored); }
} catch {}
function persistAvatarCache(){
  try { localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(avatarMem)); } catch {}
}

// ------------------ Caché de mensajes por chat (persistente) ------------------
const MSG_CACHE_KEY = 'wpp_msg_cache_v1';
let msgCache = {};
try { const rawMC = localStorage.getItem(MSG_CACHE_KEY); if(rawMC) msgCache = JSON.parse(rawMC) || {}; } catch {}
const MSG_CACHE_LIMIT = 300; // máx mensajes por chat
const MSG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
let msgCacheDirty = false; let msgCacheSaveTimer = null;
function persistMsgCache(){
  if(!msgCacheDirty) return;
  msgCacheDirty = false;
  try { localStorage.setItem(MSG_CACHE_KEY, JSON.stringify(msgCache)); } catch {}
}
function schedulePersistMsgCache(){
  msgCacheDirty = true;
  if(msgCacheSaveTimer) return;
  msgCacheSaveTimer = setTimeout(()=>{ msgCacheSaveTimer=null; persistMsgCache(); }, 700);
}
function getCachedChat(chatId){
  const entry = msgCache[chatId];
  if(!entry) return null;
  if(Date.now() - entry.ts > MSG_CACHE_TTL_MS) return null;
  return entry;
}
function setCachedChat(chatId, { messages, oldestTs, hasMore }){
  msgCache[chatId] = { ts: Date.now(), messages: [...(messages||[])].slice(-MSG_CACHE_LIMIT), oldestTs: oldestTs||null, hasMore: !!hasMore };
  schedulePersistMsgCache();
}
function mergeOlderIntoCache(chatId, olderList, newOldestTs, newHasMore){
  if(!olderList?.length) return;
  const entry = msgCache[chatId];
  if(!entry){ setCachedChat(chatId, { messages: olderList, oldestTs: newOldestTs, hasMore: newHasMore }); return; }
  const existingIds = new Set(entry.messages.map(m=>m.id));
  const merged = [...olderList.filter(m=> !existingIds.has(m.id)), ...entry.messages];
  entry.messages = merged.slice(0, MSG_CACHE_LIMIT);
  entry.oldestTs = newOldestTs || entry.oldestTs;
  entry.hasMore = newHasMore;
  entry.ts = Date.now();
  schedulePersistMsgCache();
}
function appendMessageToCache(chatId, msg){
  if(!msg) return;
  const entry = msgCache[chatId];
  if(!entry){ setCachedChat(chatId, { messages:[msg], oldestTs: msg.timestamp, hasMore:true }); return; }
  if(entry.messages.some(m=>m.id===msg.id)) return; // duplicado
  entry.messages.push(msg);
  if(entry.messages.length > MSG_CACHE_LIMIT) entry.messages = entry.messages.slice(-MSG_CACHE_LIMIT);
  entry.ts = Date.now();
  schedulePersistMsgCache();
}
// Limitar caché a 200 entradas
function trimAvatarCache(){
  const keys = Object.keys(avatarMem);
  if(keys.length > 220){
    keys.slice(0, keys.length-200).forEach(k=> delete avatarMem[k]);
    persistAvatarCache();
  }
}
let avatarQueue = [];
let avatarActive = 0;
const AVATAR_CONCURRENCY = 3;
function scheduleAvatarLoad(task){
  avatarQueue.push(task);
  runAvatarQueue();
}
function runAvatarQueue(){
  while(avatarActive < AVATAR_CONCURRENCY && avatarQueue.length){
    const t = avatarQueue.shift();
    avatarActive++;
    t().finally(()=>{ avatarActive--; runAvatarQueue(); });
  }
}

function setLoadingChats(){
  ulChats.innerHTML = '<li class="p-3 text-xs text-slate-500">Cargando...</li>';
}

function dbg(...a){
  console.log('[DBG]', ...a);
  if(debugPane){ debugPane.textContent += a.map(x=> (typeof x==='object'? JSON.stringify(x).slice(0,500): x)).join(' ') + '\n'; }
}

function renderChats(){
  if(!chatsCache.length){
    ulChats.innerHTML = '<li class="p-3 text-xs text-slate-500">(Vacío)</li>';
    return;
  }
  ulChats.innerHTML = '';
  chatsCache.forEach(c => {
    const li = document.createElement('li');
    li.className = 'p-3 cursor-pointer hover:bg-slate-100 flex gap-3'+(c.id===currentChatId?' bg-slate-100':'');
    // Avatar
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-xs text-slate-500 overflow-hidden shrink-0';
    const img = document.createElement('img');
    img.className = 'w-full h-full object-cover hidden';
    if(c.avatar){
      img.src = c.avatar; img.classList.remove('hidden');
    } else {
      avatarWrap.textContent = (c.name||c.id||'?').slice(0,2).toUpperCase();
      // Carga perezosa
      loadChatAvatar(c).then(url=>{ if(url && img){ img.src=url; img.classList.remove('hidden'); avatarWrap.textContent=''; } });
    }
    avatarWrap.appendChild(img);
    // Info
    const info = document.createElement('div');
    info.className = 'flex-1 flex flex-col gap-1 min-w-0';
    const top = document.createElement('div');
    top.className = 'flex items-center gap-2';
    const name = document.createElement('span');
    name.className = 'font-medium text-slate-800 text-sm truncate';
    name.textContent = c.name || c.id;
    const unread = document.createElement('span');
    if(c.unreadCount){
      unread.className = 'ml-auto inline-flex items-center justify-center rounded-full bg-green-600 text-white text-[10px] w-5 h-5';
      unread.textContent = c.unreadCount;
    } else {
      unread.className = 'ml-auto text-[10px] text-slate-400';
      unread.textContent = fmtTime(c.lastMessage?.timestamp);
    }
    top.appendChild(name); top.appendChild(unread);
    const last = document.createElement('div');
    last.className = 'text-xs text-slate-500 truncate max-w-[180px]';
    last.textContent = c.lastMessage?.body || '';
    info.appendChild(top); info.appendChild(last);
    li.appendChild(avatarWrap); li.appendChild(info);
    li.addEventListener('click', ()=> selectChat(c.id));
    ulChats.appendChild(li);
  });
}

async function loadChatAvatar(chat){
  if(chat.avatarLoading || chat.avatarFetched) return chat.avatar || null;
  chat.avatarLoading = true;
  try {
    // Revisar cache persistente primero
    if(avatarMem[chat.id]){ chat.avatar = avatarMem[chat.id]; chat.avatarFetched = true; return chat.avatar; }
    const phone = localStorage.getItem(KEY_PHONE); if(!phone) return null;
    return await new Promise(resolve => {
      scheduleAvatarLoad(async ()=>{
        try {
          const r = await api(`/whatsapp/chat-avatar?phone=${phone}&chatId=${encodeURIComponent(chat.id)}`);
          if(r && r.avatar){
            chat.avatar = r.avatar; chat.avatarFetched = true; avatarMem[chat.id] = r.avatar; persistAvatarCache(); trimAvatarCache();
          }
          resolve(chat.avatar || null);
        } catch { resolve(null); }
        finally { chat.avatarLoading = false; }
      });
    });
  } catch { chat.avatarLoading = false; return null; }
}

function upsertChat(summary){
  if(!summary || !summary.id) return;
  const idx = chatsCache.findIndex(c=>c.id===summary.id);
  if(idx>=0){
    // actualizar manteniendo orden luego
    chatsCache[idx] = { ...chatsCache[idx], ...summary };
  } else {
    chatsCache.push(summary);
  }
  // reordenar por timestamp
  chatsCache.sort((a,b)=> (b.lastMessage?.timestamp||0) - (a.lastMessage?.timestamp||0));
  renderChats();
}

function handleIncomingMessage(payload){
  if(!payload || !payload.chatId || !payload.message) return;
  const chat = chatsCache.find(c=>c.id===payload.chatId);
  if(chat){
    chat.lastMessage = payload.message;
    if(!payload.message.fromMe){ chat.unreadCount = (chat.unreadCount||0)+1; }
  }
  if(payload.chatId === currentChatId){
    // añadir si es del chat activo
    currentMessages = [...currentMessages, payload.message];
    renderMessages([payload.message], { append:true });
    if(chat){ chat.unreadCount = 0; }
  appendMessageToCache(payload.chatId, payload.message);
  }
  upsertChat(chat || { id: payload.chatId, lastMessage: payload.message, name: payload.chatId });
}

function initEvents(){
  const phone = localStorage.getItem(KEY_PHONE);
  if(!phone) return;
  if(eventsSource){ eventsSource.close(); eventsSource=null; }
  try {
    const es = new EventSource(API_BASE + '/whatsapp/events?phone='+phone);
    eventsSource = es;
    es.addEventListener('chat_list', (ev)=>{
      try {
        const data = JSON.parse(ev.data);
        if(Array.isArray(data.chats)){
          chatsCache = data.chats;
          renderChats();
        }
      } catch{}
    });
    es.addEventListener('chat_update', (ev)=>{ try { upsertChat(JSON.parse(ev.data)); } catch{} });
    es.addEventListener('message_new', (ev)=>{ try { handleIncomingMessage(JSON.parse(ev.data)); } catch{} });
    es.onerror = ()=>{ /* intentar reconectar tras pausa */ setTimeout(initEvents, 5000); };
  } catch{}
}

async function loadChats(){
  const phone = localStorage.getItem(KEY_PHONE);
  if(!phone) return;
  setLoadingChats();
  try {
  let data = await api(`/whatsapp/chats?phone=${phone}&limit=80`);
  dbg('respuesta inicial chats meta', { total: data.chats?.length, keys: data.chats ? Object.keys(data.chats[0]||{}) : [] });
    // Si viene vacío intentar reintentos progresivos
    if((!data.chats || !data.chats.length) && !data.empty){
      for (let i=0;i<3;i++){
        await new Promise(r=>setTimeout(r, 1200));
        try { data = await api(`/whatsapp/chats?phone=${phone}&limit=80`); if(data.chats?.length) break; } catch {}
      }
    }
  chatsCache = (data.chats || []).filter(c=>c && c.id); // filtrar nulls
  dbg('chats normalizados', chatsCache.length);
  renderChats();
    if(!chatsCache.length){
      ulChats.innerHTML = '<li class="p-3 text-xs text-slate-500">(Sin chats aún, espera unos segundos…)</li>';
      // Segundo ciclo de delayed refresh automático
      setTimeout(()=>{ loadChats(); }, 4000);
    }
  } catch (e){
    ulChats.innerHTML = `<li class='p-3 text-xs text-red-600'>Error cargando chats: ${e.message}</li>`;
  }
}

function clearMessages(){
  chatLog.innerHTML = '<div class="text-center text-xs text-slate-500">Cargando...</div>';
}

function renderMessages(list, { append = false, preserveScroll = false } = {}){
  if(!append){
    chatLog.innerHTML = '';
  }
  if(!list.length && !append){
    chatLog.innerHTML = '<div class="text-center text-xs text-slate-500">Sin mensajes</div>';
    return;
  }
  let prevHeight;
  if(preserveScroll){ prevHeight = chatLog.scrollHeight; }
  list.forEach(m => { chatLog.appendChild(createMessageBubble(m)); });
  if(preserveScroll){
    const diff = chatLog.scrollHeight - prevHeight;
    chatLog.scrollTop = diff; // mantener posición relativa
  } else {
  try { chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: 'smooth' }); } catch { chatLog.scrollTop = chatLog.scrollHeight; }
  }
}

async function selectChat(chatId){
  if(chatId === currentChatId) return;
  currentChatId = chatId;
  renderChats(); // Para resaltar selección
  clearMessages();
  const phone = localStorage.getItem(KEY_PHONE);
  if(!phone) return;
  // Render inmediato desde caché si existe (optimiza TTFMP)
  const cached = getCachedChat(chatId);
  if(cached){
    currentMessages = cached.messages || [];
    oldestTs = cached.oldestTs;
    hasMore = cached.hasMore;
    renderMessages(currentMessages);
  }
  try {
    const data = await api(`/whatsapp/messages?phone=${phone}&chatId=${encodeURIComponent(chatId)}&limit=60`);
    currentMessages = data.messages || [];
    oldestTs = data.oldestTs;
    hasMore = data.hasMore;
    renderMessages(currentMessages);
    setCachedChat(chatId, { messages: currentMessages, oldestTs, hasMore });
    const chat = chatsCache.find(c=>c.id===chatId);
    if(chat){
      detalle.textContent = `${chat.name || chat.id} ${chat.isGroup?'(Grupo)':''}`;
      // Header name
      if(headerName) headerName.textContent = chat.name || chat.id;
      if(headerMeta) headerMeta.textContent = chat.isGroup ? 'Grupo' : 'Contacto';
      if(headerAvatar){
        const img = headerAvatar.querySelector('img');
        if(chat.avatar){
          if(img){ img.src = chat.avatar; img.classList.remove('hidden'); }
          else {
            headerAvatar.innerHTML = `<img src="${chat.avatar}" class="w-full h-full object-cover" />`;
          }
        } else {
          headerAvatar.innerHTML = `<span>${(chat.name||chat.id||'?').slice(0,2).toUpperCase()}</span>`;
          loadChatAvatar(chat).then(url=>{ if(url){ headerAvatar.innerHTML = `<img src="${url}" class="w-full h-full object-cover" />`; } });
        }
      }
    }
    sendBtn.disabled = false;
  // Llevar scroll al final (por si media/avatars alteran altura) y enfocar input
  setTimeout(()=>{ try { chatLog.scrollTo({ top: chatLog.scrollHeight, behavior:'smooth'}); } catch{ chatLog.scrollTop = chatLog.scrollHeight; } }, 30);
  setTimeout(()=>{ try { inputMsg?.focus(); } catch{} }, 50);
  } catch(e){
    chatLog.innerHTML = `<div class='text-center text-xs text-red-600'>Error: ${e.message}</div>`;
  }
}

async function loadOlder(){
  if(!hasMore || !currentChatId || !oldestTs) return;
  const phone = localStorage.getItem(KEY_PHONE);
  if(!phone) return;
  // Mostrar loader superior si no existe
  let topLoader = chatLog.querySelector('[data-top-loader]');
  if(!topLoader){
    topLoader = document.createElement('div');
    topLoader.dataset.topLoader = '1';
    topLoader.className = 'text-center text-[10px] text-slate-400 mb-2';
    topLoader.textContent = 'Cargando más...';
    chatLog.prepend(topLoader);
  }
  // Guardar scroll actual
  const prevScroll = chatLog.scrollTop;
  const prevHeight = chatLog.scrollHeight;
  try {
    const data = await api(`/whatsapp/messages?phone=${phone}&chatId=${encodeURIComponent(currentChatId)}&limit=50&beforeTs=${oldestTs}`);
    const older = data.messages || [];
    if(older.length){
      currentMessages = [...older, ...currentMessages];
      oldestTs = data.oldestTs;
      hasMore = data.hasMore;
      // Insertar sólo las nuevas arriba preservando scroll
      const prevHeight2 = chatLog.scrollHeight;
      const fragment = document.createDocumentFragment();
      older.forEach(m => {
        const bubble = createMessageBubble(m);
        fragment.appendChild(bubble);
      });
      chatLog.insertBefore(fragment, chatLog.firstChild.nextSibling); // después del loader
      const newHeight = chatLog.scrollHeight;
      chatLog.scrollTop = newHeight - prevHeight2 + prevScroll; // mantener punto relativo
  mergeOlderIntoCache(currentChatId, older, oldestTs, hasMore);
    } else {
      hasMore = false;
    }
  } catch(e){ /* silencioso */ }
  topLoader?.remove();
}

chatLog?.addEventListener('scroll', ()=>{
  if(chatLog.scrollTop < 30){
    loadOlder();
  }
  const nearBottom = (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight) < 120;
  scrollBottomBtn.classList.toggle('hidden', nearBottom);
});

scrollBottomBtn?.addEventListener('click', ()=>{
  chatLog.scrollTop = chatLog.scrollHeight;
});

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!currentChatId) return;
  const phone = localStorage.getItem(KEY_PHONE);
  const text = inputMsg.value.trim();
  // Si hay archivo pendiente enviarlo como media
  if(pendingFile){
    try {
      const formData = new FormData();
      formData.append('phone', phone);
      formData.append('to', currentChatId);
      formData.append('caption', text);
      formData.append('file', pendingFile, pendingFile.name);
      if(uploadProgress){
        uploadProgress.classList.remove('hidden');
        uploadProgressBar.style.width='0%';
        uploadProgressText.textContent='0%';
      }
      await new Promise((resolve, reject)=>{
        const xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + '/whatsapp/send-media-mp');
        xhr.upload.onprogress = (ev)=>{
          if(ev.lengthComputable && uploadProgress){
            const pct = Math.round((ev.loaded/ev.total)*100);
            uploadProgressBar.style.width = pct+'%';
            uploadProgressText.textContent = pct+'%';
          }
        };
        xhr.onload = ()=>{ (xhr.status>=200 && xhr.status<300) ? resolve() : reject(new Error('HTTP '+xhr.status)); };
        xhr.onerror = ()=> reject(new Error('falló subida'));
        xhr.send(formData);
      });
      const optimistic = { id: 'temp-file-'+Date.now(), fromMe:true, body:`📎 ${pendingFile.name}${text? ' - '+text:''}`, timestamp: Math.floor(Date.now()/1000) };
      currentMessages = [...currentMessages, optimistic];
      renderMessages([optimistic], { append:true });
  // Actualizar chat en lista inmediatamente
  const chatRef1 = chatsCache.find(c=>c.id===currentChatId);
  if(chatRef1){ chatRef1.lastMessage = optimistic; chatRef1.unreadCount = 0; upsertChat(chatRef1); }
      pendingFile = null; fileInput.value=''; attachmentPreview.classList.add('hidden');
      inputMsg.value=''; sendBtn.disabled = true;
      if(uploadProgress){ setTimeout(()=>{ uploadProgress.classList.add('hidden'); }, 800); }
      setTimeout(()=> selectChat(currentChatId), 1200);
    } catch(e){ alert('Error adjunto: '+e.message); }
    return;
  }
  if(!text) return;
  try {
    await api('/whatsapp/send', { method:'POST', body: JSON.stringify({ phone, to: currentChatId, message: text }) });
    const optimistic = { id: 'temp-'+Date.now(), fromMe:true, body:text, timestamp: Math.floor(Date.now()/1000) };
    currentMessages = [...currentMessages, optimistic];
    renderMessages([optimistic], { append:true });
  const chatRef2 = chatsCache.find(c=>c.id===currentChatId);
  if(chatRef2){ chatRef2.lastMessage = optimistic; chatRef2.unreadCount = 0; upsertChat(chatRef2); }
    inputMsg.value=''; sendBtn.disabled = true;
  autoResizeTextarea();
    autoResizeTextarea();
    setTimeout(()=> selectChat(currentChatId), 800);
  } catch(e){ alert('Error enviando: '+e.message); }
});

// Manejo de Enter / Shift+Enter y auto-resize
function autoResizeTextarea(){
  if(!inputMsg) return;
  inputMsg.style.height = 'auto';
  const max = 160; // px
  const newH = Math.min(inputMsg.scrollHeight, max);
  inputMsg.style.height = newH + 'px';
}
inputMsg?.addEventListener('input', ()=>{ sendBtn.disabled = !inputMsg.value.trim() && !pendingFile; autoResizeTextarea(); });
inputMsg?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    form?.requestSubmit();
  }
});
// Inicial
autoResizeTextarea();

// Adjuntos
btnAttach?.addEventListener('click', ()=> fileInput.click());

// (El listener original de envío inmediato de archivos se eliminó; ahora se usa la previsualización y se envía al hacer submit)

// Sustituir implementación antigua de picker manual por web component
function ensureEmojiPickerComponent(){
  if(!emojiPicker) return;
  if(emojiPicker.dataset.ready) return;
  const scriptId = 'ext-emoji-picker-el';
  if(!document.getElementById(scriptId)){
    const s = document.createElement('script');
    s.id = scriptId; s.type='module';
    s.src='https://unpkg.com/emoji-picker-element@^1/index.js';
    document.head.appendChild(s);
  }
  const picker = document.createElement('emoji-picker');
  picker.className='w-full h-full';
  picker.addEventListener('emoji-click', ev => { insertEmoji(ev.detail.unicode); });
  emojiPicker.appendChild(picker);
  emojiPicker.dataset.ready='1';
}

function insertEmoji(emoji){
  const start = inputMsg.selectionStart || inputMsg.value.length;
  const end = inputMsg.selectionEnd || inputMsg.value.length;
  inputMsg.value = inputMsg.value.slice(0,start) + emoji + inputMsg.value.slice(end);
  inputMsg.focus();
  inputMsg.selectionStart = inputMsg.selectionEnd = start + emoji.length;
  sendBtn.disabled = !inputMsg.value.trim();
}

// Carga diferida de pdf.js para miniaturas de la primera página
async function ensurePdfJs(){
  if(window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.js';
    s.onload = resolve; s.onerror = ()=> reject(new Error('No se pudo cargar pdf.js'));
    document.head.appendChild(s);
  });
  if(window.pdfjsLib){
    // Configurar worker si no viene auto
    if(window.pdfjsLib.GlobalWorkerOptions){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js';
    }
    return window.pdfjsLib;
  }
  throw new Error('pdf.js no disponible');
}

btnEmoji?.addEventListener('click', ()=>{
  ensureEmojiPickerComponent();
  const open = !emojiPicker.classList.contains('hidden');
  if(open){
    emojiPicker.classList.add('hidden');
    btnEmoji.setAttribute('aria-expanded','false');
  } else {
    emojiPicker.classList.remove('hidden');
    btnEmoji.setAttribute('aria-expanded','true');
  }
});

document.addEventListener('click', (e)=>{
  if(!emojiPicker || emojiPicker.classList.contains('hidden')) return;
  if(e.target === btnEmoji || emojiPicker.contains(e.target)) return;
  emojiPicker.classList.add('hidden');
  btnEmoji?.setAttribute('aria-expanded','false');
});

document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && !emojiPicker.classList.contains('hidden')){
    emojiPicker.classList.add('hidden');
    btnEmoji?.setAttribute('aria-expanded','false');
  }
});

// Previsualización de adjuntos
let pendingFile = null;
function humanSize(bytes){
  if(bytes < 1024) return bytes + ' B';
  const units = ['KB','MB','GB'];
  let i=-1; let v=bytes;
  do { v/=1024; i++; } while(v>=1024 && i<units.length-1);
  return v.toFixed(1)+' '+units[i];
}

fileInput?.addEventListener('change', ()=>{
  const f = fileInput.files && fileInput.files[0];
  if(!f){ pendingFile=null; attachmentPreview.classList.add('hidden'); return; }
  pendingFile = f;
  attachmentName.textContent = f.name;
  attachmentSize.textContent = humanSize(f.size);
  attachmentThumb.innerHTML = '';
  if(f.type.startsWith('image/')){
    const img = document.createElement('img');
    img.className='object-cover w-full h-full';
    img.src = URL.createObjectURL(f);
    attachmentThumb.appendChild(img);
  } else {
    attachmentThumb.innerHTML = '<span class="text-[10px] text-slate-500">'+(f.type.split('/')[1]||'FILE')+'</span>';
  }
  attachmentPreview.classList.remove('hidden');
});

attachmentRemove?.addEventListener('click', ()=>{
  pendingFile = null;
  fileInput.value='';
  attachmentPreview.classList.add('hidden');
});

// Modificar envío de adjuntos para usar previsualización si existe
fileInput?.addEventListener('change', async ()=>{
  // Nada: la lógica de envío ocurre al seleccionarlo? mejor mover a botón enviar si hay archivo sin texto
});

// Inicialización
loadChats();
initEvents();
// Refresco periódico reducido sólo como respaldo (cada 10 min)
setInterval(loadChats, 600000);

// Crear burbuja con ancho dinámico (w-fit) y max-w 70%
function createMessageBubble(m){
  // Contenedor de fila asegura una línea por mensaje
  const row = document.createElement('div');
  row.className = 'w-full flex mb-1';
  row.style.alignItems = 'flex-start';
  row.style.clear = 'both';
  if(m.fromMe){
    row.classList.add('justify-end');
  } else {
    row.classList.add('justify-start');
  }
  const bubble = document.createElement('div');
  const base = 'w-fit min-w-[15%] max-w-[70%] px-3 py-2 pr-12 rounded-md shadow text-sm whitespace-pre-wrap break-words relative';
  bubble.className = base + (m.fromMe ? ' bg-green-600 text-white' : ' bg-white border border-slate-200');
  const content = document.createElement('div');
  // Media preview
  if(m.hasMedia && (m.type === 'image' || m.type === 'document')){
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'mb-2 rounded overflow-hidden border border-slate-200 bg-slate-100 relative';
    mediaWrap.style.maxWidth='240px';
    mediaWrap.style.cursor='pointer';
    mediaWrap.title = 'Click para abrir / descargar';
    const placeholder = document.createElement('div');
    placeholder.className='w-40 h-40 flex items-center justify-center text-xs text-slate-500';
    placeholder.textContent = m.type === 'image' ? 'Imagen' : (m.filename || 'Documento');
    mediaWrap.appendChild(placeholder);
    // Precarga automática si es imagen (thumbnail completo)
    if(m.type === 'image'){
      // Descarga silenciosa
      loadMessageMedia(m, mediaWrap, true);
    }
    mediaWrap.addEventListener('click', async ()=>{
      if(mediaWrap.dataset.loaded){
        if(m.type === 'image' && mediaWrap.dataset.url){
          showMediaModal({ url: mediaWrap.dataset.url, type: 'image', filename: mediaWrap.dataset.filename || m.filename || 'imagen' });
        } else if(m.type === 'document' && mediaWrap.dataset.mimetype?.includes('pdf') && mediaWrap.dataset.url){
          showMediaModal({ url: mediaWrap.dataset.url, type: 'pdf', filename: mediaWrap.dataset.filename || m.filename || 'documento.pdf' });
        } else if(mediaWrap.dataset.url){
          window.open(mediaWrap.dataset.url,'_blank');
        }
        return;
      }
      try { await loadMessageMedia(m, mediaWrap, false, true); } catch{}
    });
    content.appendChild(mediaWrap);
  }
  // Lógica de caption: si es media y el body incluye filename + '-' + caption, mostrar sólo el caption
  let hasInlineText = false;
  if(m.body){
    let finalCaption = '';
    let hide = false;
    if(m.hasMedia && m.caption){
      finalCaption = m.caption.trim();
    } else {
      let bodyRaw = m.body.trim();
      finalCaption = bodyRaw;
      if(m.hasMedia){
        if(/^\[documento\]$/i.test(bodyRaw)) hide = true;
        if(/^📎\s+/.test(bodyRaw)) bodyRaw = bodyRaw.replace(/^📎\s+/, '');
        const fname = (m.filename || '').trim();
        if(fname && (bodyRaw === fname)) hide = true;
        if(!hide && fname && bodyRaw.startsWith(fname+' - ')){
          finalCaption = bodyRaw.slice(fname.length + 3).trim();
          if(!finalCaption) hide = true;
        } else {
          finalCaption = bodyRaw; // fallback
        }
      }
      if(hide) finalCaption='';
    }
    if(finalCaption){
      const textContainer = document.createElement('div');
      textContainer.className='relative';
      const textSpan = document.createElement('span');
      textSpan.className='whitespace-pre-wrap break-words block pr-1';
      textSpan.textContent = finalCaption;
      textContainer.appendChild(textSpan);
      content.appendChild(textContainer);
      hasInlineText = true;
    }
  }
  // Timestamp absoluto abajo a la derecha (si no hay texto también)
  const timeSpan = document.createElement('span');
  timeSpan.className='absolute bottom-1 right-2 text-[10px] opacity-70';
  timeSpan.textContent = fmtTime(m.timestamp);
  bubble.appendChild(timeSpan);
  bubble.appendChild(content);
  row.appendChild(bubble);
  return row;
}

async function loadMessageMedia(m, mediaWrap, silent=false, openModalOnImage=false){
  try {
    if(mediaWrap.dataset.loading) return; // evitar duplicados
    mediaWrap.dataset.loading = '1';
    if(!silent) mediaWrap.classList.add('opacity-60');
    const phone = localStorage.getItem(KEY_PHONE);
    const r = await api(`/whatsapp/message-media?phone=${phone}&chatId=${encodeURIComponent(currentChatId)}&messageId=${encodeURIComponent(m.id)}`);
    let blob;
    if(r.data){
      const byteChars = atob(r.data);
      const bytes = new Uint8Array(byteChars.length);
      for(let i=0;i<byteChars.length;i++) bytes[i]=byteChars.charCodeAt(i);
      blob = new Blob([bytes], { type: r.mimetype || 'application/octet-stream' });
    }
    const url = URL.createObjectURL(blob);
    mediaWrap.dataset.url = url;
    mediaWrap.dataset.loaded = '1';
  mediaWrap.classList.remove('opacity-60');
  if(r.filename) mediaWrap.dataset.filename = r.filename;
  if(r.mimetype) mediaWrap.dataset.mimetype = r.mimetype;
    if(r.mimetype && r.mimetype.startsWith('image/')){
      mediaWrap.innerHTML = '';
      const img = document.createElement('img');
      img.src = url; img.className='block max-w-full max-h-60 object-cover';
      mediaWrap.appendChild(img);
  if(openModalOnImage){ showMediaModal({ url, type: 'image', filename: r.filename || m.filename || 'imagen' }); }
    } else if((r.mimetype||'').includes('pdf')) {
        // Placeholder mientras se genera miniatura
        mediaWrap.innerHTML = '<div class="w-40 h-40 flex flex-col items-center justify-center gap-2 text-[11px] text-slate-600 animate-pulse"><span>📄 Generando vista…</span></div>';
        try {
          const pdfjs = await ensurePdfJs();
          const arrayBuffer = await blob.arrayBuffer();
          const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
          const page = await pdf.getPage(1);
          // Ajustar escala para caber en 160x160
          const viewport0 = page.getViewport({ scale: 1 });
          const maxDim = 160; // px
          const scale = Math.min(maxDim / viewport0.width, maxDim / viewport0.height);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          const thumbUrl = canvas.toDataURL('image/png');
          mediaWrap.innerHTML = '';
          const img = document.createElement('img');
          img.src = thumbUrl; img.alt = r.filename || 'PDF';
          img.className='block object-contain max-w-full max-h-60 bg-white';
          mediaWrap.appendChild(img);
          // Pie con nombre
          const cap = document.createElement('div');
          cap.className='mt-1 text-[10px] text-slate-600 truncate max-w-[150px]';
          cap.textContent = r.filename || 'archivo.pdf';
          mediaWrap.appendChild(cap);
        } catch(err){
          mediaWrap.innerHTML = '<div class="w-40 h-40 flex flex-col items-center justify-center gap-2 text-[11px] text-slate-600"><span>📄 PDF</span><span class="px-2 text-center break-all">'+(r.filename||'archivo.pdf')+'</span></div>';
        }
        if(openModalOnImage){ showMediaModal({ url, type: 'pdf', filename: r.filename || 'archivo.pdf' }); }
    } else {
      mediaWrap.innerHTML = '<div class="w-40 h-40 flex flex-col items-center justify-center gap-2 text-[11px] text-slate-600"><span>📎 Archivo</span><span class="px-2 text-center break-all">'+(r.filename||'archivo')+'</span></div>';
      if(openModalOnImage){ window.open(url,'_blank'); }
    }
  } catch(e){
    if(!silent) alert('No se pudo obtener media');
    mediaWrap.classList.remove('opacity-60');
  } finally {
    delete mediaWrap.dataset.loading;
  }
}

function showMediaModal({ url, type, filename }){
  if(!mediaViewer) return;
  if(type === 'image'){
    mediaImage.classList.remove('hidden');
    mediaPdf?.classList.add('hidden');
    mediaImage.src = url;
  } else if(type === 'pdf'){
    mediaPdf?.classList.remove('hidden');
    mediaImage.classList.add('hidden');
    mediaPdf.src = url;
  }
  mediaDownload.href = url;
  mediaDownload.setAttribute('download', filename || (type==='pdf'?'documento.pdf':'media'));
  mediaViewer.classList.remove('hidden');
}

mediaClose?.addEventListener('click', ()=> mediaViewer.classList.add('hidden'));
mediaViewer?.addEventListener('click', (e)=>{ if(e.target === mediaViewer) mediaViewer.classList.add('hidden'); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') mediaViewer?.classList.add('hidden'); });
