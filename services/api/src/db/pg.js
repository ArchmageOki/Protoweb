// Adaptador PostgreSQL para reemplazar gradualmente el store JSON.
// Requiere variables de entorno: PG_URI o (PG_HOST, PG_DB, PG_USER, PG_PASS)
import pg from "pg";
const { Pool } = pg;

const cfg = process.env.PG_URI
  ? { connectionString: process.env.PG_URI }
  : {
      host: process.env.PG_HOST || "localhost",
      port: +(process.env.PG_PORT || 5432),
      database: process.env.PG_DB || "protoweb",
      user: process.env.PG_USER || "protoweb_user",
      password: process.env.PG_PASS || "2751995",
    };

export const pool = new Pool(cfg);

export async function initSchema() {
  await pool.query(`
    create extension if not exists pgcrypto;
    create extension if not exists citext;
    create table if not exists users (
      id text primary key,
      email citext unique not null,
      password_hash text not null,
      failed_attempts int not null default 0,
      locked_until timestamptz null,
      created_at timestamptz not null default now(),
      last_login_at timestamptz null,
  password_version int not null default 1,
      email_verified boolean not null default false,
      active_account boolean not null default false
    );
  -- Asegurar columna añadida después de la creación inicial
  alter table users add column if not exists email_verified boolean not null default false;
    alter table users add column if not exists active_account boolean not null default false;
    create table if not exists refresh_tokens (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      exp bigint not null,
      revoked boolean not null default false,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_refresh_user on refresh_tokens(user_id);
  create index if not exists idx_refresh_exp on refresh_tokens(exp);
    create table if not exists password_reset_tokens (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      exp bigint not null,
      used boolean not null default false,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_prt_user on password_reset_tokens(user_id);
    create index if not exists idx_prt_exp on password_reset_tokens(exp);
    create table if not exists email_verification_tokens (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      exp bigint not null,
      used boolean not null default false,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_evt_user on email_verification_tokens(user_id);
    create index if not exists idx_evt_exp on email_verification_tokens(exp);
    -- Clientes (datos pertenecen al usuario)
  create table if not exists clients (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      first_name text,
      last_name text,
      full_name text,
      mobile text,
      instagram text,
      dni text,
      address text,
      postal_code text,
      birth_date date,
      visits_count int not null default 0,
      total_amount numeric(14,2) not null default 0,
      last_appointment_at timestamptz null,
      notes text,
  is_vip boolean not null default false,
  completed_event_ids text[] not null default '{}'::text[],
  whatsapp_consent boolean null
    );
  -- Asegurar columna is_vip si la tabla ya existía
  alter table clients add column if not exists is_vip boolean not null default false;
  alter table clients add column if not exists completed_event_ids text[] not null default '{}'::text[];
  alter table clients add column if not exists whatsapp_consent boolean null;
  -- Migración tolerante: eliminar NOT NULL y default si existían para permitir estado indeterminado
  do $$ begin
    begin alter table clients alter column whatsapp_consent drop not null; exception when others then null; end;
    begin alter table clients alter column whatsapp_consent drop default; exception when others then null; end;
  end $$;
    create index if not exists idx_clients_user on clients(user_id);
    -- Migrar unicidad móvil/dni a ámbito por usuario
    do $$ begin
      -- Eliminar constraints únicas globales previas si existieran
      if exists (select 1 from pg_constraint where conrelid = 'clients'::regclass and contype='u' and conname like '%mobile%') then
        begin alter table clients drop constraint if exists clients_mobile_key; exception when others then null; end;
      end if;
      if exists (select 1 from pg_constraint where conrelid = 'clients'::regclass and contype='u' and conname like '%dni%') then
        begin alter table clients drop constraint if exists clients_dni_key; exception when others then null; end;
      end if;
    end $$;
    create unique index if not exists u_clients_user_mobile on clients(user_id, mobile) where mobile is not null and mobile <> '';
    create unique index if not exists u_clients_user_dni on clients(user_id, dni) where dni is not null and dni <> '';
    -- Eventos de calendario per-user
    create table if not exists calendar_events (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null,
      description text null,
      start_at timestamptz not null,
      end_at timestamptz not null,
      all_day boolean not null default false,
      google_event_id text null,
      google_etag text null,
      deleted boolean not null default false,
      calendar_id text null,
      client_id text null references clients(id) on delete set null,
      completed_design boolean not null default false,
  extra_check_1 boolean not null default false,
  extra_check_2 boolean not null default false,
  extra_check_3 boolean not null default false,
  is_completed boolean not null default false,
  completed_at timestamptz null,
      total_amount numeric(14,2) null,
      paid_amount numeric(14,2) null,
      notes text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  -- Asegurar columnas nuevas si la tabla ya existía antes de añadir soporte Google
  alter table calendar_events add column if not exists google_event_id text null;
  alter table calendar_events add column if not exists google_etag text null;
  alter table calendar_events add column if not exists deleted boolean not null default false;
  alter table calendar_events add column if not exists calendar_id text null;
  alter table calendar_events add column if not exists client_id text null;
  alter table calendar_events add column if not exists completed_design boolean not null default false;
  alter table calendar_events add column if not exists extra_check_1 boolean not null default false;
  alter table calendar_events add column if not exists extra_check_2 boolean not null default false;
  alter table calendar_events add column if not exists extra_check_3 boolean not null default false;
  alter table calendar_events add column if not exists is_completed boolean not null default false;
  alter table calendar_events add column if not exists completed_at timestamptz null;
  alter table calendar_events add column if not exists total_amount numeric(14,2) null;
  alter table calendar_events add column if not exists paid_amount numeric(14,2) null;
  alter table calendar_events add column if not exists notes text null;
  -- Asegurar foreign key client_id
  do $$
  begin
    if not exists (select 1 from pg_constraint where conname = 'fk_calendar_events_client') then
      alter table calendar_events add constraint fk_calendar_events_client foreign key (client_id) references clients(id) on delete set null;
    end if;
  exception when others then null; end $$;
    create index if not exists idx_events_user on calendar_events(user_id);
    create index if not exists idx_events_user_start on calendar_events(user_id,start_at);
    create index if not exists idx_events_google_evt on calendar_events(google_event_id);
    create index if not exists idx_events_user_client on calendar_events(user_id, client_id);
  -- Sustituimos índice parcial (que impedía ON CONFLICT inference) por índice completo
  drop index if exists u_events_user_google;
  create unique index if not exists u_events_user_google on calendar_events(user_id, google_event_id);
    -- Asegurar constraint única (más explícito para ON CONFLICT)
    do $$
    begin
      if not exists (select 1 from pg_constraint where conname = 'uq_calendar_events_user_google') then
        alter table calendar_events add constraint uq_calendar_events_user_google unique (user_id, google_event_id);
      end if;
    exception when others then
      -- Ignorar si ya existe por carrera
      null;
    end $$;
    -- Cuenta y tokens Google por usuario
    create table if not exists google_calendar_accounts(
      user_id text primary key references users(id) on delete cascade,
      access_token text not null,
      refresh_token text not null,
      token_type text not null,
      scope text null,
      expiry timestamptz not null,
  calendar_id text null,
      sync_token text null,
      last_sync_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    -- Asegurar calendar_id nullable (migración tolerante)
    do $$
    begin
      if exists (select 1 from information_schema.columns where table_name='google_calendar_accounts' and column_name='calendar_id') then
        -- Intentar alterar si es not null
        begin
          alter table google_calendar_accounts alter column calendar_id drop not null;
        exception when others then null; end;
      end if;
    end $$;
    -- Sesión WhatsApp (una por usuario)
    create table if not exists whatsapp_sessions (
      user_id text primary key references users(id) on delete cascade,
      phone_number text null,
      status text not null default 'inactive',
      session_json jsonb null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    -- Historial de mensajes WhatsApp enviados (snapshot de datos del cliente en el momento del envío)
    create table if not exists whatsapp_messages (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      client_id text null references clients(id) on delete set null,
      calendar_event_id text null references calendar_events(id) on delete set null,
      phone text not null,
      client_name text null,
      instagram text null,
      message_text text not null,
      direction text not null default 'outgoing', -- futuro: 'incoming'
      status text not null default 'sent',        -- futuro: 'queued','failed','delivered','read'
      sent_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
    create index if not exists idx_wa_msgs_user_sent on whatsapp_messages(user_id, sent_at desc);
    create index if not exists idx_wa_msgs_user_event on whatsapp_messages(user_id, calendar_event_id);
  alter table whatsapp_messages add column if not exists message_id text null;
  create index if not exists idx_wa_msgs_user_msgid on whatsapp_messages(user_id, message_id);
  -- message_id: id retornado por whatsapp-web.js (para correlacionar con estados futuros)
    -- Cola de mensajes WhatsApp programados (outbox)
    create table if not exists whatsapp_outbox (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      client_id text null references clients(id) on delete set null,
      phone text not null,
      client_name text null,
      instagram text null,
      message_text text not null,
      scheduled_at timestamptz not null,
      status text not null default 'pending', -- pending|sending|sent|failed|cancelled
      attempts int not null default 0,
      last_error text null,
      last_attempt_at timestamptz null,
      sent_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_wa_outbox_user_status_sched on whatsapp_outbox(user_id, status, scheduled_at);
    create index if not exists idx_wa_outbox_sched_status on whatsapp_outbox(status, scheduled_at);
    -- Tokens de un solo uso para completar datos de cliente (flujo público)
    create table if not exists client_completion_tokens (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      client_id text not null references clients(id) on delete cascade,
      used boolean not null default false,
      expires_at timestamptz null,
      created_at timestamptz not null default now(),
      used_at timestamptz null
    );
    alter table client_completion_tokens add column if not exists expires_at timestamptz null;
    create index if not exists idx_cct_user_client on client_completion_tokens(user_id, client_id) where used=false;
    -- Ajustes de usuario (persistencia de configuraciones UI)
    create table if not exists user_settings (
      user_id text primary key references users(id) on delete cascade,
      extra_checks jsonb not null default '{}'::jsonb,
      clientes jsonb not null default '{}'::jsonb,
      auto_title_config jsonb not null default '{}'::jsonb, -- variables/plantilla de título automático
    auto_title_enabled boolean not null default true,      -- preferencia del usuario para usar título automático
  business_needs_consent boolean not null default false, -- si el negocio gestiona consentimientos
  consent_pdf_info jsonb not null default '{}'::jsonb, -- metadatos de la plantilla PDF (filename, size, mimetype)
  consent_field_map jsonb not null default '{}'::jsonb, -- coordenadas de campos { first_name:{page,x,y}, ... }
  consent_fixed_elements jsonb not null default '[]'::jsonb, -- elementos fijos [{id,text,x,y,fontSize}]
  consent_signature text null, -- imagen base64 PNG
  consent_signature_rect jsonb not null default '{}'::jsonb, -- {page,x,y,w,h,ratio}
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    -- Migración tolerante: añadir columna clientes si falta
    do $$
    begin
      -- Migración tolerante: añadir columnas que falten
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='clientes') then
        alter table user_settings add column clientes jsonb not null default '{}'::jsonb;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='auto_title_config') then
        alter table user_settings add column auto_title_config jsonb not null default '{}'::jsonb;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='auto_title_enabled') then
        alter table user_settings add column auto_title_enabled boolean not null default true;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='business_needs_consent') then
        alter table user_settings add column business_needs_consent boolean not null default false;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='consent_pdf_info') then
        alter table user_settings add column consent_pdf_info jsonb not null default '{}'::jsonb;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='consent_field_map') then
        alter table user_settings add column consent_field_map jsonb not null default '{}'::jsonb;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='consent_fixed_elements') then
        alter table user_settings add column consent_fixed_elements jsonb not null default '[]'::jsonb;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='consent_signature') then
        alter table user_settings add column consent_signature text null;
      end if;
      if not exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='consent_signature_rect') then
        alter table user_settings add column consent_signature_rect jsonb not null default '{}'::jsonb;
      end if;
    exception when others then null; end $$;
    create table if not exists whatsapp_remote_sessions (
      session_id VARCHAR(255) PRIMARY KEY,
      session_data BYTEA not null,
      metadata jsonb not null default '{}'::jsonb,
      expires_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_whatsapp_remote_sessions_updated_at on whatsapp_remote_sessions(updated_at);
    -- Plantillas de mensajes por usuario
    create table if not exists user_message_templates (
      user_id text not null references users(id) on delete cascade,
      template_key text not null,
      label text not null,
      content text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (user_id, template_key)
    );
    create index if not exists idx_user_message_templates_user on user_message_templates(user_id);
  `);
}

export async function pgCreateUser(
  id,
  email,
  password_hash,
  failed_attempts = 0,
  locked_until = null,
  created_at = null,
  last_login_at = null,
  password_version = 1
) {
  const { rows } = await pool.query(
    `insert into users(id,email,password_hash,failed_attempts,locked_until,created_at,last_login_at,password_version)
     values($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8)
     on conflict (id) do nothing
     returning id,email,created_at`,
    [
      id,
      email,
      password_hash,
      failed_attempts,
      locked_until,
      created_at,
      last_login_at,
      password_version,
    ]
  );
  if (rows[0]) return rows[0];
  // Si ya existía, devolver la existente
  const existing = await pgFindUserById(id);
  return existing
    ? {
        id: existing.id,
        email: existing.email,
        created_at: existing.created_at,
      }
    : null;
}

// ==== MESSAGE TEMPLATES ====
export async function pgListMessageTemplates(user_id) {
  const { rows } = await pool.query(
    "select template_key,label,content,created_at,updated_at from user_message_templates where user_id=$1 order by template_key",
    [user_id]
  );
  return rows;
}
export async function pgGetMessageTemplate(user_id, key) {
  const { rows } = await pool.query(
    "select template_key,label,content,created_at,updated_at from user_message_templates where user_id=$1 and template_key=$2",
    [user_id, key]
  );
  return rows[0] || null;
}
export async function pgUpsertMessageTemplate(user_id, key, label, content) {
  const { rows } = await pool.query(
    `insert into user_message_templates(user_id,template_key,label,content)
    values($1,$2,$3,$4)
    on conflict (user_id,template_key)
    do update set label=excluded.label, content=excluded.content, updated_at=now()
    returning template_key,label,content,created_at,updated_at`,
    [user_id, key, label, content]
  );
  return rows[0];
}
export async function pgDeleteMessageTemplate(user_id, key) {
  await pool.query(
    "delete from user_message_templates where user_id=$1 and template_key=$2",
    [user_id, key]
  );
  return true;
}

export async function pgFindUserByEmail(email) {
  const { rows } = await pool.query("select * from users where email=$1", [
    email,
  ]);
  return rows[0] || null;
}

export async function pgFindUserById(id) {
  const { rows } = await pool.query("select * from users where id=$1", [id]);
  return rows[0] || null;
}

export async function pgUpdateUserLoginSuccess(id) {
  await pool.query(
    "update users set failed_attempts=0, locked_until=null, last_login_at=now() where id=$1",
    [id]
  );
}

export async function pgRecordLoginFail(id, failed_attempts, locked_until) {
  await pool.query(
    "update users set failed_attempts=$2, locked_until=$3 where id=$1",
    [id, failed_attempts, locked_until]
  );
}

export async function pgInsertRefresh(id, userId, exp, revoked = false) {
  await pool.query(
    "insert into refresh_tokens(id, user_id, exp, revoked) values($1,$2,$3,$4) on conflict (id) do nothing",
    [id, userId, exp, revoked]
  );
}

export async function pgGetRefresh(id) {
  const { rows } = await pool.query(
    "select * from refresh_tokens where id=$1",
    [id]
  );
  return rows[0] || null;
}

export async function pgGetLatestActiveRefresh(userId) {
  const { rows } = await pool.query(
    "select * from refresh_tokens where user_id=$1 and revoked=false order by exp desc limit 1",
    [userId]
  );
  return rows[0] || null;
}

export async function pgRevokeRefresh(id) {
  await pool.query("update refresh_tokens set revoked=true where id=$1", [id]);
}
export async function pgRevokeAllUserRefresh(userId) {
  await pool.query(
    "update refresh_tokens set revoked=true where user_id=$1 and revoked=false",
    [userId]
  );
}

export async function pgRotateRefresh(oldId, newId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      "select * from refresh_tokens where id=$1 for update",
      [oldId]
    );
    if (rows.length === 0) {
      await client.query("rollback");
      return null;
    }
    const rec = rows[0];
    const nowSec = Math.floor(Date.now() / 1000);
    if (rec.revoked || rec.exp < nowSec) {
      await client.query("rollback");
      return null;
    }
    await client.query("update refresh_tokens set revoked=true where id=$1", [
      oldId,
    ]);
    await client.query(
      "insert into refresh_tokens(id,user_id,exp,revoked) values($1,$2,$3,false)",
      [newId, rec.user_id, rec.exp]
    );
    await client.query("commit");
    return { newId, userId: rec.user_id, exp: rec.exp };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function pgDeleteExpiredRefresh(
  nowSec = Math.floor(Date.now() / 1000)
) {
  await pool.query("delete from refresh_tokens where exp < $1", [nowSec]);
}

export function startRefreshCleanup(intervalMs = 15 * 60 * 1000) {
  const id = setInterval(() => {
    pgDeleteExpiredRefresh().catch((e) =>
      console.error("[cleanup] fallo eliminando refresh expirados", e.message)
    );
    // Limpieza tokens reset expirados
    pgDeleteExpiredPasswordResets().catch((e) =>
      console.error(
        "[cleanup] fallo eliminando password reset expirados",
        e.message
      )
    );
    pgDeleteExpiredEmailVerifications().catch((e) =>
      console.error(
        "[cleanup] fallo eliminando email verification expirados",
        e.message
      )
    );
  }, intervalMs);
  return id;
}

export async function pgInsertPasswordReset(id, userId, exp) {
  await pool.query(
    "insert into password_reset_tokens(id,user_id,exp,used) values($1,$2,$3,false)",
    [id, userId, exp]
  );
}
export async function pgInvalidatePasswordResetsForUser(userId) {
  // Marca como usadas todas las anteriores para que sólo el último token emitido sea válido
  await pool.query(
    "update password_reset_tokens set used=true where user_id=$1 and used=false",
    [userId]
  );
}
export async function pgGetPasswordReset(id) {
  const { rows } = await pool.query(
    "select * from password_reset_tokens where id=$1",
    [id]
  );
  return rows[0] || null;
}
export async function pgMarkPasswordResetUsed(id) {
  await pool.query("update password_reset_tokens set used=true where id=$1", [
    id,
  ]);
}
export async function pgDeleteExpiredPasswordResets(
  nowSec = Math.floor(Date.now() / 1000)
) {
  await pool.query(
    "delete from password_reset_tokens where exp < $1 or used=true and exp < $1",
    [nowSec]
  );
}

// Email verification tokens
export async function pgInsertEmailVerification(id, userId, exp) {
  await pool.query(
    "insert into email_verification_tokens(id,user_id,exp,used) values($1,$2,$3,false)",
    [id, userId, exp]
  );
}
export async function pgGetEmailVerification(id) {
  const { rows } = await pool.query(
    "select * from email_verification_tokens where id=$1",
    [id]
  );
  return rows[0] || null;
}
export async function pgMarkEmailVerificationUsed(id) {
  await pool.query(
    "update email_verification_tokens set used=true where id=$1",
    [id]
  );
}
export async function pgDeleteExpiredEmailVerifications(
  nowSec = Math.floor(Date.now() / 1000)
) {
  await pool.query(
    "delete from email_verification_tokens where exp < $1 or used=true and exp < $1",
    [nowSec]
  );
}
export async function pgMarkUserEmailVerified(userId) {
  await pool.query("update users set email_verified=true where id=$1", [
    userId,
  ]);
}
export async function pgInvalidateEmailVerificationsForUser(userId) {
  // Marca como usadas (invalidas) las verificaciones previas no usadas para que sólo el último token generado sea válido
  await pool.query(
    "update email_verification_tokens set used=true where user_id=$1 and used=false",
    [userId]
  );
}

// --------- CLIENTES ---------
export async function pgCreateClient(id, userId, data) {
  // Compatibilidad hacia atrás: acepta name/email/phone/notes y nuevos campos.
  const {
    first_name = null,
    last_name = null,
    mobile = null,
    instagram = null,
    dni = null,
    address = null,
    postal_code = null,
    birth_date = null,
    visits_count = 0,
    total_amount = 0,
    last_appointment_at = null,
    notes = null,
    is_vip = false,
    completed_event_ids = [],
    whatsapp_consent = null,
  } = data || {};
  const full_name =
    [first_name, last_name].filter(Boolean).join(" ").trim() ||
    first_name ||
    last_name ||
    "—";
  // Unicidad móvil/dni se garantiza por índices compuestos (user_id,mobile) y (user_id,dni)
  const finalMobile = mobile;
  // Normalizar fechas vacías a null
  const bd = birth_date && String(birth_date).trim() ? birth_date : null;
  const laa =
    last_appointment_at && String(last_appointment_at).trim()
      ? last_appointment_at
      : null;
  // Normalizar instagram: quitar '@' y forzar minúsculas
  const normInstagram = (() => {
    if (instagram == null) return null;
    let v = String(instagram).trim();
    if (!v) return null;
    v = v.replace(/@+/g, ""); // elimina cualquier '@'
    v = v.toLowerCase();
    return v || null;
  })();
  const { rows } = await pool.query(
    `insert into clients(
      id,user_id,notes,first_name,last_name,full_name,mobile,instagram,dni,address,postal_code,birth_date,visits_count,total_amount,last_appointment_at,is_vip,completed_event_ids,whatsapp_consent
    ) values(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
    ) returning *`,
    [
      id,
      userId,
      notes,
      first_name,
      last_name,
      full_name,
      finalMobile,
      normInstagram,
      dni,
      address,
      postal_code,
      bd,
      visits_count,
      total_amount,
      laa,
      is_vip,
      completed_event_ids,
      whatsapp_consent,
    ]
  );
  return rows[0];
}
export async function pgListClients(userId) {
  const { rows } = await pool.query(
    `select 
    id,user_id,created_at,updated_at,
    full_name,first_name,last_name,
    mobile,instagram,dni,address,postal_code,birth_date,
  visits_count,total_amount,last_appointment_at,notes,is_vip,completed_event_ids,whatsapp_consent
    from clients where user_id=$1 order by created_at desc`,
    [userId]
  );
  return rows;
}
export async function pgGetClient(userId, id) {
  const { rows } = await pool.query(
    `select 
    id,user_id,created_at,updated_at,
    full_name,first_name,last_name,
    mobile,instagram,dni,address,postal_code,birth_date,
  visits_count,total_amount,last_appointment_at,notes,is_vip,completed_event_ids,whatsapp_consent
    from clients where user_id=$1 and id=$2`,
    [userId, id]
  );
  return rows[0] || null;
}
export async function pgUpdateClient(userId, id, data) {
  const existing = await pgGetClient(userId, id);
  if (!existing) return null;
  const {
    first_name = existing.first_name,
    last_name = existing.last_name,
    mobile = existing.mobile,
    instagram = existing.instagram,
    dni = existing.dni,
    address = existing.address,
    postal_code = existing.postal_code,
    birth_date = existing.birth_date,
    visits_count = existing.visits_count,
    total_amount = existing.total_amount,
    last_appointment_at = existing.last_appointment_at,
    notes = existing.notes,
    is_vip = existing.is_vip,
    completed_event_ids = existing.completed_event_ids || [],
    whatsapp_consent = existing.whatsapp_consent,
  } = data || {};
  const finalMobile = mobile;
  const full_name =
    [first_name, last_name].filter(Boolean).join(" ").trim() ||
    first_name ||
    last_name ||
    existing.full_name;
  const bd = birth_date && String(birth_date).trim() ? birth_date : null;
  const laa =
    last_appointment_at && String(last_appointment_at).trim()
      ? last_appointment_at
      : null;
  const normInstagram = (() => {
    if (instagram == null) return null;
    let v = String(instagram).trim();
    if (!v) return null;
    v = v.replace(/@+/g, "");
    v = v.toLowerCase();
    return v || null;
  })();
  const { rows } = await pool.query(
    `update clients set
      notes=$3,first_name=$4,last_name=$5,full_name=$6,mobile=$7,instagram=$8,dni=$9,address=$10,postal_code=$11,birth_date=$12,
      visits_count=$13,total_amount=$14,last_appointment_at=$15,is_vip=$16,completed_event_ids=$17,whatsapp_consent=$18,updated_at=now()
    where user_id=$1 and id=$2 returning *`,
    [
      userId,
      id,
      notes,
      first_name,
      last_name,
      full_name,
      finalMobile,
      normInstagram,
      dni,
      address,
      postal_code,
      bd,
      visits_count,
      total_amount,
      laa,
      is_vip,
      completed_event_ids,
      whatsapp_consent,
    ]
  );
  return rows[0] || null;
}
export async function pgDeleteClient(userId, id) {
  const { rowCount } = await pool.query(
    "delete from clients where user_id=$1 and id=$2",
    [userId, id]
  );
  return rowCount > 0;
}

// --------- CALENDAR EVENTS ---------
// NOTE: requiere migración previa:
// alter table calendar_events add column if not exists is_completed boolean default false;
// alter table calendar_events add column if not exists completed_at timestamptz null;
export async function pgCreateEvent(
  id,
  userId,
  {
    title,
    description = null,
    start_at,
    end_at,
    all_day = false,
    client_id = null,
    completed_design = false,
    extra_check_1 = false,
    extra_check_2 = false,
    extra_check_3 = false,
    total_amount = null,
    paid_amount = null,
    notes = null,
    is_completed = false,
  }
) {
  const { rows } = await pool.query(
    `insert into calendar_events(id,user_id,title,description,start_at,end_at,all_day,client_id,completed_design,extra_check_1,extra_check_2,extra_check_3,total_amount,paid_amount,notes,is_completed,completed_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, case when $16=true then now() else null end) returning *`,
    [
      id,
      userId,
      title,
      description,
      start_at,
      end_at,
      all_day,
      client_id,
      completed_design,
      extra_check_1,
      extra_check_2,
      extra_check_3,
      total_amount,
      paid_amount,
      notes,
      is_completed,
    ]
  );
  return rows[0];
}
export async function pgListEvents(userId, from = null, to = null) {
  if (from && to) {
    const { rows } = await pool.query(
      `select * from calendar_events where user_id=$1 and deleted is not true and start_at >= $2 and start_at <= $3 order by start_at asc`,
      [userId, from, to]
    );
    return rows;
  }
  const { rows } = await pool.query(
    "select * from calendar_events where user_id=$1 and deleted is not true order by start_at asc limit 500",
    [userId]
  );
  return rows;
}
export async function pgGetEvent(userId, id) {
  const { rows } = await pool.query(
    "select * from calendar_events where user_id=$1 and id=$2",
    [userId, id]
  );
  return rows[0] || null;
}
export async function pgUpdateEvent(
  userId,
  id,
  {
    title,
    description = null,
    start_at,
    end_at,
    all_day = false,
    client_id = null,
    completed_design = false,
    extra_check_1 = false,
    extra_check_2 = false,
    extra_check_3 = false,
    total_amount = null,
    paid_amount = null,
    notes = null,
    is_completed = false,
  }
) {
  const { rows } = await pool.query(
    `update calendar_events set title=$3,description=$4,start_at=$5,end_at=$6,all_day=$7,client_id=$8,completed_design=$9,extra_check_1=$10,extra_check_2=$11,extra_check_3=$12,total_amount=$13,paid_amount=$14,notes=$15,is_completed=$16,completed_at=case when $16=true and completed_at is null then now() else completed_at end,updated_at=now()
    where user_id=$1 and id=$2 returning *`,
    [
      userId,
      id,
      title,
      description,
      start_at,
      end_at,
      all_day,
      client_id,
      completed_design,
      extra_check_1,
      extra_check_2,
      extra_check_3,
      total_amount,
      paid_amount,
      notes,
      is_completed,
    ]
  );
  return rows[0] || null;
}
export async function pgCompleteEvent(userId, id) {
  const { rows } = await pool.query(
    `update calendar_events set is_completed=true, completed_at=coalesce(completed_at, now()), updated_at=now() where user_id=$1 and id=$2 and is_completed is not true returning *`,
    [userId, id]
  );
  return rows[0] || null;
}
// Recalcular estadísticas de un cliente a partir de eventos completados
export async function pgRecalcClientCompletedStats(userId, clientId) {
  // Se toma la "última cita" como el end_at más reciente (si end_at es null, se usa start_at)
  const { rows } = await pool.query(
    `with agg as (
    select coalesce(array_agg(id order by coalesce(end_at,start_at) desc), '{}') as ids,
           count(*) as visits,
           coalesce(sum(coalesce(total_amount,0)),0) as total,
           max(coalesce(end_at,start_at)) as last_completed
    from calendar_events
    where user_id=$1 and client_id=$2 and is_completed=true and deleted is not true
  )
  update clients c
    set completed_event_ids = agg.ids,
        visits_count = agg.visits,
        total_amount = agg.total,
        last_appointment_at = agg.last_completed,
        updated_at = now()
  from agg
  where c.user_id=$1 and c.id=$2
  returning c.*`,
    [userId, clientId]
  );
  return rows[0] || null;
}
export async function pgDeleteEvent(userId, id) {
  const { rowCount } = await pool.query(
    "delete from calendar_events where user_id=$1 and id=$2",
    [userId, id]
  );
  return rowCount > 0;
}
// Listar eventos completados de un cliente (histórico)
export async function pgListCompletedEventsForClient(
  userId,
  clientId,
  limit = 200
) {
  const { rows } = await pool.query(
    `select id, title, description, start_at, end_at, total_amount, paid_amount, notes, completed_at
    from calendar_events where user_id=$1 and client_id=$2 and deleted is not true and is_completed=true
    order by coalesce(completed_at,start_at) desc limit $3`,
    [userId, clientId, Math.min(Math.max(limit, 1), 500)]
  );
  return rows;
}
// Actualiza google_event_id y etag tras creación local + remota
export async function pgAttachGoogleEvent(
  userId,
  id,
  google_event_id,
  google_etag
) {
  const { rows } = await pool.query(
    `
    update calendar_events
      set google_event_id=$3, google_etag=$4, updated_at=now()
      where user_id=$1 and id=$2 and (google_event_id is null or google_event_id=$3)
    returning *
  `,
    [userId, id, google_event_id, google_etag]
  );
  return rows[0] || null;
}
export async function pgUpdateGoogleEtag(userId, id, google_etag) {
  await pool.query(
    "update calendar_events set google_etag=$3, updated_at=now() where user_id=$1 and id=$2",
    [userId, id, google_etag]
  );
}

// --------- WHATSAPP SESSION ---------
export async function pgGetWhatsappSession(userId) {
  const { rows } = await pool.query(
    "select * from whatsapp_sessions where user_id=$1",
    [userId]
  );
  return rows[0] || null;
}
export async function pgUpsertWhatsappSession(
  userId,
  { phone_number = null, status = "inactive", session_json = null }
) {
  const { rows } = await pool.query(
    `insert into whatsapp_sessions(user_id,phone_number,status,session_json)
    values($1,$2,$3,$4)
    on conflict (user_id) do update set phone_number=excluded.phone_number,status=excluded.status,session_json=excluded.session_json,updated_at=now()
    returning *`,
    [userId, phone_number, status, session_json]
  );
  return rows[0];
}

// --------- WHATSAPP MESSAGES ---------
export async function pgInsertWhatsappMessage(
  id,
  userId,
  {
    client_id = null,
    calendar_event_id = null,
    phone,
    client_name = null,
    instagram = null,
    message_text,
    direction = "outgoing",
    status = "sent",
    sent_at = null,
    message_id = null,
  }
) {
  if (!phone) throw new Error("phone required");
  if (!message_text) throw new Error("message_text required");
  const { rows } = await pool.query(
    `insert into whatsapp_messages(
    id,user_id,client_id,calendar_event_id,phone,client_name,instagram,message_text,direction,status,sent_at,message_id
  ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11, now()),$12) returning *`,
    [
      id,
      userId,
      client_id,
      calendar_event_id,
      phone,
      client_name,
      instagram,
      message_text,
      direction,
      status,
      sent_at,
      message_id,
    ]
  );
  return rows[0];
}
export async function pgListWhatsappMessages(
  userId,
  { limit = 100, offset = 0 } = {}
) {
  limit = Math.min(Math.max(limit, 1), 500);
  offset = Math.max(offset, 0);
  const { rows } = await pool.query(
    `select * from (
    select *, count(*) over() as __total from whatsapp_messages where user_id=$1
  ) t order by sent_at desc limit $2 offset $3`,
    [userId, limit, offset]
  );
  const total = rows[0] ? Number(rows[0].__total) : 0;
  return {
    items: rows.map((r) => {
      const { __total, ...rest } = r;
      return rest;
    }),
    total,
  };
}

// --------- USER SETTINGS ---------
export async function pgGetUserSettings(userId) {
  try {
    await pool.query(`
      alter table user_settings add column if not exists auto_title_config jsonb not null default '{}'::jsonb;
      alter table user_settings add column if not exists auto_title_enabled boolean not null default true;
      alter table user_settings add column if not exists business_needs_consent boolean not null default false;
      alter table user_settings add column if not exists consent_pdf_info jsonb not null default '{}'::jsonb;
      alter table user_settings add column if not exists consent_field_map jsonb not null default '{}'::jsonb;
      alter table user_settings add column if not exists consent_fixed_elements jsonb not null default '[]'::jsonb;
      alter table user_settings add column if not exists consent_signature text null;
      alter table user_settings add column if not exists consent_signature_rect jsonb not null default '{}'::jsonb;
    `);
  } catch (e) {
    /* silencioso */
  }
  const { rows } = await pool.query(
    "select user_id, extra_checks, clientes, auto_title_config, auto_title_enabled, business_needs_consent, consent_pdf_info, consent_field_map, consent_fixed_elements, consent_signature, consent_signature_rect, created_at, updated_at from user_settings where user_id=$1",
    [userId]
  );
  return rows[0] || null;
}
export async function pgUpsertUserSettings(
  userId,
  {
    extra_checks = {},
    clientes = {},
    auto_title_config = {},
    auto_title_enabled = true,
    business_needs_consent = false,
    consent_pdf_info = {},
    consent_field_map = {},
    consent_fixed_elements = [],
    consent_signature = null,
    consent_signature_rect = {},
  }
) {
  try {
    await pool.query(`
      alter table user_settings add column if not exists auto_title_config jsonb not null default '{}'::jsonb;
      alter table user_settings add column if not exists auto_title_enabled boolean not null default true;
      alter table user_settings add column if not exists business_needs_consent boolean not null default false;
      alter table user_settings add column if not exists consent_pdf_info jsonb not null default '{}'::jsonb;
      alter table user_settings add column if not exists consent_field_map jsonb not null default '{}'::jsonb;
      alter table user_settings add column if not exists consent_fixed_elements jsonb not null default '[]'::jsonb;
      alter table user_settings add column if not exists consent_signature text null;
      alter table user_settings add column if not exists consent_signature_rect jsonb not null default '{}'::jsonb;
    `);
  } catch (e) {
    /* silencioso */
  }
  if (typeof extra_checks !== "object" || Array.isArray(extra_checks))
    extra_checks = {};
  if (typeof clientes !== "object" || Array.isArray(clientes)) clientes = {};
  if (typeof auto_title_config !== "object" || Array.isArray(auto_title_config))
    auto_title_config = {};
  if (typeof consent_pdf_info !== "object" || Array.isArray(consent_pdf_info))
    consent_pdf_info = {};
  if (typeof consent_field_map !== "object" || Array.isArray(consent_field_map))
    consent_field_map = {};
  if (!Array.isArray(consent_fixed_elements)) consent_fixed_elements = [];
  if (
    typeof consent_signature_rect !== "object" ||
    Array.isArray(consent_signature_rect)
  )
    consent_signature_rect = {};
  auto_title_enabled = !!auto_title_enabled;
  business_needs_consent = !!business_needs_consent;
  // Serialización defensiva para evitar estructuras no planas / prototipos extraños
  try {
    const serialized = JSON.stringify(consent_fixed_elements);
    try {
      consent_fixed_elements = JSON.parse(serialized);
    } catch (_e) {
      consent_fixed_elements = [];
    }
  } catch (_e) {
    consent_fixed_elements = [];
  }
  try {
    const serializedRect = JSON.stringify(consent_signature_rect);
    try {
      consent_signature_rect = JSON.parse(serializedRect);
    } catch (_e) {
      consent_signature_rect = {};
    }
  } catch (_e) {
    consent_signature_rect = {};
  }
  // Log eliminado: fixed_elements param preview
  // Preparar strings JSON explícitos para evitar doble serializaciones anómalas
  const jExtra = JSON.stringify(extra_checks);
  const jClientes = JSON.stringify(clientes);
  const jAutoTitle = JSON.stringify(auto_title_config);
  const jPdfInfo = JSON.stringify(consent_pdf_info);
  const jFieldMap = JSON.stringify(consent_field_map);
  const jFixed = JSON.stringify(consent_fixed_elements);
  const jSigRect = JSON.stringify(consent_signature_rect);
  // Log eliminado: param types y tamaños
  const { rows } = await pool.query(
    `insert into user_settings(
      user_id,extra_checks,clientes,auto_title_config,auto_title_enabled,business_needs_consent,consent_pdf_info,consent_field_map,consent_fixed_elements,consent_signature,consent_signature_rect)
    values($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb)
    on conflict (user_id) do update set
      extra_checks=excluded.extra_checks,
      clientes=excluded.clientes,
      auto_title_config=excluded.auto_title_config,
      auto_title_enabled=excluded.auto_title_enabled,
      business_needs_consent=excluded.business_needs_consent,
      consent_pdf_info=excluded.consent_pdf_info,
      consent_field_map=excluded.consent_field_map,
      consent_fixed_elements=excluded.consent_fixed_elements,
      consent_signature=excluded.consent_signature,
      consent_signature_rect=excluded.consent_signature_rect,
      updated_at=now()
    returning user_id, extra_checks, clientes, auto_title_config, auto_title_enabled, business_needs_consent, consent_pdf_info, consent_field_map, consent_fixed_elements, consent_signature, consent_signature_rect, created_at, updated_at`,
    [
      userId,
      jExtra,
      jClientes,
      jAutoTitle,
      auto_title_enabled,
      business_needs_consent,
      jPdfInfo,
      jFieldMap,
      jFixed,
      consent_signature,
      jSigRect,
    ]
  );
  return rows[0];
}

// --------- WHATSAPP OUTBOX ---------
export async function pgOutboxInsert(
  id,
  userId,
  {
    client_id = null,
    phone,
    client_name = null,
    instagram = null,
    message_text,
    scheduled_at,
  }
) {
  if (!phone) throw new Error("phone required");
  if (!message_text) throw new Error("message_text required");
  const { rows } = await pool.query(
    `insert into whatsapp_outbox(
    id,user_id,client_id,phone,client_name,instagram,message_text,scheduled_at
  ) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [
      id,
      userId,
      client_id,
      phone,
      client_name,
      instagram,
      message_text,
      scheduled_at,
    ]
  );
  return rows[0];
}
export async function pgOutboxListPending(userId) {
  const { rows } = await pool.query(
    `select * from whatsapp_outbox where user_id=$1 and status in ('pending','sending') order by scheduled_at asc limit 500`,
    [userId]
  );
  return rows;
}
export async function pgOutboxListDue(limit = 20) {
  const { rows } = await pool.query(
    `select * from whatsapp_outbox where status='pending' and scheduled_at <= now() order by scheduled_at asc limit $1`,
    [limit]
  );
  return rows;
}
export async function pgOutboxMarkSending(id) {
  const { rows } = await pool.query(
    `update whatsapp_outbox set status='sending', updated_at=now(), last_attempt_at=now(), attempts=attempts+1 where id=$1 and status='pending' returning *`,
    [id]
  );
  return rows[0] || null;
}
export async function pgOutboxMarkResult(id, { ok, error = null }) {
  if (ok) {
    const { rows } = await pool.query(
      `update whatsapp_outbox set status='sent', sent_at=now(), updated_at=now() where id=$1 returning *`,
      [id]
    );
    return rows[0] || null;
  } else {
    const { rows } = await pool.query(
      `update whatsapp_outbox set status=case when attempts>=5 then 'failed' else 'pending' end, last_error=$2, updated_at=now(), scheduled_at= case when attempts>=5 then scheduled_at else now() + interval '30 seconds' * (attempts+1) end where id=$1 returning *`,
      [id, error]
    );
    return rows[0] || null;
  }
}
export async function pgOutboxCancel(id, userId) {
  const { rows } = await pool.query(
    `update whatsapp_outbox set status='cancelled', updated_at=now() where id=$1 and user_id=$2 and status in ('pending','sending') returning *`,
    [id, userId]
  );
  return rows[0] || null;
}

// --------- CLIENT COMPLETION TOKENS ---------
export async function pgCreateClientCompletionToken(id, userId, clientId) {
  const { rows } = await pool.query(
    `insert into client_completion_tokens(id,user_id,client_id,used,expires_at) values($1,$2,$3,false, now() + interval '7 days') returning *`,
    [id, userId, clientId]
  );
  return rows[0];
}
export async function pgGetClientCompletionToken(id) {
  const { rows } = await pool.query(
    "select * from client_completion_tokens where id=$1",
    [id]
  );
  return rows[0] || null;
}
export async function pgMarkClientCompletionTokenUsed(id) {
  await pool.query(
    "update client_completion_tokens set used=true, used_at=now() where id=$1",
    [id]
  );
}
export async function pgOutboxGet(id, userId) {
  const { rows } = await pool.query(
    `select * from whatsapp_outbox where id=$1 and user_id=$2`,
    [id, userId]
  );
  return rows[0] || null;
}
