-- ============================================================================
-- Fiora · Explorar: emisoras favoritas, colecciones de radios, pasaporte musical y preferencias
-- ----------------------------------------------------------------------------
-- Ejecútalo una vez en Supabase → SQL Editor (o con `supabase db push`), después de
-- 20261114120000_playlists.sql (reutiliza su bucket de imágenes). Es idempotente.
--
-- Solo se guardan datos propios del usuario. Los catálogos (Radio Browser, Internet Archive,
-- Openverse…) NO se copian: de cada emisora se guarda una ficha mínima de referencia
-- (uuid, nombre, URL del stream, logo, país, etiquetas) para poder mostrarla sin conexión.
--
-- Tablas (todas con RLS: cada usuario solo ve y modifica lo suyo; el rol anon no tiene acceso):
--   fiora_radio_favorites         emisoras favoritas
--   fiora_radio_collections       colecciones personales de emisoras (nombre, descripción, portada)
--   fiora_radio_collection_items  emisoras de cada colección, con su orden
--   fiora_passport                un sello por país descubierto (primera y última vez, y la emisora)
--   fiora_explore_prefs           preferencias de Explorar (mezclador, pasaporte, Atlas, viajes…)
-- Funciones: fiora_load_explore, fiora_radio_fav, fiora_save_radio_collection,
--            fiora_passport_stamp, fiora_save_explore_prefs
-- Storage:   las portadas de las colecciones van al bucket `fiora-playlists`
--            (16 MB por archivo) en `{user_id}/radio-{colección}/covers/…`.
-- ============================================================================

-- Ficha de emisora: objeto JSON pequeño con un uuid válido (nunca audio).
create or replace function public.fiora_valid_station(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(s) = 'object' and pg_column_size(s) <= 4096
     and coalesce(s->>'uuid', '') ~ '^[0-9a-fA-F-]{8,64}$'
     and coalesce(s->>'url', '') ~ '^https?://'
$$;

-- ---------------------------------------------------------------- tablas
create table if not exists public.fiora_radio_favorites (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  station_uuid text        not null check (station_uuid ~ '^[0-9a-fA-F-]{8,64}$'),
  station      jsonb       not null check (public.fiora_valid_station(station)),
  added_at     timestamptz not null default now(),
  primary key (user_id, station_uuid)
);

create table if not exists public.fiora_radio_collections (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null check (char_length(id) between 1 and 64),
  name        text        not null default '' check (char_length(name) <= 80),
  description text        not null default '' check (char_length(description) <= 500),
  cover       jsonb       not null default '{}' check (jsonb_typeof(cover) = 'object' and pg_column_size(cover) <= 2048),
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.fiora_radio_collection_items (
  user_id       uuid    not null default auth.uid(),
  collection_id text    not null,
  station_uuid  text    not null check (station_uuid ~ '^[0-9a-fA-F-]{8,64}$'),
  position      integer not null check (position between 0 and 999),
  station       jsonb   not null check (public.fiora_valid_station(station)),
  primary key (user_id, collection_id, station_uuid),
  foreign key (user_id, collection_id) references public.fiora_radio_collections (user_id, id) on delete cascade
);

-- Un sello por país. Solo lo imprescindible: cuándo se descubrió y con qué emisora.
create table if not exists public.fiora_passport (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  country_code text        not null check (country_code ~ '^[A-Z]{2}$'),
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  station_uuid text        not null default '' check (char_length(station_uuid) <= 64),
  station_name text        not null default '' check (char_length(station_name) <= 200),
  primary key (user_id, country_code)
);

create table if not exists public.fiora_explore_prefs (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs      jsonb       not null default '{}' check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) <= 16384),
  updated_at timestamptz not null default now()
);

create index if not exists fiora_radio_items_order on public.fiora_radio_collection_items (user_id, collection_id, position);

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['fiora_radio_favorites', 'fiora_radio_collections', 'fiora_radio_collection_items',
                           'fiora_passport', 'fiora_explore_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "propietario" on public.%I', t);
    execute format('create policy "propietario" on public.%I for all to authenticated
                      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Máximo de colecciones y de emisoras por colección (evita abusos sin limitar el uso normal).
create or replace function public.fiora_radio_limits() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'fiora_radio_collections' then
    if (select count(*) from public.fiora_radio_collections where user_id = new.user_id and not deleted) >= 200 then
      raise exception 'Máximo de 200 colecciones' using errcode = 'check_violation';
    end if;
  elsif (select count(*) from public.fiora_radio_collection_items where user_id = new.user_id and collection_id = new.collection_id) >= 500 then
    raise exception 'Máximo de 500 emisoras por colección' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists fiora_radio_collections_limit on public.fiora_radio_collections;
create trigger fiora_radio_collections_limit before insert on public.fiora_radio_collections
  for each row execute function public.fiora_radio_limits();
drop trigger if exists fiora_radio_items_limit on public.fiora_radio_collection_items;
create trigger fiora_radio_items_limit before insert on public.fiora_radio_collection_items
  for each row execute function public.fiora_radio_limits();

-- ---------------------------------------------------------------- funciones
-- Todas son SECURITY INVOKER: se ejecutan con los permisos de quien llama, así que RLS se aplica.

-- Todo lo de Explorar del usuario en una sola petición.
create or replace function public.fiora_load_explore() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('uuid', f.station_uuid, 'station', f.station,
                   'at', (extract(epoch from f.added_at) * 1000)::bigint) order by f.added_at desc)
                   from public.fiora_radio_favorites f where f.user_id = auth.uid()), '[]'),
    'collections', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', c.id, 'name', c.name, 'description', c.description, 'cover', c.cover, 'deleted', c.deleted,
                   'createdAt', (extract(epoch from c.created_at) * 1000)::bigint,
                   'updatedAt', (extract(epoch from c.updated_at) * 1000)::bigint,
                   'items', coalesce((select jsonb_agg(jsonb_build_object('uuid', i.station_uuid, 'station', i.station) order by i.position)
                              from public.fiora_radio_collection_items i where i.user_id = c.user_id and i.collection_id = c.id), '[]'))
                   order by c.created_at)
                   from public.fiora_radio_collections c where c.user_id = auth.uid()), '[]'),
    'passport', coalesce((select jsonb_agg(jsonb_build_object('cc', p.country_code, 'uuid', p.station_uuid, 'name', p.station_name,
                   'first', (extract(epoch from p.first_at) * 1000)::bigint, 'last', (extract(epoch from p.last_at) * 1000)::bigint)
                   order by p.first_at)
                   from public.fiora_passport p where p.user_id = auth.uid()), '[]'),
    'prefs', coalesce((select x.prefs from public.fiora_explore_prefs x where x.user_id = auth.uid()), '{}'),
    'prefsAt', coalesce((select (extract(epoch from x.updated_at) * 1000)::bigint from public.fiora_explore_prefs x where x.user_id = auth.uid()), 0)
  )
$$;

-- Marca o desmarca una emisora como favorita.
create or replace function public.fiora_radio_fav(station jsonb, fav boolean, at double precision default null) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare u uuid := auth.uid(); id text := station->>'uuid';
begin
  if u is null then raise exception 'Hace falta iniciar sesión' using errcode = '42501'; end if;
  if id is null or id !~ '^[0-9a-fA-F-]{8,64}$' then raise exception 'Emisora no válida' using errcode = '22023'; end if;
  if fav then
    insert into public.fiora_radio_favorites (user_id, station_uuid, station, added_at)
    values (u, id, station, coalesce(to_timestamp(at / 1000), now()))
    on conflict (user_id, station_uuid) do update set station = excluded.station;
  else
    delete from public.fiora_radio_favorites where user_id = u and station_uuid = id;
  end if;
  return true;
end $$;

-- Guarda una colección y sus emisoras de una vez. Si en Supabase hay una versión más reciente
-- (otro dispositivo), no pisa nada y responde {status: 'stale'}. Devuelve las imágenes que dejan de usarse.
create or replace function public.fiora_save_radio_collection(c jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  u uuid := auth.uid();
  cid text := c->>'id';
  incoming timestamptz := to_timestamp(coalesce((c->>'updatedAt')::double precision, extract(epoch from now()) * 1000) / 1000);
  cur public.fiora_radio_collections;
  removed jsonb := '[]';
begin
  if u is null then raise exception 'Hace falta iniciar sesión' using errcode = '42501'; end if;
  if cid is null or char_length(cid) not between 1 and 64 then raise exception 'Colección no válida' using errcode = '22023'; end if;
  select * into cur from public.fiora_radio_collections where user_id = u and id = cid;
  if found and cur.updated_at > incoming + interval '1 millisecond' then
    return jsonb_build_object('status', 'stale', 'updatedAt', (extract(epoch from cur.updated_at) * 1000)::bigint);
  end if;
  -- portada anterior que deja de usarse
  if found and coalesce(cur.cover->>'path', '') <> '' and coalesce(cur.cover->>'path', '') is distinct from coalesce(c->'cover'->>'path', '')
     or found and coalesce((c->>'deleted')::boolean, false) and coalesce(cur.cover->>'path', '') <> '' then
    removed := jsonb_build_array(cur.cover->>'path') || case when coalesce(cur.cover->>'thumb', '') <> '' then jsonb_build_array(cur.cover->>'thumb') else '[]' end;
  end if;
  insert into public.fiora_radio_collections (user_id, id, name, description, cover, deleted, created_at, updated_at)
  values (u, cid, coalesce(c->>'name', ''), coalesce(c->>'description', ''),
          case when coalesce((c->>'deleted')::boolean, false) then '{}' else coalesce(c->'cover', '{}') end,
          coalesce((c->>'deleted')::boolean, false),
          coalesce(to_timestamp((c->>'createdAt')::double precision / 1000), now()), incoming)
  on conflict (user_id, id) do update set name = excluded.name, description = excluded.description, cover = excluded.cover,
    deleted = excluded.deleted, updated_at = excluded.updated_at;
  delete from public.fiora_radio_collection_items where user_id = u and collection_id = cid;
  if not coalesce((c->>'deleted')::boolean, false) then
    insert into public.fiora_radio_collection_items (user_id, collection_id, station_uuid, position, station)
    select u, cid, e.value->>'uuid', (e.ordinality - 1)::integer, e.value
      from jsonb_array_elements(coalesce(c->'items', '[]')) with ordinality e
     where e.value->>'uuid' is not null
    on conflict (user_id, collection_id, station_uuid) do nothing;   -- una emisora, una vez por colección
  end if;
  return jsonb_build_object('status', 'ok', 'removed', removed);
end $$;

-- Sella un país del pasaporte (la app solo lo llama tras escuchar de verdad el tiempo mínimo elegido).
create or replace function public.fiora_passport_stamp(cc text, station_uuid text default '', station_name text default '', at double precision default null)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare u uuid := auth.uid(); t timestamptz := coalesce(to_timestamp(at / 1000), now());
begin
  if u is null then raise exception 'Hace falta iniciar sesión' using errcode = '42501'; end if;
  if cc is null or cc !~ '^[A-Z]{2}$' then raise exception 'País no válido' using errcode = '22023'; end if;
  insert into public.fiora_passport (user_id, country_code, first_at, last_at, station_uuid, station_name)
  values (u, cc, t, t, left(coalesce(station_uuid, ''), 64), left(coalesce(station_name, ''), 200))
  on conflict (user_id, country_code) do update set
    first_at = least(public.fiora_passport.first_at, excluded.first_at),
    last_at = greatest(public.fiora_passport.last_at, excluded.last_at);
  return true;
end $$;

-- Guarda las preferencias (gana la más reciente; si la de Supabase es más nueva, responde 'stale').
create or replace function public.fiora_save_explore_prefs(prefs jsonb, at double precision) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare u uuid := auth.uid(); t timestamptz := to_timestamp(at / 1000); cur timestamptz;
begin
  if u is null then raise exception 'Hace falta iniciar sesión' using errcode = '42501'; end if;
  select updated_at into cur from public.fiora_explore_prefs where user_id = u;
  if cur is not null and cur > t + interval '1 millisecond' then
    return jsonb_build_object('status', 'stale');
  end if;
  insert into public.fiora_explore_prefs (user_id, prefs, updated_at) values (u, prefs, t)
  on conflict (user_id) do update set prefs = excluded.prefs, updated_at = excluded.updated_at;
  return jsonb_build_object('status', 'ok');
end $$;

revoke all on function public.fiora_load_explore(), public.fiora_radio_fav(jsonb, boolean, double precision),
                       public.fiora_save_radio_collection(jsonb), public.fiora_passport_stamp(text, text, text, double precision),
                       public.fiora_save_explore_prefs(jsonb, double precision) from public, anon;
grant execute on function public.fiora_load_explore(), public.fiora_radio_fav(jsonb, boolean, double precision),
                          public.fiora_save_radio_collection(jsonb), public.fiora_passport_stamp(text, text, text, double precision),
                          public.fiora_save_explore_prefs(jsonb, double precision) to authenticated;

-- Que la API vea las tablas y funciones nuevas sin esperar.
notify pgrst, 'reload schema';
