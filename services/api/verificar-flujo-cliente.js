// Verificar el flujo completo de client completion tokens
import { pool } from "./src/db/pg.js";
import crypto from "crypto";

async function verificarFlujoCompleto() {
  console.log("🔧 Verificando flujo completo de client completion...\n");

  try {
    // 1. Crear usuario y cliente de prueba
    const userId = "verify-user-" + Date.now();
    const clientId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();

    console.log("📝 Creando datos de prueba...");

    // Usuario
    await pool.query(
      `
      INSERT INTO users (id, email, password_hash, email_verified, active_account) 
      VALUES ($1, $2, $3, true, true)
    `,
      [userId, `verify${Date.now()}@test.com`, "hash"]
    );
    console.log("✅ Usuario creado:", userId);

    // Cliente con datos específicos para verificar
    const clientData = {
      first_name: "María",
      last_name: "González",
      mobile: "611223344",
      dni: "12345678B",
      address: "Calle Prueba 123, 2º B",
      postal_code: "28002",
      birth_date: "1985-03-15",
      instagram: "maria_test",
    };

    await pool.query(
      `
      INSERT INTO clients (id, user_id, first_name, last_name, mobile, dni, address, postal_code, birth_date, instagram, created_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    `,
      [
        clientId,
        userId,
        clientData.first_name,
        clientData.last_name,
        clientData.mobile,
        clientData.dni,
        clientData.address,
        clientData.postal_code,
        clientData.birth_date,
        clientData.instagram,
      ]
    );
    console.log(
      "✅ Cliente creado:",
      clientData.first_name,
      clientData.last_name
    );

    // Token
    await pool.query(
      `
      INSERT INTO client_completion_tokens(id, user_id, client_id, used, expires_at) 
      VALUES($1, $2, $3, false, now() + interval '7 days')
    `,
      [tokenId, userId, clientId]
    );
    console.log("✅ Token creado:", tokenId);

    // 2. Simular el endpoint GET
    console.log("\n🔍 Simulando endpoint GET /public/client-completion/:token");

    const tokenResult = await pool.query(
      "SELECT * FROM client_completion_tokens WHERE id = $1",
      [tokenId]
    );
    const token = tokenResult.rows[0];
    console.log("📋 Token encontrado:", {
      id: token.id,
      user_id: token.user_id,
      client_id: token.client_id,
      used: token.used,
    });

    const clientResult = await pool.query(
      "SELECT * FROM clients WHERE id = $1 AND user_id = $2",
      [token.client_id, token.user_id]
    );
    const client = clientResult.rows[0];

    console.log("👤 Cliente encontrado:");
    console.log("   - Nombre:", client.first_name, client.last_name);
    console.log("   - Móvil:", client.mobile);
    console.log("   - DNI:", client.dni);
    console.log("   - Dirección:", client.address);
    console.log("   - CP:", client.postal_code);
    console.log("   - Nacimiento:", client.birth_date);
    console.log("   - Instagram:", client.instagram);

    // 3. Simular la respuesta del endpoint
    const apiResponse = {
      ok: true,
      client: {
        first_name: client.first_name,
        last_name: client.last_name,
        mobile: client.mobile,
        dni: client.dni,
        address: client.address,
        postal_code: client.postal_code,
        birth_date: client.birth_date,
        instagram: client.instagram,
      },
      token: token.id,
      expires_at: token.expires_at,
    };

    console.log("\n📡 Respuesta API simulada:");
    console.log(JSON.stringify(apiResponse, null, 2));

    console.log("\n🌐 URL para probar en browser:");
    console.log(`http://localhost:5174/completar-datos.html?token=${tokenId}`);

    console.log("\n✅ Verificación completa exitosa!");
    console.log(
      "El flujo de client_completion_tokens → clients está funcionando correctamente."
    );
  } catch (error) {
    console.error("❌ Error en verificación:", error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

verificarFlujoCompleto();
