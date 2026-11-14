-- ============================================================================
-- Fiora · Playlists sincronizadas en Supabase
-- ----------------------------------------------------------------------------
-- Ejecútalo una vez en Supabase → SQL Editor (o con `supabase db push`).
-- Es idempotente: se puede volver a ejecutar sin perder datos.
-- No toca la tabla `fiora_datos`, que sigue funcionando como hasta ahora.
--
-- Tablas (todas con RLS: cada usuario solo ve y modifica lo suyo):
--   fiora_playlists           una fila por playlist (datos, portada, colores, módulos…)
--   fiora_playlist_sections   capítulos de cada playlist
--   fiora_playlist_tracks     canciones de cada playlist, con su orden manual y capítulo
--   fiora_playlist_photos     fotos del carrusel (solo referencias; el archivo va en Storage)
--   fiora_playlist_notes      notas personales sobre canciones de una playlist
--   fiora_playlist_plays      escuchas por día y canción dentro de cada playlist (agregadas)
-- Funciones: fiora_save_playlist, fiora_load_playlists, fiora_count_plays
-- Storage:   bucket privado `fiora-playlists`, máx. 16 MB por archivo, solo imágenes,
--            cada usuario solo puede usar su carpeta `{user_id}/…`.
-- ============================================================================

-- ---------------------------------------------------------------- tablas
create table if not exists public.fiora_playlists (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null check (char_length(id) between 1 and 64),
  name        text        not null default ''  check (char_length(name) <= 200),
  description text        not null default ''  check (char_length(description) <= 4000),
  emoji       text        not null default ''  check (char_length(emoji) <= 16),
  quote       text        not null default ''  check (char_length(quote) <= 500),
  mood        text        not null default ''  check (char_length(mood) <= 60),
  tags        text[]      not null default '{}' check (cardinality(tags) <= 30),
  featured    text[]      not null default '{}' check (cardinality(featured) <= 3),
  colors      jsonb       not null default '{}' check (jsonb_typeof(colors) = 'object'),
  cover       jsonb       not null default '{}' check (jsonb_typeof(cover) = 'object'),
  settings    jsonb       not null default '{}' check (jsonb_typeof(settings) = 'object'),
  show_photos boolean     not null default true,
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.fiora_playlist_sections (
  user_id     uuid    not null default auth.uid(),
  playlist_id text    not null,
  id          text    not null check (char_length(id) between 1 and 64),
  name        text    not null default '' check (char_length(name) <= 200),
  description text    not null default '' check (char_length(description) <= 2000),
  position    integer not null default 0,
  collapsed   boolean not null default false,
  primary key (user_id, playlist_id, id),
  foreign key (user_id, playlist_id) references public.fiora_playlists (user_id, id) on delete cascade
);

create table if not exists public.fiora_playlist_tracks (
  user_id     uuid        not null default auth.uid(),
  playlist_id text        not null,
  track_id    text        not null check (char_length(track_id) between 1 and 600),
  position    integer     not null,
  section_id  text,
  added_at    timestamptz not null default now(),
  primary key (user_id, playlist_id, track_id),   -- una canción, una vez por playlist
  foreign key (user_id, playlist_id) references public.fiora_playlists (user_id, id) on delete cascade,
  foreign key (user_id, playlist_id, section_id) references public.fiora_playlist_sections (user_id, playlist_id, id)
    on delete set null (section_id)
);
create index if not exists fiora_playlist_tracks_order on public.fiora_playlist_tracks (user_id, playlist_id, position);

create table if not exists public.fiora_playlist_photos (
  user_id     uuid        not null default auth.uid(),
  playlist_id text        not null,
  id          text        not null check (char_length(id) between 1 and 64),
  path        text        not null check (char_length(path) <= 300),
  thumb_path  text        check (char_length(thumb_path) <= 300),
  size        integer     not null check (size between 1 and 16777216),          -- 16 MB
  mime        text        not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')),
  width       integer     check (width > 0),
  height      integer     check (height > 0),
  caption     text        not null default '' check (char_length(caption) <= 500),
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, playlist_id, id),
  foreign key (user_id, playlist_id) references public.fiora_playlists (user_id, id) on delete cascade,
  -- las rutas siempre dentro de la carpeta del propio usuario en Storage
  check (split_part(path, '/', 1) = user_id::text),
  check (thumb_path is null or split_part(thumb_path, '/', 1) = user_id::text)
);
create index if not exists fiora_playlist_photos_order on public.fiora_playlist_photos (user_id, playlist_id, position);

create table if not exists public.fiora_playlist_notes (
  user_id     uuid        not null default auth.uid(),
  playlist_id text        not null,
  track_id    text        not null check (char_length(track_id) between 1 and 600),
  note        text        not null check (char_length(note) between 1 and 2000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, playlist_id, track_id),
  foreign key (user_id, playlist_id) references public.fiora_playlists (user_id, id) on delete cascade
);

-- Escuchas agregadas por día: lo mínimo para las estadísticas (sin horas exactas ni dispositivo).
create table if not exists public.fiora_playlist_plays (
  user_id     uuid    not null default auth.uid(),
  playlist_id text    not null,
  track_id    text    not null check (char_length(track_id) between 1 and 600),
  day         date    not null,
  plays       integer not null default 0 check (plays >= 0),
  seconds     integer not null default 0 check (seconds >= 0),
  primary key (user_id, playlist_id, track_id, day),
  foreign key (user_id, playlist_id) references public.fiora_playlists (user_id, id) on delete cascade
);

-- Máximo 15 fotos por playlist, también si alguien escribe en la tabla sin pasar por la app.
create or replace function public.fiora_photos_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.fiora_playlist_photos
      where user_id = new.user_id and playlist_id = new.playlist_id and id <> new.id) >= 15 then
    raise exception 'Una playlist admite como máximo 15 fotos' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists fiora_photos_limit on public.fiora_playlist_photos;
create trigger fiora_photos_limit before insert on public.fiora_playlist_photos
  for each row execute function public.fiora_photos_limit();

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['fiora_playlists', 'fiora_playlist_sections', 'fiora_playlist_tracks',
                           'fiora_playlist_photos', 'fiora_playlist_notes', 'fiora_playlist_plays'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "propietario" on public.%I', t);
    execute format('create policy "propietario" on public.%I for all to authenticated
                      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- funciones
-- Todas son SECURITY INVOKER: se ejecutan con los permisos de quien llama, así que RLS se aplica.

-- Guarda una playlist completa de una vez (en una transacción). Si en la base hay una versión más
-- reciente, no la pisa y devuelve {status:'stale'}. Devuelve las rutas de imágenes que dejan de
-- usarse, para que la app las borre de Storage.
create or replace function public.fiora_save_playlist(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  uid      uuid := auth.uid();
  pid      text := p->>'id';
  incoming timestamptz := to_timestamp(coalesce((p->>'updatedAt')::double precision, 0) / 1000.0);
  current  public.fiora_playlists%rowtype;
  removed  text[] := '{}';
  old_cover jsonb;
begin
  if uid is null then raise exception 'Sin sesión' using errcode = '28000'; end if;
  if pid is null then raise exception 'Falta el id de la playlist' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p->'photos', '[]')) > 15 then
    raise exception 'Una playlist admite como máximo 15 fotos' using errcode = 'check_violation';
  end if;

  select * into current from public.fiora_playlists where user_id = uid and id = pid for update;
  if found and current.updated_at > incoming then
    return jsonb_build_object('status', 'stale', 'updatedAt', (extract(epoch from current.updated_at) * 1000)::bigint);
  end if;
  old_cover := case when found then current.cover else '{}'::jsonb end;

  insert into public.fiora_playlists as t (user_id, id, name, description, emoji, quote, mood, tags, featured,
                                           colors, cover, settings, show_photos, deleted, created_at, updated_at)
  values (uid, pid, coalesce(p->>'name', ''), coalesce(p->>'description', ''), coalesce(p->>'emoji', ''),
          coalesce(p->>'quote', ''), coalesce(p->>'mood', ''),
          coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}'),
          coalesce(array(select jsonb_array_elements_text(p->'featured')), '{}'),
          coalesce(p->'colors', '{}'), coalesce(p->'cover', '{}'), coalesce(p->'settings', '{}'),
          coalesce((p->>'showPhotos')::boolean, true), coalesce((p->>'deleted')::boolean, false),
          coalesce(to_timestamp((p->>'createdAt')::double precision / 1000.0), now()), incoming)
  on conflict (user_id, id) do update set
    name = excluded.name, description = excluded.description, emoji = excluded.emoji, quote = excluded.quote,
    mood = excluded.mood, tags = excluded.tags, featured = excluded.featured, colors = excluded.colors,
    cover = excluded.cover, settings = excluded.settings, show_photos = excluded.show_photos,
    deleted = excluded.deleted, updated_at = excluded.updated_at;

  -- portada sustituida: sus archivos dejan de usarse
  if old_cover ? 'path' and (old_cover->>'path') is distinct from (p->'cover'->>'path') then
    removed := removed || array_remove(array[old_cover->>'path', old_cover->>'thumb'], null);
  end if;

  -- capítulos
  delete from public.fiora_playlist_sections s
   where s.user_id = uid and s.playlist_id = pid
     and s.id not in (select x->>'id' from jsonb_array_elements(coalesce(p->'sections', '[]')) x);
  insert into public.fiora_playlist_sections (user_id, playlist_id, id, name, description, position, collapsed)
  select uid, pid, x->>'id', coalesce(x->>'name', ''), coalesce(x->>'description', ''), (o - 1)::int,
         coalesce((x->>'collapsed')::boolean, false)
    from jsonb_array_elements(coalesce(p->'sections', '[]')) with ordinality as e(x, o)
  on conflict (user_id, playlist_id, id) do update set
    name = excluded.name, description = excluded.description, position = excluded.position, collapsed = excluded.collapsed;

  -- canciones, en su orden manual
  delete from public.fiora_playlist_tracks tr
   where tr.user_id = uid and tr.playlist_id = pid
     and tr.track_id not in (select jsonb_array_elements_text(coalesce(p->'trackIds', '[]')));
  insert into public.fiora_playlist_tracks (user_id, playlist_id, track_id, position, added_at, section_id)
  select uid, pid, x, (o - 1)::int,
         coalesce(to_timestamp((p->'added'->>x)::double precision / 1000.0), now()),
         -- solo capítulos que existen en esta playlist (si no, la canción queda sin capítulo)
         case when (p->'trackSection'->>x) in (select y->>'id' from jsonb_array_elements(coalesce(p->'sections', '[]')) y)
              then p->'trackSection'->>x end
    from jsonb_array_elements_text(coalesce(p->'trackIds', '[]')) with ordinality as e(x, o)
  on conflict (user_id, playlist_id, track_id) do update set
    position = excluded.position, section_id = excluded.section_id;

  -- fotos del carrusel (solo las que están en la nube)
  select removed || coalesce(array_agg(f), '{}') into removed
    from (select unnest(array_remove(array[ph.path, ph.thumb_path], null)) f
            from public.fiora_playlist_photos ph
           where ph.user_id = uid and ph.playlist_id = pid
             and ph.id not in (select x->>'id' from jsonb_array_elements(coalesce(p->'photos', '[]')) x)) q;
  delete from public.fiora_playlist_photos ph
   where ph.user_id = uid and ph.playlist_id = pid
     and ph.id not in (select x->>'id' from jsonb_array_elements(coalesce(p->'photos', '[]')) x);
  insert into public.fiora_playlist_photos (user_id, playlist_id, id, path, thumb_path, size, mime, width, height, caption, position)
  select uid, pid, x->>'id', x->>'path', x->>'thumb', (x->>'size')::int, x->>'mime',
         nullif(x->>'w', '')::int, nullif(x->>'h', '')::int, coalesce(x->>'caption', ''), (o - 1)::int
    from jsonb_array_elements(coalesce(p->'photos', '[]')) with ordinality as e(x, o)
  on conflict (user_id, playlist_id, id) do update set caption = excluded.caption, position = excluded.position;

  -- notas personales
  delete from public.fiora_playlist_notes n
   where n.user_id = uid and n.playlist_id = pid
     and n.track_id not in (select k from jsonb_object_keys(coalesce(p->'notes', '{}')) k);
  insert into public.fiora_playlist_notes (user_id, playlist_id, track_id, note, updated_at)
  select uid, pid, k, v->>'text', to_timestamp(coalesce((v->>'at')::double precision, 0) / 1000.0)
    from jsonb_each(coalesce(p->'notes', '{}')) as e(k, v)
   where coalesce(v->>'text', '') <> ''
  on conflict (user_id, playlist_id, track_id) do update set note = excluded.note, updated_at = excluded.updated_at;

  -- playlist eliminada: se queda solo la marca (para que los otros dispositivos se enteren)
  if coalesce((p->>'deleted')::boolean, false) then
    if (p->'cover'->>'path') is not null then removed := removed || array_remove(array[p->'cover'->>'path', p->'cover'->>'thumb'], null); end if;
    delete from public.fiora_playlist_plays pl where pl.user_id = uid and pl.playlist_id = pid;
  end if;

  return jsonb_build_object('status', 'ok', 'removed', to_jsonb(removed));
end $$;

-- Devuelve las playlists del usuario (con todo lo asociado), opcionalmente solo las cambiadas
-- después de `since` (milisegundos).
create or replace function public.fiora_load_playlists(since double precision default 0) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pl.id, 'name', pl.name, 'description', pl.description, 'emoji', pl.emoji, 'quote', pl.quote,
    'mood', pl.mood, 'tags', to_jsonb(pl.tags), 'featured', to_jsonb(pl.featured), 'colors', pl.colors,
    'cover', pl.cover, 'settings', pl.settings, 'showPhotos', pl.show_photos, 'deleted', pl.deleted,
    'createdAt', (extract(epoch from pl.created_at) * 1000)::bigint,
    'updatedAt', (extract(epoch from pl.updated_at) * 1000)::bigint,
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
                                                              'collapsed', s.collapsed) order by s.position)
                            from public.fiora_playlist_sections s
                           where s.user_id = pl.user_id and s.playlist_id = pl.id), '[]'),
    'trackIds', coalesce((select jsonb_agg(t.track_id order by t.position)
                            from public.fiora_playlist_tracks t
                           where t.user_id = pl.user_id and t.playlist_id = pl.id), '[]'),
    'added', coalesce((select jsonb_object_agg(t.track_id, (extract(epoch from t.added_at) * 1000)::bigint)
                         from public.fiora_playlist_tracks t
                        where t.user_id = pl.user_id and t.playlist_id = pl.id), '{}'),
    'trackSection', coalesce((select jsonb_object_agg(t.track_id, t.section_id)
                                from public.fiora_playlist_tracks t
                               where t.user_id = pl.user_id and t.playlist_id = pl.id and t.section_id is not null), '{}'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.path, 'thumb', ph.thumb_path,
                                                            'size', ph.size, 'mime', ph.mime, 'w', ph.width, 'h', ph.height,
                                                            'caption', ph.caption) order by ph.position)
                          from public.fiora_playlist_photos ph
                         where ph.user_id = pl.user_id and ph.playlist_id = pl.id), '[]'),
    'notes', coalesce((select jsonb_object_agg(n.track_id, jsonb_build_object('text', n.note,
                                                'at', (extract(epoch from n.updated_at) * 1000)::bigint))
                         from public.fiora_playlist_notes n
                        where n.user_id = pl.user_id and n.playlist_id = pl.id), '{}')
  ) order by pl.created_at), '[]')
  from public.fiora_playlists pl
  where pl.user_id = auth.uid() and pl.updated_at > to_timestamp(coalesce(since, 0) / 1000.0);
$$;

-- Suma escuchas (en lote): [{"p": playlist, "t": canción, "d": "AAAA-MM-DD", "n": escuchas, "s": segundos}]
create or replace function public.fiora_count_plays(items jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '28000'; end if;
  if jsonb_array_length(items) > 500 then raise exception 'Demasiadas escuchas en un lote' using errcode = '22023'; end if;
  insert into public.fiora_playlist_plays as pp (user_id, playlist_id, track_id, day, plays, seconds)
  select auth.uid(), x->>'p', x->>'t', (x->>'d')::date,
         -- varias escuchas de la misma canción y día en un lote se suman antes de guardar
         least(sum(greatest(coalesce((x->>'n')::int, 1), 0)), 1000)::int,
         least(sum(greatest(coalesce((x->>'s')::int, 0), 0)), 1000000)::int
    from jsonb_array_elements(items) x
    join public.fiora_playlists pl on pl.user_id = auth.uid() and pl.id = x->>'p' and not pl.deleted
   group by x->>'p', x->>'t', (x->>'d')::date
  on conflict (user_id, playlist_id, track_id, day) do update set
    plays = pp.plays + excluded.plays, seconds = pp.seconds + excluded.seconds;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fiora_save_playlist(jsonb), public.fiora_load_playlists(double precision),
                       public.fiora_count_plays(jsonb) from public, anon;
grant execute on function public.fiora_save_playlist(jsonb), public.fiora_load_playlists(double precision),
                          public.fiora_count_plays(jsonb) to authenticated;

-- ---------------------------------------------------------------- Storage
-- Bucket privado, 16 MB por archivo (16 × 1024 × 1024 bytes) y solo imágenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fiora-playlists', 'fiora-playlists', false, 16777216,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- Cada usuario solo puede leer, subir, sustituir y borrar archivos dentro de `{su id}/…`.
drop policy if exists "fiora-playlists: leer lo propio" on storage.objects;
drop policy if exists "fiora-playlists: subir a lo propio" on storage.objects;
drop policy if exists "fiora-playlists: cambiar lo propio" on storage.objects;
drop policy if exists "fiora-playlists: borrar lo propio" on storage.objects;
create policy "fiora-playlists: leer lo propio" on storage.objects for select to authenticated
  using (bucket_id = 'fiora-playlists' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fiora-playlists: subir a lo propio" on storage.objects for insert to authenticated
  with check (bucket_id = 'fiora-playlists' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fiora-playlists: cambiar lo propio" on storage.objects for update to authenticated
  using (bucket_id = 'fiora-playlists' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fiora-playlists' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fiora-playlists: borrar lo propio" on storage.objects for delete to authenticated
  using (bucket_id = 'fiora-playlists' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Que la API vea las tablas y funciones nuevas sin esperar.
notify pgrst, 'reload schema';
