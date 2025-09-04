// Script simple para generar un token de prueba
import { pool } from "./src/db/pg.js";
import crypto from "crypto";

console.log("🔧 Iniciando script de prueba para client completion...");

try {
  // Test de conexión
  await pool.query("SELECT 1");
  console.log("✅ Conexión a BD exitosa");

  // Crear usuario test
  const userId = "test-user-" + Date.now();
  await pool.query(
    `
    INSERT INTO users (id, email, password_hash, email_verified, active_account) 
    VALUES ($1, $2, $3, true, true)
  `,
    [userId, `test${Date.now()}@example.com`, "test-hash"]
  );
  console.log("✅ Usuario creado:", userId);

  // Crear cliente test
  const clientId = crypto.randomUUID();
  const clientResult = await pool.query(
    `
    INSERT INTO clients (id, user_id, first_name, last_name, mobile, created_at) 
    VALUES ($1, $2, $3, $4, $5, now()) 
    RETURNING *
  `,
    [clientId, userId, "Juan", "Test", "600999888"]
  );
  console.log("✅ Cliente creado:", clientResult.rows[0]);

  // Crear token
  const tokenId = crypto.randomUUID();
  const tokenResult = await pool.query(
    `
    INSERT INTO client_completion_tokens(id, user_id, client_id, used, expires_at) 
    VALUES($1, $2, $3, false, now() + interval '7 days') 
    RETURNING *
  `,
    [tokenId, userId, clientId]
  );

  console.log("✅ Token generado:", tokenResult.rows[0]);
  console.log("\n🌐 URLs para probar:");
  console.log(
    `   Vite:  http://localhost:5173/completar-datos.html?token=${tokenId}`
  );
  console.log(
    `   Dev:   http://localhost:5174/completar-datos.html?token=${tokenId}`
  );
} catch (error) {
  console.error("❌ Error:", error);
} finally {
  await pool.end();
  console.log("\n✅ Script completado");
}
