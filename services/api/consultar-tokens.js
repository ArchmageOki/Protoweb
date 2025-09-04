// Script para consultar los tokens de completar datos almacenados
import { pool } from "./src/db/pg.js";

async function consultarTokens() {
  console.log("🔍 Consultando tokens de completar datos...\n");

  try {
    // Consultar todos los tokens
    const allTokens = await pool.query(`
      SELECT 
        cct.id,
        cct.user_id,
        cct.client_id,
        cct.used,
        cct.expires_at,
        cct.created_at,
        cct.used_at,
        c.first_name,
        c.last_name,
        c.mobile,
        u.email,
        CASE 
          WHEN cct.used = true THEN 'USADO'
          WHEN cct.expires_at < NOW() THEN 'EXPIRADO'
          ELSE 'VÁLIDO'
        END as estado
      FROM client_completion_tokens cct
      JOIN clients c ON cct.client_id = c.id
      JOIN users u ON cct.user_id = u.id
      ORDER BY cct.created_at DESC
      LIMIT 10
    `);

    console.log("📊 TOKENS RECIENTES (últimos 10):");
    console.log("=".repeat(80));

    if (allTokens.rows.length === 0) {
      console.log("❌ No hay tokens en la base de datos");
      return;
    }

    allTokens.rows.forEach((token, index) => {
      console.log(`\n${index + 1}. TOKEN ${token.estado}`);
      console.log(`   ID: ${token.id}`);
      console.log(
        `   Cliente: ${token.first_name} ${token.last_name} (${token.mobile})`
      );
      console.log(`   Usuario: ${token.email}`);
      console.log(`   Creado: ${token.created_at.toLocaleString()}`);
      console.log(
        `   Expira: ${token.expires_at?.toLocaleString() || "Sin fecha"}`
      );
      if (token.used_at) {
        console.log(`   Usado: ${token.used_at.toLocaleString()}`);
      }
      console.log(
        `   URL: http://localhost:5174/completar-datos.html?token=${token.id}`
      );
    });

    // Estadísticas
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE used = true) as usados,
        COUNT(*) FILTER (WHERE expires_at < NOW() AND used = false) as expirados,
        COUNT(*) FILTER (WHERE expires_at >= NOW() AND used = false) as validos
      FROM client_completion_tokens
    `);

    const stat = stats.rows[0];
    console.log("\n📈 ESTADÍSTICAS:");
    console.log("=".repeat(40));
    console.log(`   Total de tokens: ${stat.total}`);
    console.log(`   ✅ Válidos: ${stat.validos}`);
    console.log(`   ✔️  Usados: ${stat.usados}`);
    console.log(`   ❌ Expirados: ${stat.expirados}`);
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await pool.end();
    console.log("\n🔚 Consulta completada");
  }
}

// Ejecutar
consultarTokens();
