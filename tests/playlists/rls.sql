\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001','a@x'), ('bbbbbbbb-0000-0000-0000-000000000002','b@x');
-- ===== Usuario A
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select 'A guarda: ', public.fiora_save_playlist('{"id":"p1","name":"Midnight","updatedAt":1700000000000,"createdAt":1699000000000,
  "tags":["Noche","Chill"],"featured":["t2"],"colors":{"mode":"auto"},"cover":{"kind":"image","path":"aaaaaaaa-0000-0000-0000-000000000001/p1/covers/c1.jpg","thumb":"aaaaaaaa-0000-0000-0000-000000000001/p1/covers/c1_t.jpg"},
  "sections":[{"id":"s1","name":"El comienzo"},{"id":"s2","name":"Medianoche","collapsed":true}],
  "trackIds":["t1","t2","t3"],"trackSection":{"t1":"s1","t2":"s2","t3":"no-existe"},
  "photos":[{"id":"f1","path":"aaaaaaaa-0000-0000-0000-000000000001/p1/photos/f1.jpg","thumb":"aaaaaaaa-0000-0000-0000-000000000001/p1/photos/f1_t.jpg","size":1000,"mime":"image/jpeg","w":10,"h":10,"caption":"Playa"}],
  "notes":{"t1":{"text":"Me recuerda al viaje","at":1700000000000}}}');
select 'A carga: ', (public.fiora_load_playlists(0) -> 0)::text;
-- Orden nuevo, quita una foto, cambia la portada → devuelve rutas a borrar
select 'A guarda v2: ', public.fiora_save_playlist('{"id":"p1","name":"Midnight","updatedAt":1700000005000,
  "cover":{"kind":"image","path":"aaaaaaaa-0000-0000-0000-000000000001/p1/covers/c2.jpg"},
  "sections":[{"id":"s1","name":"El comienzo"}], "trackIds":["t3","t1"],"trackSection":{"t1":"s1"},"photos":[],"notes":{}}');
select 'A orden: ', (public.fiora_load_playlists(0) -> 0 -> 'trackIds')::text || ' secciones: ' || (public.fiora_load_playlists(0) -> 0 -> 'sections')::text;
select 'A versión vieja (otro dispositivo): ', public.fiora_save_playlist('{"id":"p1","name":"VIEJO","updatedAt":1700000001000}');
select 'A nombre sigue: ', (public.fiora_load_playlists(0) -> 0 ->> 'name');
select 'A escuchas: ', public.fiora_count_plays('[{"p":"p1","t":"t1","d":"2026-11-14","n":1,"s":200},{"p":"p1","t":"t1","d":"2026-11-14","n":1,"s":180},{"p":"no-mia","t":"t1","d":"2026-11-14"}]');
select 'A escuchas tabla: ', string_agg(track_id || ' ' || day || ' ' || plays || ' ' || seconds, '; ') from public.fiora_playlist_plays;
-- 16 fotos → rechazo
select 'A 16 fotos: ', public.fiora_save_playlist(jsonb_build_object('id','p1','updatedAt',1700000009000,'photos',
  (select jsonb_agg(jsonb_build_object('id','x'||i,'path','aaaaaaaa-0000-0000-0000-000000000001/p1/photos/x'||i||'.jpg','size',10,'mime','image/jpeg')) from generate_series(1,16) i)));
select 'A 15 fotos: ', (public.fiora_save_playlist(jsonb_build_object('id','p1','updatedAt',1700000010000,'trackIds','["t3","t1"]'::jsonb,'photos',
  (select jsonb_agg(jsonb_build_object('id','x'||i,'path','aaaaaaaa-0000-0000-0000-000000000001/p1/photos/x'||i||'.jpg','size',10,'mime','image/jpeg')) from generate_series(1,15) i)))->>'status');
insert into public.fiora_playlist_photos (playlist_id,id,path,size,mime) values ('p1','directa','aaaaaaaa-0000-0000-0000-000000000001/p1/photos/d.jpg',10,'image/jpeg');
select 'A foto de 17 MB: ', public.fiora_save_playlist(jsonb_build_object('id','p2','updatedAt',1700000000000,'photos',jsonb_build_array(jsonb_build_object('id','g','path','aaaaaaaa-0000-0000-0000-000000000001/p2/photos/g.jpg','size',17000000,'mime','image/jpeg'))));
select 'A foto en carpeta ajena: ', public.fiora_save_playlist(jsonb_build_object('id','p3','updatedAt',1700000000000,'photos',jsonb_build_array(jsonb_build_object('id','g','path','bbbbbbbb-0000-0000-0000-000000000002/p3/photos/g.jpg','size',10,'mime','image/jpeg'))));
-- Storage
insert into storage.objects (bucket_id, name) values ('fiora-playlists','aaaaaaaa-0000-0000-0000-000000000001/p1/covers/c2.jpg');
select 'A sube a su carpeta: ok';
insert into storage.objects (bucket_id, name) values ('fiora-playlists','bbbbbbbb-0000-0000-0000-000000000002/p9/covers/x.jpg');
-- ===== Usuario B
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
select 'B ve playlists de A: ', jsonb_array_length(public.fiora_load_playlists(0));
select 'B ve filas (tablas): ', (select count(*) from public.fiora_playlists) || ' ' || (select count(*) from public.fiora_playlist_tracks) || ' ' || (select count(*) from public.fiora_playlist_notes) || ' ' || (select count(*) from public.fiora_playlist_photos) || ' ' || (select count(*) from public.fiora_playlist_plays);
select 'B ve archivos de A: ', count(*) from storage.objects;
update public.fiora_playlists set name = 'HACK' where id = 'p1' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.fiora_playlist_tracks where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from storage.objects where name like 'aaaaaaaa%';
insert into public.fiora_playlists (user_id, id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','p666','inyectada');
select 'B suma escuchas a p1 de A: ', public.fiora_count_plays('[{"p":"p1","t":"t1","d":"2026-11-14"}]');
select 'B guarda su p1 (mismo id): ', (public.fiora_save_playlist('{"id":"p1","name":"La de B","updatedAt":1700000000000}')->>'status');
-- ===== anónimo
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select 'anon lee tabla: ', count(*) from public.fiora_playlists;
select 'anon RPC: ', public.fiora_load_playlists(0);
reset role;
select 'COMPROBACIÓN (superusuario): A=', (select name from public.fiora_playlists where user_id='aaaaaaaa-0000-0000-0000-000000000001' and id='p1') || ' B=' || (select name from public.fiora_playlists where user_id='bbbbbbbb-0000-0000-0000-000000000002' and id='p1') || ' objetos=' || (select count(*) from storage.objects) || ' p666=' || (select count(*) from public.fiora_playlists where id='p666');
-- eliminar la playlist (marca) → borra hijos y escuchas, devuelve rutas
set role authenticated; select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select 'A elimina p1: ', public.fiora_save_playlist('{"id":"p1","deleted":true,"updatedAt":1700000020000,"cover":{"kind":"image","path":"aaaaaaaa-0000-0000-0000-000000000001/p1/covers/c2.jpg"}}');
select 'A tras eliminar: ', (select count(*) from public.fiora_playlist_tracks) || ' canciones, ' || (select count(*) from public.fiora_playlist_photos) || ' fotos, ' || (select count(*) from public.fiora_playlist_plays) || ' escuchas, deleted=' || (public.fiora_load_playlists(0) -> 0 ->> 'deleted');
