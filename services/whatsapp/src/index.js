import express from 'express'
import pkg from 'whatsapp-web.js'
import QRCode from 'qrcode'
import jwt from 'jsonwebtoken'
import fetch from 'node-fetch'

const { Client, LocalAuth } = pkg
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change'

const app = express()
app.use(express.json())

// Almacén de sesiones por usuario
const sessions = new Map()

// Middleware de autenticación
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' })
  }
  
  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET)
    req.user = { id: payload.sub }
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
}

// Crear o obtener sesión de WhatsApp para un usuario
async function getOrCreateSession(userId) {
  let session = sessions.get(userId)
  
  if (session) {
    return session
  }
  
  console.log(`[WhatsApp] Creando nueva sesión para usuario: ${userId}`)
  
  session = {
    client: null,
    status: 'INITIALIZING',
    qrCode: null,
    isFullyReady: false
  }
  
  sessions.set(userId, session)
  
  // Crear cliente de WhatsApp
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `user_${userId}`
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  })
  
  session.client = client
  
  // Event listeners
  client.on('qr', async (qr) => {
    console.log(`[WhatsApp] QR generado para ${userId}`)
    session.status = 'QR'
    try {
      session.qrCode = await QRCode.toDataURL(qr)
    } catch (error) {
      console.error(`[WhatsApp] Error generando QR: ${error.message}`)
    }
  })
  
  client.on('authenticated', () => {
    console.log(`[WhatsApp] Usuario ${userId} autenticado`)
    session.status = 'AUTHENTICATED'
    session.qrCode = null
    
    // Timeout de seguridad: si no llega 'ready' en 30 segundos, asumir que está listo
    setTimeout(() => {
      if (session.status === 'AUTHENTICATED') {
        console.log(`[WhatsApp] Timeout esperando 'ready' para ${userId}, forzando READY`)
        session.status = 'READY'
        session.isFullyReady = false // Marcar como no completamente listo
      }
    }, 30000)
  })
  
  client.on('ready', () => {
    console.log(`[WhatsApp] Usuario ${userId} listo y conectado`)
    session.status = 'READY'
    session.isFullyReady = true
  })
  
  client.on('loading_screen', (percent, message) => {
    console.log(`[WhatsApp] Usuario ${userId} cargando: ${percent}% - ${message}`)
    if (percent < 100) {
      session.status = 'LOADING'
    }
  })
  
  client.on('disconnected', (reason) => {
    console.log(`[WhatsApp] Usuario ${userId} desconectado: ${reason}`)
    session.status = 'DISCONNECTED'
    session.isFullyReady = false
    // No eliminar la sesión inmediatamente para permitir reconexión
    // sessions.delete(userId)
  })
  
  client.on('auth_failure', (message) => {
    console.error(`[WhatsApp] Fallo de autenticación para ${userId}: ${message}`)
    session.status = 'AUTH_FAILURE'
    session.isFullyReady = false
  })
  
  // Inicializar cliente
  try {
    console.log(`[WhatsApp] Inicializando cliente para ${userId}...`)
    await client.initialize()
    console.log(`[WhatsApp] Cliente inicializado para ${userId}`)
  } catch (error) {
    console.error(`[WhatsApp] Error inicializando cliente para ${userId}: ${error.message}`)
    session.status = 'ERROR'
  }
  
  return session
}

// Rutas de la API

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size })
})

// Obtener estado de la sesión
app.get('/whatsapp/status', authMiddleware, async (req, res) => {
  const session = sessions.get(req.user.id)
  
  if (!session) {
    return res.json({ status: 'NO_SESSION' })
  }
  
  const response = { 
    status: session.status,
    isFullyReady: session.isFullyReady || false
  }
  
  if (session.status === 'QR' && session.qrCode) {
    response.qr = session.qrCode
  }
  
  // Agregar información de diagnóstico si hay cliente
  if (session.client) {
    try {
      const state = await session.client.getState()
      response.internalState = state
    } catch (error) {
      response.internalState = 'ERROR'
      response.internalStateError = error.message
    }
  }
  
  res.json(response)
})

// Iniciar sesión
app.post('/whatsapp/start', authMiddleware, async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id)
    res.json({ status: session.status, message: 'Sesión iniciada' })
  } catch (error) {
    console.error(`[WhatsApp] Error iniciando sesión: ${error.message}`)
    res.status(500).json({ error: 'Error iniciando sesión' })
  }
})

// Reiniciar sesión
app.post('/whatsapp/reset', authMiddleware, async (req, res) => {
  try {
    const session = sessions.get(req.user.id)
    
    if (session && session.client) {
      await session.client.destroy()
    }
    
    sessions.delete(req.user.id)
    
    const newSession = await getOrCreateSession(req.user.id)
    res.json({ status: newSession.status, message: 'Sesión reiniciada' })
  } catch (error) {
    console.error(`[WhatsApp] Error reiniciando sesión: ${error.message}`)
    res.status(500).json({ error: 'Error reiniciando sesión' })
  }
})

// Enviar mensaje
app.post('/whatsapp/send', authMiddleware, async (req, res) => {
  try {
    const { phone, message, clientId, clientName, clientInstagram } = req.body
    
    if (!phone || !message) {
      return res.status(400).json({ error: 'Teléfono y mensaje requeridos' })
    }
    
    const session = sessions.get(req.user.id)
    
    if (!session || (session.status !== 'READY' && session.status !== 'AUTHENTICATED')) {
      return res.status(400).json({ error: 'Sesión no lista', currentStatus: session?.status || 'NO_SESSION' })
    }
    
    if (!session.client) {
      return res.status(400).json({ error: 'Cliente WhatsApp no inicializado' })
    }
    
    // Normalizar número de teléfono (quitar +, espacios, etc.)
    const cleanPhone = phone.replace(/[^\d]/g, '')
    
    // Validar que el número tenga al menos 10 dígitos
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Número de teléfono inválido' })
    }
    
    // Para WhatsApp Web.js necesitamos formato: número@c.us
    const whatsappPhone = cleanPhone + '@c.us'
    
    console.log(`[WhatsApp] Enviando mensaje a ${whatsappPhone} para usuario ${req.user.id}`)
    console.log(`[WhatsApp] Estado del cliente: ${session.status}, Completamente listo: ${session.isFullyReady}`)
    
    // Verificar que el cliente esté realmente conectado
    try {
      const state = await session.client.getState()
      console.log(`[WhatsApp] Estado interno del cliente: ${state}`)
      
      if (state !== 'CONNECTED') {
        return res.status(400).json({ error: 'WhatsApp no está conectado', state })
      }
    } catch (stateError) {
      console.error(`[WhatsApp] Error verificando estado: ${stateError.message}`)
      return res.status(400).json({ error: 'Error verificando estado de WhatsApp' })
    }
    
    // Agregar un pequeño delay si no está completamente listo
    if (!session.isFullyReady) {
      console.log(`[WhatsApp] Cliente no completamente listo, esperando 2 segundos...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    let result
    try {
      // Intentar enviar el mensaje con timeout
      const sendPromise = session.client.sendMessage(whatsappPhone, message)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout enviando mensaje')), 15000)
      )
      
      result = await Promise.race([sendPromise, timeoutPromise])
      
    } catch (sendError) {
      console.error(`[WhatsApp] Error específico al enviar: ${sendError.message}`)
      
      // Si es un error de Puppeteer, puede que necesitemos reinicializar
      if (sendError.message.includes('Evaluation failed') || sendError.message.includes('getChat')) {
        console.log(`[WhatsApp] Error de Puppeteer detectado, marcando sesión como problemática`)
        session.status = 'ERROR'
        return res.status(500).json({ 
          error: 'Error de comunicación con WhatsApp. Prueba reiniciar la sesión.',
          details: sendError.message,
          needsRestart: true
        })
      }
      
      throw sendError
    }
    
    console.log(`[WhatsApp] Mensaje enviado exitosamente: ${result.id._serialized}`)
    
    // Registrar mensaje en la base de datos a través del API principal
    try {
      const apiResponse = await fetch(process.env.MAIN_API_URL || 'http://localhost:4002/data/whatsapp/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization // Reenviar el token
        },
        body: JSON.stringify({
          client_id: clientId || null,
          phone: '+' + cleanPhone, // Guardar con + para consistencia
          client_name: clientName || null,
          instagram: clientInstagram || null,
          message_text: message,
          message_id: result.id._serialized,
          status: 'sent',
          direction: 'outgoing',
          sent_at: new Date().toISOString()
        })
      })
      
      if (!apiResponse.ok) {
        console.error(`[WhatsApp] Error registrando mensaje en BD: ${apiResponse.status}`)
      } else {
        console.log(`[WhatsApp] Mensaje registrado en BD`)
      }
    } catch (dbError) {
      console.error(`[WhatsApp] Error conectando con API principal para registro: ${dbError.message}`)
    }
    
    res.json({ 
      success: true, 
      messageId: result.id._serialized,
      to: whatsappPhone,
      phone: '+' + cleanPhone
    })
    
  } catch (error) {
    console.error(`[WhatsApp] Error enviando mensaje: ${error.message}`)
    res.status(500).json({ 
      error: 'Error enviando mensaje',
      details: error.message 
    })
  }
})

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

const PORT = process.env.PORT || 4001
app.listen(PORT, () => {
  console.log(`[WhatsApp] Servicio ejecutándose en puerto ${PORT}`)
})
