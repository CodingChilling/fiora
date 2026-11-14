# Pruebas de las playlists con Supabase

Dos niveles de pruebas para la migración `supabase/migrations/20261114120000_playlists.sql`
y la interfaz de playlists:

| Archivo | Qué prueba |
|---|---|
| `rls.sql` | La migración en PostgreSQL: guardar y cargar, orden, conflictos entre dispositivos, límite de 15 fotos y de 16 MB, rutas fuera de la carpeta propia, escuchas, eliminación y **RLS** (otro usuario y un anónimo no ven ni tocan nada). |
| `pl-e2e.cjs` | La app de punta a punta con Playwright, en escritorio y en móvil, con varios dispositivos y cuentas, contra `sb-server.mjs`. |
| `favs-e2e.cjs` | «Canciones que te gustan»: nuevo diseño, orden por fecha y manual, altas y bajas con el corazón, personalización, que no se pueda eliminar y que otro dispositivo vea lo mismo. |
| `sb-server.mjs` | Emulador mínimo de Supabase (Auth, `rpc`, Storage). Las llamadas de datos se ejecutan en **PostgreSQL real con la migración aplicada**, como rol `authenticated` y con `auth.uid()` del usuario, así que RLS y las funciones son las de verdad. Storage aplica el límite y los tipos del bucket y sus políticas leyendo `storage.buckets` y `storage.objects` de la base. |
| `supabase-shim.sql` | Lo que Supabase trae de serie y PostgreSQL no (`auth.uid()`, `auth.users`, roles `anon`/`authenticated`, `storage.buckets`, `storage.objects`, `storage.foldername`). Solo para las pruebas: **no se ejecuta en Supabase**. |

## Cómo ejecutarlas

Requisitos: PostgreSQL 15 o posterior, Node 20+, Playwright con Chromium y Python con Pillow.

```bash
# 1. Base de datos de prueba (una con la migración y otra sin ella)
createdb sbtest && createdb sbnomig
psql -d sbtest -f supabase-shim.sql && psql -d sbtest -f ../../supabase/migrations/20261114120000_playlists.sql
psql -d sbnomig -f supabase-shim.sql

# 2. Pruebas de SQL y RLS (cada línea muestra el resultado esperado o el error esperado)
psql -d sbtest -f rls.sql

# 3. Pruebas de la app
npm install            # instala `pg`
python3 make-fixtures.py
node static-server.mjs &           # la app en :8765
PGHOST=/var/run/postgresql node sb-server.mjs &   # el emulador en :8766
node pl-e2e.cjs
node favs-e2e.cjs     # sobre una base recién creada
```

`rls.sql` crea dos usuarios de prueba; ejecútalo sobre una base recién creada.
