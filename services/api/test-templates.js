import {
  pgListMessageTemplates,
  pgUpsertMessageTemplate,
} from "./src/db/pg.js";
import { pool } from "./src/db/pg.js";

async function test() {
  try {
    // Ver qué usuarios existen
    const usersResult = await pool.query("SELECT id, email FROM users LIMIT 5");
    console.log("Usuarios existentes:", usersResult.rows);

    if (usersResult.rows.length === 0) {
      console.log("No hay usuarios en la base de datos");
      return;
    }

    const userId = usersResult.rows[0].id;
    console.log(`Usando usuario ID: ${userId}`);

    // Verificar plantillas existentes
    const templates = await pgListMessageTemplates(userId);
    console.log("Plantillas existentes:", templates);

    // Crear las plantillas que faltan
    console.log("\n--- Creando plantillas necesarias ---");

    // Plantilla para eventos creados (clientes completos)
    await pgUpsertMessageTemplate(
      userId,
      "event_created",
      "Evento creado",
      'Hola {{nombre}}, tu evento "{{titulo}}" está programado para el {{fecha}} de {{hora_inicio}} a {{hora_fin}}. ¡Te esperamos! 📅✨'
    );
    console.log("✓ Plantilla event_created creada");

    // Plantilla para solicitud de completar datos (clientes incompletos)
    await pgUpsertMessageTemplate(
      userId,
      "client_data_request",
      "Solicitud de completar datos de cliente",
      'Hola {{nombre}} 👋\n\nHemos recibido tu reserva para "{{titulo}}" el {{fecha}} de {{hora_inicio}} a {{hora_fin}}.\n\nPara completar tu reserva, necesitamos que nos proporciones algunos datos adicionales. Por favor, responde a este mensaje con:\n\n• Tu DNI\n• Tu dirección completa\n• Tu código postal\n• Tu fecha de nacimiento\n\n¡Gracias por tu colaboración! 😊'
    );
    console.log("✓ Plantilla client_data_request creada");

    // Verificar que se crearon correctamente
    const templatesAfter = await pgListMessageTemplates(userId);
    console.log("\nPlantillas después de crear:", templatesAfter);
  } catch (e) {
    console.error("Error:", e.message);
    console.error("Stack:", e.stack);
  }
  process.exit(0);
}
test();
