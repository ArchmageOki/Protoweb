import { pool } from "./src/db/pg.js";

async function checkUserMessageTemplates() {
  try {
    // Verificar estructura de la tabla
    console.log("=== ESTRUCTURA DE LA TABLA user_message_templates ===");
    const structureResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'user_message_templates' 
      ORDER BY ordinal_position;
    `);

    console.table(structureResult.rows);

    // Verificar datos actuales
    console.log("\n=== DATOS EN LA TABLA user_message_templates ===");
    const dataResult = await pool.query(`
      SELECT user_id, template_key, label, 
             length(content) as content_length,
             created_at, updated_at
      FROM user_message_templates 
      ORDER BY user_id, template_key;
    `);

    console.table(dataResult.rows);

    // Verificar relación con usuarios
    console.log("\n=== RELACIÓN CON TABLA users ===");
    const relationResult = await pool.query(`
      SELECT 
        u.id as user_id,
        u.email,
        count(t.template_key) as template_count,
        array_agg(t.template_key) as templates
      FROM users u
      LEFT JOIN user_message_templates t ON u.id = t.user_id
      GROUP BY u.id, u.email
      ORDER BY u.email;
    `);

    console.table(relationResult.rows);

    // Verificar constraint de foreign key
    console.log("\n=== CONSTRAINTS DE LA TABLA ===");
    const constraintResult = await pool.query(`
      SELECT 
        tc.constraint_name, 
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.table_name = 'user_message_templates';
    `);

    console.table(constraintResult.rows);
  } catch (e) {
    console.error("Error:", e.message);
    console.error("Stack:", e.stack);
  }
  process.exit(0);
}

checkUserMessageTemplates();
