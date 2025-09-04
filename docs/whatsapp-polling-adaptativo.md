# Sistema de Polling Adaptativo para WhatsApp

## Descripción

El sistema de polling adaptativo ajusta automáticamente la frecuencia de consultas al estado de WhatsApp según el contexto actual, optimizando el rendimiento y la experiencia del usuario.

## Intervalos por Estado

| Estado                   | Intervalo                 | Motivo                                         |
| ------------------------ | ------------------------- | ---------------------------------------------- |
| `QR` / `INITIALIZING`    | **2 segundos**            | Fase crítica - el usuario está esperando el QR |
| `AUTHENTICATED`          | **3 segundos**            | Transición - validando conexión                |
| `READY`                  | **30 segundos**           | Conectado - solo mantenimiento                 |
| `DISCONNECTED`           | **5 segundos**            | Detectar reconexión rápidamente                |
| `ERROR` / `AUTH_FAILURE` | **10 segundos** + backoff | Evitar saturar en error                        |
| `NO_SESSION`             | **15 segundos**           | Estado inicial/limpio                          |

## Manejo de Errores

### Backoff Exponencial

- **1er error**: 2 segundos
- **2do error**: 4 segundos
- **3er error**: 8 segundos
- **4to error**: 16 segundos
- **5to+ errores**: 32 segundos (máximo: 60s)

### Recovery

Cuando una petición es exitosa después de errores:

- Se resetea el contador de errores a `0`
- Se vuelve al intervalo normal según el estado
- Se registra en consola: `✅ Conexión restaurada`

## Ventajas vs Polling Fijo (5s)

### 📈 Rendimiento

- **60% menos peticiones** en estado READY (30s vs 5s)
- **Backoff inteligente** durante errores de red
- **Mayor reactividad** durante QR/autenticación

### 💡 Experiencia de Usuario

- **QR aparece en ~2s** (vs hasta 5s antes)
- **Conexión detectada inmediatamente**
- **Menos "parpadeo" en estados transitorios**

### 🖥️ Recursos del Servidor

- **Menos carga CPU/memoria** en estado estable
- **Menos logs innecesarios**
- **Mejor escalabilidad** con múltiples usuarios

## Herramientas de Debug

### En Consola del Navegador:

```javascript
// Ver estadísticas actuales
waPollingStats();

// Reiniciar polling (con intervalo personalizado opcional)
waRestartPolling();
waRestartPolling(1000); // Forzar 1 segundo
```

### Logs Automáticos:

```
🚀 Iniciando polling adaptativo: 15s
🔄 Estado WhatsApp: NO_SESSION → QR
📊 Polling adaptativo: 2s (estado: QR, errores: 0)
❌ Error de conexión 1, aplicando backoff
✅ Conexión restaurada, reiniciando polling normal
```

## Configuración

Los intervalos están definidos en la función `getPollingInterval()`:

```javascript
function getPollingInterval(status, errorCount = 0) {
  if (errorCount > 0) {
    return Math.min(1000 * Math.pow(2, errorCount), 60000);
  }

  switch (status) {
    case "QR":
    case "INITIALIZING":
      return 2000;
    case "AUTHENTICATED":
      return 3000;
    case "READY":
      return 30000;
    case "DISCONNECTED":
      return 5000;
    case "ERROR":
    case "AUTH_FAILURE":
      return 10000;
    default:
      return 15000;
  }
}
```

## Migración desde Polling Fijo

### Antes:

```javascript
waStatusInterval = setInterval(updateWhatsAppStatus, 5000);
```

### Después:

```javascript
function startStatusPolling() {
  updateWhatsAppStatus();
  const initialInterval = getPollingInterval(
    currentWaStatus || "NO_SESSION",
    0
  );
  waStatusInterval = setInterval(updateWhatsAppStatus, initialInterval);
}
```

## Próximos Pasos (Futuro)

1. **WebSocket Integration**: Reemplazar polling por push notifications
2. **Métricas**: Tracking de eficiencia del polling
3. **User Preferences**: Permitir al usuario ajustar agresividad
4. **Smart Backoff**: Detectar patrones de red para optimizar intervalos

---

**Implementado**: 3 septiembre 2025  
**Archivo**: `apps/web/src/whatsapp-messages.js`
