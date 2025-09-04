# Mejoras Críticas - Recovery Automático tras Logout

## Problema Original

Tras logout desde móvil:

- ❌ Servidor se colgaba con errores de Puppeteer
- ❌ Frontend no detectaba necesidad de nuevo QR
- ❌ Usuario tenía que reiniciar manualmente

## Solución Implementada

### 🛡️ Backend - Recovery Automático

**Flujo mejorado tras LOGOUT:**

```javascript
client.on('disconnected', 'LOGOUT')
→ setTimeout(destroySession + createNewSession, 1000ms)
→ Nueva sesión con QR disponible automáticamente
```

**Mejoras en `destroySession()`:**

- Timeout reducido a 3s (vs 5s)
- Delay post-destroy de 500ms
- Manejo de errores más robusto

**Filtrado de logs de error:**

```javascript
// Errores esperados tras logout - solo warning
if (
  errorMessage.includes("Session closed") ||
  errorMessage.includes("ENOENT")
) {
  console.warn("Promise rechazada (esperada tras logout)");
}
```

### 🖥️ Frontend - QR Inline + Polling Acelerado

**QR Overlay automático:**

```javascript
if (data.status === "QR" && previousStatus !== "QR") {
  showQRInline(data.qr); // Modal con QR sin salir de mensajes
}
```

**Polling más agresivo durante transiciones:**

- DISCONNECTED: 2s (vs 5s antes)
- ERROR: 5s (vs 10s antes)
- NO_SESSION: 10s (vs 15s antes)

**Detección mejorada de estados:**

```javascript
// Acelerar polling tras desconexión
if (status === "DISCONNECTED" && previousStatus === "READY") {
  restartPolling(2000); // Polling cada 2s
}
```

## Flujo Completo de Recovery

### Timeline Esperada:

```
T+0s:    Usuario hace logout desde móvil
T+0s:    Backend detecta 'LOGOUT'
T+1s:    Backend destruye sesión y crea nueva automáticamente
T+1-2s:  Backend genera QR para nueva sesión
T+2-4s:  Frontend detecta estado 'QR' (polling cada 2s)
T+2-4s:  Frontend muestra QR overlay automáticamente
```

**Total: ~4s desde logout hasta QR visible**

### Componente QR Inline

Modal responsive que aparece sobre mensajes.html:

- **No requiere navegación** a otra página
- **Se cierra automáticamente** al conectar
- **Botón manual** de cierre disponible
- **Instrucciones claras** para el usuario

## Testing

### Caso 1: Logout Normal ✅

```bash
# Desconectar desde móvil
# Verificar: QR aparece en ~4s, sin crashear servidor
```

### Caso 2: Errores de Red ✅

```bash
# Simular pérdida de conexión
# Verificar: Backoff exponencial, recovery automático
```

### Caso 3: Múltiples Logouts ✅

```bash
# Logout rápido múltiple desde móvil
# Verificar: Sesiones se limpian correctamente
```

## Configuración Ajustada

| Parámetro                | Valor Anterior | Valor Nuevo | Motivo                    |
| ------------------------ | -------------- | ----------- | ------------------------- |
| **Timeout destroy**      | 5s             | 3s          | Recovery más rápido       |
| **DISCONNECTED polling** | 5s             | 2s          | Detectar QR nuevo antes   |
| **ERROR polling**        | 10s            | 5s          | Recovery más agresivo     |
| **Backoff máximo**       | 60s            | 30s         | Reintentos más frecuentes |

## Logs de Debug

### Backend (esperados tras logout):

```
[WhatsApp] Usuario RSK...mzB desconectado: LOGOUT
[WhatsApp] Logout detectado, limpiando sesión...
[WhatsApp] Destruyendo sesión, razón: logout
[WhatsApp] Iniciando nueva sesión tras logout
[WhatsApp] Nueva sesión creada tras logout: QR
[WhatsApp] Promise rechazada (esperada tras logout): Session closed
```

### Frontend (esperados):

```
🔄 Estado WhatsApp: READY → DISCONNECTED
📱 Desconexión detectada, acelerando polling...
🔄 Estado WhatsApp: DISCONNECTED → QR
🔄 QR detectado, redirigiendo a página de inicio...
```

---

**Resultado**: Sistema completamente autónomo que se recupera del logout sin intervención del usuario en ~4 segundos, con QR visible inline sin perder contexto de la página de mensajes.
