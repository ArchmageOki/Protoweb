import {
  pgListMessageTemplates,
  pgUpsertMessageTemplate,
} from "./src/db/pg.js";
import { pool } from "./src/db/pg.js";

async function setupTemplatesForAllUsers() {
  try {
    // Ver qué usuarios existen
    const usersResult = await pool.query("SELECT id, email FROM users");
    console.log(
      `Configurando plantillas para ${usersResult.rows.length} usuarios...`
    );

    for (const user of usersResult.rows) {
      console.log(`\n--- Usuario: ${user.email} (${user.id}) ---`);

      // Verificar plantillas existentes
      const templates = await pgListMessageTemplates(user.id);
      const existingKeys = templates.map((t) => t.template_key);

      if (!existingKeys.includes("event_created")) {
        await pgUpsertMessageTemplate(
          user.id,
          "event_created",
          "Evento creado",
          'Hola {{nombre}}, tu evento "{{titulo}}" está programado para el {{fecha}} de {{hora_inicio}} a {{hora_fin}}. ¡Te esperamos! 📅✨'
        );
        console.log("✓ Plantilla event_created creada");
      } else {
        console.log("⏭️ Plantilla event_created ya existe");
      }

      if (!existingKeys.includes("client_data_request")) {
        await pgUpsertMessageTemplate(
          user.id,
          "client_data_request",
          "Solicitud de completar datos de cliente",
          'Hola {{nombre}} 👋\n\nHemos recibido tu reserva para "{{titulo}}" el {{fecha}} de {{hora_inicio}} a {{hora_fin}}.\n\nPara completar tu reserva, necesitamos que nos proporciones algunos datos adicionales. Por favor, responde a este mensaje con:\n\n• Tu DNI\n• Tu dirección completa\n• Tu código postal\n• Tu fecha de nacimiento\n\n¡Gracias por tu colaboración! 😊'
        );
        console.log("✓ Plantilla client_data_request creada");
      } else {
        console.log("⏭️ Plantilla client_data_request ya existe");
      }
    }

    console.log("\n✅ Configuración completada para todos los usuarios");
  } catch (e) {
    console.error("Error:", e.message);
    console.error("Stack:", e.stack);
  }
  process.exit(0);
}

setupTemplatesForAllUsers();
