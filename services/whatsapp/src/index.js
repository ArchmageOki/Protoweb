import "dotenv/config";
import express from "express";
import pkg from "whatsapp-web.js";
import { Pool } from "pg";
import { PostgresStore } from "wwebjs-postgres";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

const { Client, RemoteAuth } = pkg;
const JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "dev-access-secret-change";

// Pool de Postgres para RemoteAuth
const pgUrl = process.env.WHATSAPP_PG_URL;
if (typeof pgUrl !== "string" || !pgUrl.length) {
  console.error(
    "[WhatsApp] WHATSAPP_PG_URL no definido. Revisa services/whatsapp/.env"
  );
  process.exit(1);
}
const pgPool = new Pool({ connectionString: pgUrl });

const app = express();
app.use(express.json());

// Almacén de sesiones por usuario
const sessions = new Map();

console.log(
  `[WhatsApp] PID ${process.pid} Node ${process.version} plataforma ${process.platform}`
);

// Middleware de autenticación
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET);
    req.user = { id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Destruir sesión de forma segura
async function destroySession(userId, reason = "manual") {
  const session = sessions.get(userId);
  if (!session) return false;

  console.log(`[WhatsApp] Destruyendo sesión para ${userId}, razón: ${reason}`);

  // Destruir sesión de forma segura
  if (session.client) {
    try {
      // Limpiar listeners antes de destruir
      session.client.removeAllListeners();

      // Destruir cliente con timeout y más manejo de errores
      const destroyPromise = Promise.resolve(session.client.destroy()).catch(
        (err) => {
          console.warn(`[WhatsApp] Error en destroy(): ${err.message}`);
          // Continuar con limpieza aunque destroy() falle
        }
      );

      const timeoutPromise = new Promise((resolve) =>
        setTimeout(resolve, 3000)
      ); // Reducido a 3s
      await Promise.race([destroyPromise, timeoutPromise]);

      console.log(`[WhatsApp] Cliente Puppeteer destruido para ${userId}`);
    } catch (error) {
      console.warn(
        `[WhatsApp] Error destruyendo cliente para ${userId}: ${error.message}`
      );
      // No lanzar error, continuar con la limpieza
    }

    // Pequeño delay para permitir que Puppeteer termine completamente
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  sessions.delete(userId);
  return true;
}

// Crear o obtener sesión de WhatsApp para un usuario
async function getOrCreateSession(userId) {
  let session = sessions.get(userId);
  if (session) return session;

  console.log(`[WhatsApp] Creando nueva sesión para usuario: ${userId}`);

  session = {
    client: null,
    status: "INITIALIZING",
    qrCode: null,
    isFullyReady: false,
    lastError: null,
    createdAt: new Date(),
  };
  sessions.set(userId, session);

  // Store remoto en Postgres
  const store = new PostgresStore({
    pool: pgPool,
    tableName: "whatsapp_remote_sessions",
  });

  // Cliente de WhatsApp con RemoteAuth
  const client = new Client({
    authStrategy: new RemoteAuth({
      clientId: `user_${userId}`,
      store,
      backupSyncIntervalMs: 300000, // 5 min
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  session.client = client;

  // Manejo global de errores no capturados del cliente
  client.on("error", (error) => {
    console.error(`[WhatsApp] Error del cliente ${userId}: ${error.message}`);
    session.lastError = error.message;
    session.status = "ERROR";
    session.isFullyReady = false;
  });

  // Event listeners
  client.on("qr", async (qr) => {
    console.log(
      `[WhatsApp] QR generado para ${userId} (${new Date().toISOString()})`
    );
    session.status = "QR";
    try {
      session.qrCode = await QRCode.toDataURL(qr);
    } catch (error) {
      console.error(`[WhatsApp] Error generando QR: ${error.message}`);
    }
  });

  client.on("authenticated", () => {
    console.log(`[WhatsApp] Usuario ${userId} autenticado`);
    session.status = "AUTHENTICATED";
    session.qrCode = null;
    setTimeout(() => {
      if (session.status === "AUTHENTICATED") {
        console.log(
          `[WhatsApp] Timeout esperando 'ready' para ${userId}, forzando READY`
        );
        session.status = "READY";
        session.isFullyReady = false;
      }
    }, 30000);
  });

  client.on("remote_session_saved", () => {
    console.log(`[WhatsApp] Sesión remota guardada en Postgres para ${userId}`);
  });

  client.on("ready", () => {
    console.log(`[WhatsApp] Usuario ${userId} listo y conectado`);
    session.status = "READY";
    session.isFullyReady = true;
  });

  client.on("loading_screen", (percent, message) => {
    console.log(
      `[WhatsApp] Usuario ${userId} cargando: ${percent}% - ${message}`
    );
    if (percent < 100) session.status = "LOADING";
  });

  client.on("disconnected", (reason) => {
    console.log(`[WhatsApp] Usuario ${userId} desconectado: ${reason}`);
    session.status = "DISCONNECTED";
    session.isFullyReady = false;

    // Si es LOGOUT (desconexión manual desde móvil), limpiar sesión
    if (reason === "LOGOUT") {
      console.log(
        `[WhatsApp] Logout detectado para ${userId}, limpiando sesión...`
      );

      // Crear nueva sesión inmediatamente después de limpiar la anterior
      setTimeout(async () => {
        try {
          await destroySession(userId, "logout");
          console.log(
            `[WhatsApp] Iniciando nueva sesión tras logout para ${userId}`
          );

          // Crear inmediatamente una nueva sesión para generar QR
          const newSession = await getOrCreateSession(userId);
          console.log(
            `[WhatsApp] Nueva sesión creada tras logout: ${newSession.status}`
          );
        } catch (error) {
          console.error(
            `[WhatsApp] Error en recovery tras logout: ${error.message}`
          );
        }
      }, 1000); // Breve delay para permitir logs
    }
  });

  client.on("auth_failure", (message) => {
    console.error(
      `[WhatsApp] Fallo de autenticación para ${userId}: ${message}`
    );
    session.status = "AUTH_FAILURE";
    session.isFullyReady = false;
    session.lastError = message;
  });

  // Inicializar cliente con manejo de errores robusto
  try {
    console.log(`[WhatsApp] Inicializando cliente para ${userId}...`);

    // Timeout para evitar cuelgues en inicialización
    const initPromise = client.initialize();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout en inicialización")), 60000)
    );

    await Promise.race([initPromise, timeoutPromise]);
    console.log(`[WhatsApp] Cliente inicializado para ${userId}`);
  } catch (error) {
    console.error(
      `[WhatsApp] Error inicializando cliente para ${userId}: ${error.message}`
    );
    session.status = "ERROR";
    session.lastError = error.message;
  }

  return session;
}

// Rutas de la API

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

// Obtener estado de la sesión
app.get("/whatsapp/status", authMiddleware, async (req, res) => {
  const session = sessions.get(req.user.id);

  if (!session) {
    return res.json({ status: "NO_SESSION" });
  }

  const response = {
    status: session.status,
    isFullyReady: session.isFullyReady || false,
  };

  // Incluir último error si existe
  if (session.lastError && session.status === "ERROR") {
    response.lastError = session.lastError;
  }

  if (session.status === "QR" && session.qrCode) {
    response.qr = session.qrCode;
  }

  if (session.client) {
    try {
      const state = await session.client.getState();
      response.internalState = state;
    } catch (error) {
      // Error de Puppeteer - probablemente sesión cerrada
      if (
        error.message.includes("Session closed") ||
        error.message.includes("Protocol error")
      ) {
        console.warn(
          `[WhatsApp] Sesión Puppeteer cerrada para ${req.user.id}, marcando como ERROR`
        );
        session.status = "ERROR";
        session.lastError = "Sesión de navegador cerrada";
        response.status = "ERROR";
        response.lastError = session.lastError;
      }
      response.internalState = "ERROR";
      response.internalStateError = error.message;
    }

    // Intentar extraer número si el cliente está listo o autenticado
    if (
      (session.status === "READY" || session.status === "AUTHENTICATED") &&
      !response.phone_number
    ) {
      try {
        const info = session.client.info;
        // whatsapp-web.js expone wid: { user: '34XXXXXXXXX', _serialized: '34XXXXXXXXX@c.us' }
        let raw = info?.wid?._serialized || info?.wid?.user || null;
        if (raw && typeof raw === "string") {
          raw = raw.replace(/@.*/, ""); // quitar sufijo @c.us
          let digits = raw.replace(/[^0-9]/g, "");
          // Si son 9 dígitos (nacional ES) anteponer 34
          if (digits.length === 9) digits = "34" + digits;
          if (digits.length >= 11 && digits.length <= 15) {
            if (!digits.startsWith("34") && digits.length === 9)
              digits = "34" + digits;
            response.phone_number = "+" + digits;
          }
        }
      } catch (error) {
        // Error extrayendo número - no crítico
        console.warn(
          `[WhatsApp] Error extrayendo número para ${req.user.id}: ${error.message}`
        );
      }
    }
  }

  res.json(response);
});

// Iniciar sesión
app.post("/whatsapp/start", authMiddleware, async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id);
    res.json({ status: session.status, message: "Sesión iniciada" });
  } catch (error) {
    console.error(`[WhatsApp] Error iniciando sesión: ${error.message}`);
    res.status(500).json({ error: "Error iniciando sesión" });
  }
});

// Reiniciar sesión
app.post("/whatsapp/reset", authMiddleware, async (req, res) => {
  try {
    const { id } = req.user;
    console.log(`[WhatsApp] Reiniciando sesión para usuario ${id}`);

    // Destruir sesión existente de forma segura
    await destroySession(id, "manual_reset");

    // Crear nueva sesión
    const newSession = await getOrCreateSession(id);
    res.json({
      status: newSession.status,
      message: "Sesión reiniciada correctamente",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[WhatsApp] Error reiniciando sesión: ${error.message}`);
    res
      .status(500)
      .json({ error: "Error reiniciando sesión", details: error.message });
  }
});

// Enviar mensaje
app.post("/whatsapp/send", authMiddleware, async (req, res) => {
  try {
    const { phone, message, clientId, clientName, clientInstagram } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: "Teléfono y mensaje requeridos" });
    }

    const session = sessions.get(req.user.id);
    if (
      !session ||
      (session.status !== "READY" && session.status !== "AUTHENTICATED")
    ) {
      return res
        .status(400)
        .json({
          error: "Sesión no lista",
          currentStatus: session?.status || "NO_SESSION",
        });
    }
    if (!session.client) {
      return res
        .status(400)
        .json({ error: "Cliente WhatsApp no inicializado" });
    }

    const cleanPhone = phone.replace(/[^\d]/g, "");
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }
    const whatsappPhone = cleanPhone + "@c.us";

    console.log(
      `[WhatsApp] Enviando mensaje a ${whatsappPhone} para usuario ${req.user.id}`
    );
    console.log(
      `[WhatsApp] Estado del cliente: ${session.status}, Completamente listo: ${session.isFullyReady}`
    );

    try {
      const state = await session.client.getState();
      console.log(`[WhatsApp] Estado interno del cliente: ${state}`);
      if (state !== "CONNECTED") {
        return res.status(400).json({
          error: "WhatsApp no está conectado",
          state,
          currentStatus: session.status,
        });
      }
    } catch (stateError) {
      console.error(
        `[WhatsApp] Error verificando estado: ${stateError.message}`
      );

      // Error de Puppeteer - sesión probablemente cerrada
      if (
        stateError.message.includes("Session closed") ||
        stateError.message.includes("Protocol error")
      ) {
        console.log(
          `[WhatsApp] Error de Puppeteer detectado, marcando sesión como problemática`
        );
        session.status = "ERROR";
        session.lastError = "Sesión de navegador cerrada";
        return res.status(500).json({
          error: "Sesión de WhatsApp cerrada. Reinicia la sesión.",
          details: stateError.message,
          needsRestart: true,
          currentStatus: "ERROR",
        });
      }

      return res.status(400).json({
        error: "Error verificando estado de WhatsApp",
        details: stateError.message,
      });
    }

    if (!session.isFullyReady) {
      console.log(
        `[WhatsApp] Cliente no completamente listo, esperando 2 segundos...`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    let result;
    try {
      const sendPromise = session.client.sendMessage(whatsappPhone, message);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout enviando mensaje")), 15000)
      );
      result = await Promise.race([sendPromise, timeoutPromise]);
    } catch (sendError) {
      console.error(
        `[WhatsApp] Error específico al enviar: ${sendError.message}`
      );

      // Detectar errores críticos de Puppeteer que requieren reinicio
      const isPuppeteerError =
        sendError.message.includes("Session closed") ||
        sendError.message.includes("Protocol error") ||
        sendError.message.includes("Evaluation failed") ||
        sendError.message.includes("Target closed") ||
        sendError.message.includes("getChat");

      if (isPuppeteerError) {
        console.log(
          `[WhatsApp] Error crítico de Puppeteer detectado, marcando sesión como problemática`
        );
        session.status = "ERROR";
        session.lastError = "Error de comunicación con navegador";

        // Programar destrucción segura de la sesión
        setTimeout(() => {
          destroySession(req.user.id, "puppeteer_error");
        }, 1000);

        return res.status(500).json({
          error:
            "Error de comunicación con WhatsApp. La sesión será reiniciada automáticamente.",
          details: sendError.message,
          needsRestart: true,
          currentStatus: "ERROR",
        });
      }

      throw sendError;
    }

    console.log(
      `[WhatsApp] Mensaje enviado exitosamente: ${result.id._serialized}`
    );

    try {
      const apiResponse = await fetch(
        process.env.MAIN_API_URL ||
          "http://localhost:4002/data/whatsapp/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify({
            client_id: clientId || null,
            phone: "+" + cleanPhone,
            client_name: clientName || null,
            instagram: clientInstagram || null,
            message_text: message,
            message_id: result.id._serialized,
            status: "sent",
            direction: "outgoing",
            sent_at: new Date().toISOString(),
          }),
        }
      );
      if (!apiResponse.ok) {
        console.error(
          `[WhatsApp] Error registrando mensaje en BD: ${apiResponse.status}`
        );
      } else {
        console.log(`[WhatsApp] Mensaje registrado en BD`);
      }
    } catch (dbError) {
      console.error(
        `[WhatsApp] Error conectando con API principal para registro: ${dbError.message}`
      );
    }

    res.json({
      success: true,
      messageId: result.id._serialized,
      to: whatsappPhone,
      phone: "+" + cleanPhone,
    });
  } catch (error) {
    console.error(`[WhatsApp] Error enviando mensaje: ${error.message}`);
    res.status(500).json({
      error: "Error enviando mensaje",
      details: error.message,
    });
  }
});

// Forzar regeneración de QR
app.post("/whatsapp/force-qr", authMiddleware, async (req, res) => {
  try {
    const { id } = req.user;
    console.log(`[WhatsApp] Forzando regeneración de QR para usuario ${id}`);

    // Destruir sesión existente de forma segura
    await destroySession(id, "force_qr");

    // Crear nueva sesión
    const newSession = await getOrCreateSession(id);
    res.json({
      status: newSession.status,
      forced: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[WhatsApp] Error forzando QR: ${error.message}`);
    res.status(500).json({
      error: "Error forzando regeneración de QR",
      details: error.message,
    });
  }
});

// Manejo global de errores no capturados
process.on("uncaughtException", (error) => {
  console.error(`[WhatsApp] Error no capturado: ${error.message}`);
  console.error(error.stack);
  // No hacer exit, solo loggear
});

process.on("unhandledRejection", (reason, promise) => {
  // Filtrar errores conocidos de Puppeteer para evitar spam de logs
  const errorMessage =
    typeof reason === "object" && reason.message
      ? reason.message
      : String(reason);

  if (
    errorMessage.includes("Session closed") ||
    errorMessage.includes("Protocol error") ||
    errorMessage.includes("ENOENT") ||
    errorMessage.includes("Target closed")
  ) {
    // Estos son errores esperados tras destruir sesiones
    console.warn(
      `[WhatsApp] Promise rechazada (esperada tras logout): ${errorMessage}`
    );
  } else {
    console.error(`[WhatsApp] Promise rechazada no manejada:`, reason);
  }
  // No hacer exit, solo loggear
});

// Limpieza al cerrar el proceso
process.on("SIGINT", async () => {
  console.log(`[WhatsApp] Cerrando servidor gracefully...`);

  // Destruir todas las sesiones activas
  const destroyPromises = Array.from(sessions.keys()).map((userId) =>
    destroySession(userId, "server_shutdown").catch((err) =>
      console.warn(
        `[WhatsApp] Error destruyendo sesión ${userId}:`,
        err.message
      )
    )
  );

  await Promise.allSettled(destroyPromises);
  console.log(`[WhatsApp] Todas las sesiones cerradas`);
  process.exit(0);
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`[WhatsApp] Servicio ejecutándose en puerto ${PORT}`);
});
