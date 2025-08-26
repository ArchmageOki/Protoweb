// Adaptador PostgreSQL para reemplazar gradualmente el store JSON.
// Requiere variables de entorno: PG_URI o (PG_HOST, PG_DB, PG_USER, PG_PASS)
import pg from 'pg'
const { Pool } = pg

const cfg = process.env.PG_URI ? { connectionString: process.env.PG_URI } : {
  host: process.env.PG_HOST || 'localhost',
  port: +(process.env.PG_PORT||5432),
  database: process.env.PG_DB || 'protoweb',
  user: process.env.PG_USER || 'protoweb_user',
  password: process.env.PG_PASS || '2751995'
}

export const pool = new Pool(cfg)

export async function initSchema(){
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
  mobile text unique,
  instagram text,
  dni text unique,
      address text,
      postal_code text,
      birth_date date,
      visits_count int not null default 0,
      total_amount numeric(14,2) not null default 0,
      last_appointment_at timestamptz null,
    notes text,
    is_vip boolean not null default false
    );
  -- Asegurar columna is_vip si la tabla ya existía
  alter table clients add column if not exists is_vip boolean not null default false;
    create index if not exists idx_clients_user on clients(user_id);
    -- Eventos de calendario per-user
    create table if not exists calendar_events (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null,
      description text null,
      start_at timestamptz not null,
      end_at timestamptz not null,
      all_day boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      google_event_id text null,
      google_etag text null,
      deleted boolean not null default false,
      calendar_id text null
    );
  -- Asegurar columnas nuevas si la tabla ya existía antes de añadir soporte Google
  alter table calendar_events add column if not exists google_event_id text null;
  alter table calendar_events add column if not exists google_etag text null;
  alter table calendar_events add column if not exists deleted boolean not null default false;
  alter table calendar_events add column if not exists calendar_id text null;
    create index if not exists idx_events_user on calendar_events(user_id);
    create index if not exists idx_events_user_start on calendar_events(user_id,start_at);
    create index if not exists idx_events_google_evt on calendar_events(google_event_id);
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
  `)
}

export async function pgCreateUser(id, email, password_hash, failed_attempts=0, locked_until=null, created_at=null, last_login_at=null, password_version=1){
  const { rows } = await pool.query(
    `insert into users(id,email,password_hash,failed_attempts,locked_until,created_at,last_login_at,password_version)
     values($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8)
     on conflict (id) do nothing
     returning id,email,created_at`,
    [id, email, password_hash, failed_attempts, locked_until, created_at, last_login_at, password_version]
  )
  if(rows[0]) return rows[0]
  // Si ya existía, devolver la existente
  const existing = await pgFindUserById(id)
  return existing ? { id: existing.id, email: existing.email, created_at: existing.created_at } : null
}

export async function pgFindUserByEmail(email){
  const { rows } = await pool.query('select * from users where email=$1', [email])
  return rows[0] || null
}

export async function pgFindUserById(id){
  const { rows } = await pool.query('select * from users where id=$1', [id])
  return rows[0] || null
}

export async function pgUpdateUserLoginSuccess(id){
  await pool.query('update users set failed_attempts=0, locked_until=null, last_login_at=now() where id=$1',[id])
}

export async function pgRecordLoginFail(id, failed_attempts, locked_until){
  await pool.query('update users set failed_attempts=$2, locked_until=$3 where id=$1',[id, failed_attempts, locked_until])
}

export async function pgInsertRefresh(id, userId, exp, revoked=false){
  await pool.query('insert into refresh_tokens(id, user_id, exp, revoked) values($1,$2,$3,$4) on conflict (id) do nothing', [id, userId, exp, revoked])
}

export async function pgGetRefresh(id){
  const { rows } = await pool.query('select * from refresh_tokens where id=$1', [id])
  return rows[0] || null
}

export async function pgRevokeRefresh(id){
  await pool.query('update refresh_tokens set revoked=true where id=$1', [id])
}
export async function pgRevokeAllUserRefresh(userId){
  await pool.query('update refresh_tokens set revoked=true where user_id=$1 and revoked=false', [userId])
}

export async function pgRotateRefresh(oldId, newId){
  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query('select * from refresh_tokens where id=$1 for update', [oldId])
    if(rows.length===0){ await client.query('rollback'); return null }
    const rec = rows[0]
    const nowSec = Math.floor(Date.now()/1000)
    if(rec.revoked || rec.exp < nowSec){ await client.query('rollback'); return null }
    await client.query('update refresh_tokens set revoked=true where id=$1', [oldId])
    await client.query('insert into refresh_tokens(id,user_id,exp,revoked) values($1,$2,$3,false)', [newId, rec.user_id, rec.exp])
    await client.query('commit')
    return { newId, userId: rec.user_id, exp: rec.exp }
  } catch(e){ await client.query('rollback'); throw e } finally { client.release() }
}

export async function pgDeleteExpiredRefresh(nowSec = Math.floor(Date.now()/1000)){
  await pool.query('delete from refresh_tokens where exp < $1', [nowSec])
}

export function startRefreshCleanup(intervalMs = 15 * 60 * 1000){
  const id = setInterval(()=>{
    pgDeleteExpiredRefresh().catch(e=>console.error('[cleanup] fallo eliminando refresh expirados', e.message))
    // Limpieza tokens reset expirados
  pgDeleteExpiredPasswordResets().catch(e=>console.error('[cleanup] fallo eliminando password reset expirados', e.message))
  pgDeleteExpiredEmailVerifications().catch(e=>console.error('[cleanup] fallo eliminando email verification expirados', e.message))
  }, intervalMs)
  return id
}

export async function pgInsertPasswordReset(id, userId, exp){
  await pool.query('insert into password_reset_tokens(id,user_id,exp,used) values($1,$2,$3,false)', [id,userId,exp])
}
export async function pgInvalidatePasswordResetsForUser(userId){
  // Marca como usadas todas las anteriores para que sólo el último token emitido sea válido
  await pool.query('update password_reset_tokens set used=true where user_id=$1 and used=false', [userId])
}
export async function pgGetPasswordReset(id){
  const { rows } = await pool.query('select * from password_reset_tokens where id=$1', [id])
  return rows[0]||null
}
export async function pgMarkPasswordResetUsed(id){
  await pool.query('update password_reset_tokens set used=true where id=$1', [id])
}
export async function pgDeleteExpiredPasswordResets(nowSec = Math.floor(Date.now()/1000)){
  await pool.query('delete from password_reset_tokens where exp < $1 or used=true and exp < $1', [nowSec])
}

// Email verification tokens
export async function pgInsertEmailVerification(id, userId, exp){
  await pool.query('insert into email_verification_tokens(id,user_id,exp,used) values($1,$2,$3,false)', [id,userId,exp])
}
export async function pgGetEmailVerification(id){
  const { rows } = await pool.query('select * from email_verification_tokens where id=$1', [id])
  return rows[0]||null
}
export async function pgMarkEmailVerificationUsed(id){
  await pool.query('update email_verification_tokens set used=true where id=$1', [id])
}
export async function pgDeleteExpiredEmailVerifications(nowSec = Math.floor(Date.now()/1000)){
  await pool.query('delete from email_verification_tokens where exp < $1 or used=true and exp < $1', [nowSec])
}
export async function pgMarkUserEmailVerified(userId){
  await pool.query('update users set email_verified=true where id=$1', [userId])
}
export async function pgInvalidateEmailVerificationsForUser(userId){
  // Marca como usadas (invalidas) las verificaciones previas no usadas para que sólo el último token generado sea válido
  await pool.query('update email_verification_tokens set used=true where user_id=$1 and used=false', [userId])
}

// --------- CLIENTES ---------
export async function pgCreateClient(id, userId, data){
  // Compatibilidad hacia atrás: acepta name/email/phone/notes y nuevos campos.
  const {
    first_name=null, last_name=null,
    mobile=null,
    instagram=null, dni=null, address=null, postal_code=null, birth_date=null,
  visits_count=0, total_amount=0, last_appointment_at=null, notes=null, is_vip=false
  } = data||{}
  const full_name = [first_name,last_name].filter(Boolean).join(' ').trim() || first_name || last_name || '—'
  const finalMobile = mobile
  // Normalizar fechas vacías a null
  const bd = (birth_date && String(birth_date).trim()) ? birth_date : null
  const laa = (last_appointment_at && String(last_appointment_at).trim()) ? last_appointment_at : null
  const { rows } = await pool.query(`insert into clients(
      id,user_id,notes,first_name,last_name,full_name,mobile,instagram,dni,address,postal_code,birth_date,visits_count,total_amount,last_appointment_at,is_vip
    ) values(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
    ) returning *`, [
      id,userId,notes,first_name,last_name,full_name,finalMobile,instagram,dni,address,postal_code,bd,visits_count,total_amount,laa,is_vip
    ])
  return rows[0]
}
export async function pgListClients(userId){
  const { rows } = await pool.query(`select 
    id,user_id,created_at,updated_at,
    full_name,first_name,last_name,
    mobile,instagram,dni,address,postal_code,birth_date,
  visits_count,total_amount,last_appointment_at,notes,is_vip
    from clients where user_id=$1 order by created_at desc`, [userId])
  return rows
}
export async function pgGetClient(userId, id){
  const { rows } = await pool.query(`select 
    id,user_id,created_at,updated_at,
    full_name,first_name,last_name,
    mobile,instagram,dni,address,postal_code,birth_date,
  visits_count,total_amount,last_appointment_at,notes,is_vip
    from clients where user_id=$1 and id=$2`, [userId,id])
  return rows[0]||null
}
export async function pgUpdateClient(userId, id, data){
  const existing = await pgGetClient(userId, id)
  if(!existing) return null
  const {
    first_name=existing.first_name, last_name=existing.last_name,
    mobile=existing.mobile,
    instagram=existing.instagram, dni=existing.dni, address=existing.address, postal_code=existing.postal_code, birth_date=existing.birth_date,
  visits_count=existing.visits_count, total_amount=existing.total_amount, last_appointment_at=existing.last_appointment_at,
  notes=existing.notes, is_vip=existing.is_vip
  } = data||{}
  const finalMobile = mobile
  const full_name = [first_name,last_name].filter(Boolean).join(' ').trim() || first_name || last_name || existing.full_name
  const bd = (birth_date && String(birth_date).trim()) ? birth_date : null
  const laa = (last_appointment_at && String(last_appointment_at).trim()) ? last_appointment_at : null
  const { rows } = await pool.query(`update clients set
      notes=$3,first_name=$4,last_name=$5,full_name=$6,mobile=$7,instagram=$8,dni=$9,address=$10,postal_code=$11,birth_date=$12,
      visits_count=$13,total_amount=$14,last_appointment_at=$15,is_vip=$16,updated_at=now()
    where user_id=$1 and id=$2 returning *`, [
      userId,id,notes,first_name,last_name,full_name,finalMobile,instagram,dni,address,postal_code,bd,visits_count,total_amount,laa,is_vip
    ])
  return rows[0]||null
}
export async function pgDeleteClient(userId, id){
  const { rowCount } = await pool.query('delete from clients where user_id=$1 and id=$2', [userId,id])
  return rowCount>0
}

// --------- CALENDAR EVENTS ---------
export async function pgCreateEvent(id, userId, { title, description=null, start_at, end_at, all_day=false }){
  const { rows } = await pool.query(`insert into calendar_events(id,user_id,title,description,start_at,end_at,all_day)
    values($1,$2,$3,$4,$5,$6,$7) returning *`, [id,userId,title,description,start_at,end_at,all_day])
  return rows[0]
}
export async function pgListEvents(userId, from=null, to=null){
  if(from && to){
    const { rows } = await pool.query(`select * from calendar_events where user_id=$1 and deleted is not true and start_at >= $2 and start_at <= $3 order by start_at asc`, [userId, from, to])
    return rows
  }
  const { rows } = await pool.query('select * from calendar_events where user_id=$1 and deleted is not true order by start_at asc limit 500', [userId])
  return rows
}
export async function pgGetEvent(userId, id){
  const { rows } = await pool.query('select * from calendar_events where user_id=$1 and id=$2', [userId,id])
  return rows[0]||null
}
export async function pgUpdateEvent(userId, id, { title, description=null, start_at, end_at, all_day=false }){
  const { rows } = await pool.query(`update calendar_events set title=$3,description=$4,start_at=$5,end_at=$6,all_day=$7,updated_at=now()
    where user_id=$1 and id=$2 returning *`, [userId,id,title,description,start_at,end_at,all_day])
  return rows[0]||null
}
export async function pgDeleteEvent(userId, id){
  const { rowCount } = await pool.query('delete from calendar_events where user_id=$1 and id=$2', [userId,id])
  return rowCount>0
}
// Actualiza google_event_id y etag tras creación local + remota
export async function pgAttachGoogleEvent(userId, id, google_event_id, google_etag){
  const { rows } = await pool.query(`
    update calendar_events
      set google_event_id=$3, google_etag=$4, updated_at=now()
      where user_id=$1 and id=$2 and (google_event_id is null or google_event_id=$3)
    returning *
  `, [userId, id, google_event_id, google_etag])
  return rows[0]||null
}
export async function pgUpdateGoogleEtag(userId, id, google_etag){
  await pool.query('update calendar_events set google_etag=$3, updated_at=now() where user_id=$1 and id=$2', [userId,id,google_etag])
}

// --------- WHATSAPP SESSION ---------
export async function pgGetWhatsappSession(userId){
  const { rows } = await pool.query('select * from whatsapp_sessions where user_id=$1', [userId])
  return rows[0]||null
}
export async function pgUpsertWhatsappSession(userId, { phone_number=null, status='inactive', session_json=null }){
  const { rows } = await pool.query(`insert into whatsapp_sessions(user_id,phone_number,status,session_json)
    values($1,$2,$3,$4)
    on conflict (user_id) do update set phone_number=excluded.phone_number,status=excluded.status,session_json=excluded.session_json,updated_at=now()
    returning *`, [userId,phone_number,status,session_json])
  return rows[0]
}
