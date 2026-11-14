-- Pruebas de la migración de Explorar. Ejecutar sobre una base con supabase-shim.sql y las dos migraciones.
-- Cada línea muestra el resultado esperado o, si es un caso que debe fallar, el error esperado.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
insert into auth.users values ('aaaaaaaa-0000-0000-0000-00000000000a','ea@x'), ('bbbbbbbb-0000-0000-0000-00000000000b','eb@x') on conflict do nothing;
-- ===== Usuario A
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', false);
select 'A favorita 1: ', public.fiora_radio_fav('{"uuid":"11111111-1111-1111-1111-111111111111","title":"Jazz FM","url":"https://jazz.example/stream","cc":"FR","tags":["jazz"]}', true, 1700000000000);
select 'A favorita 2: ', public.fiora_radio_fav('{"uuid":"22222222-2222-2222-2222-222222222222","title":"Rock","url":"https://rock.example/s","cc":"ES"}', true, 1700000005000);
select 'A favorita repetida (no duplica): ', public.fiora_radio_fav('{"uuid":"22222222-2222-2222-2222-222222222222","title":"Rock 2","url":"https://rock.example/s"}', true);
select 'A favoritas: ', (select count(*) from public.fiora_radio_favorites) || ' · primera: ' || (public.fiora_load_explore()->'favorites'->0->'station'->>'title');
select 'A quita una: ', public.fiora_radio_fav('{"uuid":"11111111-1111-1111-1111-111111111111","url":"https://x"}', false);
select 'A favoritas tras quitar: ', count(*) from public.fiora_radio_favorites;
select 'A ficha sin URL (error): ', public.fiora_radio_fav('{"uuid":"33333333-3333-3333-3333-333333333333"}', true);
select 'A uuid no válido (error): ', public.fiora_radio_fav('{"uuid":"drop table","url":"https://x"}', true);
select 'A ficha de 5 KB (error): ', public.fiora_radio_fav(jsonb_build_object('uuid','44444444-4444-4444-4444-444444444444','url','https://x','title',repeat('x',5000)), true);
-- colecciones
select 'A guarda colección: ', public.fiora_save_radio_collection('{"id":"c1","name":"Mañanas","description":"Para despertar","updatedAt":1700000000000,"createdAt":1700000000000,
  "cover":{"kind":"image","path":"aaaaaaaa-0000-0000-0000-00000000000a/radio-c1/covers/a.jpg","thumb":"aaaaaaaa-0000-0000-0000-00000000000a/radio-c1/covers/a_t.jpg"},
  "items":[{"uuid":"22222222-2222-2222-2222-222222222222","url":"https://rock.example/s","title":"Rock"},{"uuid":"11111111-1111-1111-1111-111111111111","url":"https://jazz.example/stream","title":"Jazz"},{"uuid":"22222222-2222-2222-2222-222222222222","url":"https://rock.example/s","title":"Rock repetida"}]}');
select 'A orden de la colección: ', (select string_agg(station->>'title', ', ' order by position) from public.fiora_radio_collection_items where collection_id = 'c1');
select 'A reordena y cambia portada: ', public.fiora_save_radio_collection('{"id":"c1","name":"Mañanas","updatedAt":1700000009000,"cover":{"kind":"image","path":"aaaaaaaa-0000-0000-0000-00000000000a/radio-c1/covers/b.jpg"},
  "items":[{"uuid":"11111111-1111-1111-1111-111111111111","url":"https://jazz.example/stream","title":"Jazz"},{"uuid":"22222222-2222-2222-2222-222222222222","url":"https://rock.example/s","title":"Rock"}]}');
select 'A versión vieja (otro dispositivo): ', public.fiora_save_radio_collection('{"id":"c1","name":"VIEJO","updatedAt":1700000001000,"items":[]}');
select 'A colección sigue: ', (public.fiora_load_explore()->'collections'->0->>'name') || ' · ' || jsonb_array_length(public.fiora_load_explore()->'collections'->0->'items') || ' emisoras · primera ' || (public.fiora_load_explore()->'collections'->0->'items'->0->'station'->>'title');
select 'A nombre de 81 caracteres (error): ', public.fiora_save_radio_collection(jsonb_build_object('id','c2','name',repeat('n',81),'updatedAt',1700000000000));
-- pasaporte
select 'A sello FR: ', public.fiora_passport_stamp('FR', '11111111-1111-1111-1111-111111111111', 'Jazz FM', 1700000000000);
select 'A sello FR otra vez: ', public.fiora_passport_stamp('FR', '11111111-1111-1111-1111-111111111111', 'Jazz FM', 1700000900000);
select 'A sello JP: ', public.fiora_passport_stamp('JP', '55555555-5555-5555-5555-555555555555', 'Tokyo', 1700000500000);
select 'A país no válido (error): ', public.fiora_passport_stamp('fr; drop', '', '');
select 'A pasaporte: ', (select string_agg(country_code || ' ' || (extract(epoch from first_at)*1000)::bigint || '-' || (extract(epoch from last_at)*1000)::bigint, '; ' order by country_code) from public.fiora_passport);
-- preferencias
select 'A prefs: ', public.fiora_save_explore_prefs('{"mix":{"fam":0.8},"passport":{"on":true,"secs":60}}', 1700000000000);
select 'A prefs viejas: ', public.fiora_save_explore_prefs('{"mix":{"fam":0.1}}', 1690000000000);
select 'A prefs guardadas: ', public.fiora_load_explore()->'prefs'->'mix'->>'fam';
select 'A prefs de 20 KB (error): ', public.fiora_save_explore_prefs(jsonb_build_object('x', repeat('y', 20000)), 1800000000000);
insert into public.fiora_radio_favorites (user_id, station_uuid, station) values ('bbbbbbbb-0000-0000-0000-00000000000b', '66666666-6666-6666-6666-666666666666', '{"uuid":"66666666-6666-6666-6666-666666666666","url":"https://x"}');
-- ===== Usuario B
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000b', false);
select 'B ve lo de A: ', public.fiora_load_explore()::text;
select 'B ve filas: ', (select count(*) from public.fiora_radio_favorites) || ' ' || (select count(*) from public.fiora_radio_collections) || ' ' || (select count(*) from public.fiora_radio_collection_items) || ' ' || (select count(*) from public.fiora_passport) || ' ' || (select count(*) from public.fiora_explore_prefs);
select 'B pisa la colección de A: ', public.fiora_save_radio_collection('{"id":"c1","name":"de B","updatedAt":1800000000000,"items":[]}');
update public.fiora_radio_favorites set station = '{}' ; select 'B cambia favoritas de A (filas): 0';
delete from public.fiora_passport; select 'B borra pasaporte de A: hecho (sin efecto por RLS)';
insert into public.fiora_passport (user_id, country_code) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'DE');
-- ===== anónimo
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select 'anon lee favoritas (error): ', count(*) from public.fiora_radio_favorites;
select 'anon llama a load (error): ', public.fiora_load_explore();
reset role;
select 'Comprobación (superusuario): A favoritas ', (select count(*) from public.fiora_radio_favorites where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
       ' · colección de A se llama ', (select name from public.fiora_radio_collections where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and id = 'c1'),
       ' · colección de B ', (select name from public.fiora_radio_collections where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and id = 'c1'),
       ' · sellos de A ', (select count(*) from public.fiora_passport where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a');
-- ===== A borra la colección (devuelve la portada a borrar del almacenamiento)
set role authenticated; select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', false);
select 'A borra colección: ', public.fiora_save_radio_collection('{"id":"c1","name":"Mañanas","deleted":true,"updatedAt":1700000020000}');
select 'A emisoras de la colección borrada: ', count(*) from public.fiora_radio_collection_items where collection_id = 'c1';
reset role;
-- ===== borrar la cuenta borra todo
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select 'Tras borrar la cuenta de A: ', (select count(*) from public.fiora_radio_favorites where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a') + (select count(*) from public.fiora_radio_collections where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a') + (select count(*) from public.fiora_passport where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a') + (select count(*) from public.fiora_explore_prefs where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a');
