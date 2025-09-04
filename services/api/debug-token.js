// Debug del token específico jW-13JcV0kCas4mxRNzas
import { pool } from "./src/db/pg.js";

async function debugToken() {
  const tokenId = "jW-13JcV0kCas4mxRNzas";
  console.log("🔍 Debuggeando token:", tokenId);

  try {
    // 1. Verificar que el token existe
    console.log("\n📋 1. Buscando token en client_completion_tokens...");
    const tokenResult = await pool.query(
      "SELECT * FROM client_completion_tokens WHERE id = $1",
      [tokenId]
    );

    if (tokenResult.rows.length === 0) {
      console.log("❌ Token no encontrado en la base de datos");
      return;
    }

    const token = tokenResult.rows[0];
    console.log("✅ Token encontrado:", {
      id: token.id,
      user_id: token.user_id,
      client_id: token.client_id,
      used: token.used,
      expires_at: token.expires_at,
      created_at: token.created_at,
    });

    // 2. Verificar expiración
    console.log("\n⏰ 2. Verificando expiración...");
    const now = new Date();
    const expiresAt = new Date(token.expires_at);
    console.log("Ahora:", now.toISOString());
    console.log("Expira:", expiresAt.toISOString());
    console.log("¿Expirado?", now > expiresAt ? "❌ SÍ" : "✅ NO");
    console.log("¿Usado?", token.used ? "❌ SÍ" : "✅ NO");

    // 3. Verificar que el usuario existe
    console.log("\n👤 3. Verificando usuario...");
    const userResult = await pool.query(
      "SELECT id, email FROM users WHERE id = $1",
      [token.user_id]
    );
    if (userResult.rows.length === 0) {
      console.log("❌ Usuario no encontrado:", token.user_id);
      return;
    }
    console.log("✅ Usuario encontrado:", userResult.rows[0]);

    // 4. Verificar que el cliente existe
    console.log("\n🙋‍♂️ 4. Verificando cliente...");
    const clientResult = await pool.query(
      "SELECT * FROM clients WHERE id = $1 AND user_id = $2",
      [token.client_id, token.user_id]
    );

    if (clientResult.rows.length === 0) {
      console.log(
        "❌ Cliente no encontrado con id:",
        token.client_id,
        "y user_id:",
        token.user_id
      );

      // Buscar el cliente por ID sin filtro de user_id
      const clientAnyUserResult = await pool.query(
        "SELECT * FROM clients WHERE id = $1",
        [token.client_id]
      );
      if (clientAnyUserResult.rows.length > 0) {
        console.log(
          "⚠️ Cliente existe pero con diferente user_id:",
          clientAnyUserResult.rows[0].user_id
        );
      } else {
        console.log("❌ Cliente no existe en absoluto");
      }
      return;
    }

    const client = clientResult.rows[0];
    console.log("✅ Cliente encontrado:", {
      id: client.id,
      user_id: client.user_id,
      first_name: client.first_name,
      last_name: client.last_name,
      mobile: client.mobile,
      dni: client.dni,
      address: client.address,
      postal_code: client.postal_code,
      birth_date: client.birth_date,
      instagram: client.instagram,
    });

    // 5. Simular la respuesta del endpoint
    console.log("\n📡 5. Respuesta que debería generar el endpoint:");
    const response = {
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
    console.log(JSON.stringify(response, null, 2));

    console.log(
      "\n✅ Todos los datos están correctos. El problema puede estar en el endpoint del servidor."
    );
  } catch (error) {
    console.error("❌ Error durante debug:", error.message);
    console.error("Stack trace:", error.stack);
  } finally {
    await pool.end();
  }
}

debugToken();
