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

let currentChatId = null;
let chatsCache = [];
let currentMessages = []; // cache en memoria del chat activo
let oldestTs = null; // timestamp del mensaje más antiguo cargado
let hasMore = false; // indicador de más historial

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
    li.className = 'p-3 cursor-pointer hover:bg-slate-100 flex flex-col gap-1'+(c.id===currentChatId?' bg-slate-100':'');
    const top = document.createElement('div');
    top.className = 'flex items-center gap-2';
    const name = document.createElement('span');
    name.className = 'font-medium text-slate-800 text-sm';
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
    last.className = 'text-xs text-slate-500 truncate';
    last.textContent = c.lastMessage?.body || '';
    li.appendChild(top); li.appendChild(last);
    li.addEventListener('click', ()=> selectChat(c.id));
    ulChats.appendChild(li);
  });
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
  list.forEach(m => {
    const bubble = document.createElement('div');
    const base = 'max-w-[75%] px-3 py-2 rounded-md shadow text-sm flex flex-col';
    if(m.fromMe){
      bubble.className = base + ' bg-green-600 text-white ml-auto';
    } else {
      bubble.className = base + ' bg-white border border-slate-200';
    }
    const body = document.createElement('div');
    body.textContent = m.body;
    const meta = document.createElement('div');
    meta.className = 'text-[10px] opacity-70 mt-1 self-end';
    meta.textContent = fmtTime(m.timestamp);
    bubble.appendChild(body); bubble.appendChild(meta);
    chatLog.appendChild(bubble);
  });
  if(preserveScroll){
    const diff = chatLog.scrollHeight - prevHeight;
    chatLog.scrollTop = diff; // mantener posición relativa
  } else {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

async function selectChat(chatId){
  if(chatId === currentChatId) return;
  currentChatId = chatId;
  renderChats(); // Para resaltar selección
  clearMessages();
  const phone = localStorage.getItem(KEY_PHONE);
  if(!phone) return;
  try {
    const data = await api(`/whatsapp/messages?phone=${phone}&chatId=${encodeURIComponent(chatId)}&limit=60`);
    currentMessages = data.messages || [];
    oldestTs = data.oldestTs;
    hasMore = data.hasMore;
    renderMessages(currentMessages);
    const chat = chatsCache.find(c=>c.id===chatId);
    if(chat){
      detalle.textContent = `${chat.name || chat.id} ${chat.isGroup?'(Grupo)':''}`;
    }
    sendBtn.disabled = false;
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
        const bubble = document.createElement('div');
        const base = 'max-w-[75%] px-3 py-2 rounded-md shadow text-sm flex flex-col';
        bubble.className = base + (m.fromMe ? ' bg-green-600 text-white ml-auto' : ' bg-white border border-slate-200');
        const body = document.createElement('div'); body.textContent = m.body;
        const meta = document.createElement('div'); meta.className = 'text-[10px] opacity-70 mt-1 self-end'; meta.textContent = fmtTime(m.timestamp);
        bubble.appendChild(body); bubble.appendChild(meta);
        fragment.appendChild(bubble);
      });
      chatLog.insertBefore(fragment, chatLog.firstChild.nextSibling); // después del loader
      const newHeight = chatLog.scrollHeight;
      chatLog.scrollTop = newHeight - prevHeight2 + prevScroll; // mantener punto relativo
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
      const b64 = await new Promise((resolve, reject)=>{
        const r = new FileReader();
        r.onload = ()=> resolve(r.result.split(',')[1]);
        r.onerror = reject; r.readAsDataURL(pendingFile);
      });
      await api('/whatsapp/send-media', { method:'POST', body: JSON.stringify({ phone, to: currentChatId, filename: pendingFile.name, mimetype: pendingFile.type || 'application/octet-stream', data: b64, caption: text }) });
      const optimistic = { id: 'temp-file-'+Date.now(), fromMe:true, body:`📎 ${pendingFile.name}${text? ' - '+text:''}`, timestamp: Math.floor(Date.now()/1000) };
      currentMessages = [...currentMessages, optimistic];
      renderMessages([optimistic], { append:true });
      // Reset preview
      pendingFile = null; fileInput.value=''; attachmentPreview.classList.add('hidden');
      inputMsg.value=''; sendBtn.disabled = true;
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
    inputMsg.value=''; sendBtn.disabled = true;
    setTimeout(()=> selectChat(currentChatId), 800);
  } catch(e){ alert('Error enviando: '+e.message); }
});

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
// Refresco periódico de chats (cada 45s) para nuevas conversaciones
setInterval(loadChats, 45000);
