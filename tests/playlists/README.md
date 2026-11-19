# Pruebas de las playlists con Supabase

Pruebas de la interfaz de playlists:

| Archivo | Qué prueba |
|---|---|
| `pl-e2e.cjs` | La app de punta a punta con Playwright, en escritorio y en móvil, con varios dispositivos y cuentas, contra `sb-server.mjs`. |
| `favs-e2e.cjs` | «Canciones que te gustan»: nuevo diseño, orden por fecha y manual, altas y bajas con el corazón, personalización, que no se pueda eliminar y que otro dispositivo vea lo mismo. |
| `dnd-e2e.cjs` | Arrastrar y soltar en las playlists, con ratón y con el dedo: añadir desde «Descubre más» en un capítulo o entre dos canciones, mover a otro capítulo, que un clic siga reproduciendo, que deslizar sin mantener pulsado desplace la página, Escape para cancelar y «Canciones que te gustan». También que la cabecera de «Descubre más» no salga aplastada en el móvil. |
| `sb-server.mjs` | Emulador mínimo de Supabase (Auth, `rpc`, Storage). Las llamadas de datos se ejecutan en PostgreSQL real, como el usuario que llama. Storage aplica el límite y los tipos del bucket y sus políticas leyendo `storage.buckets` y `storage.objects` de la base. |

## Cómo ejecutarlas

Requisitos: PostgreSQL 15 o posterior, Node 20+, Playwright con Chromium y Python con Pillow.

```bash
# Base de datos PostgreSQL preparada como la de Supabase (los archivos SQL no están en el repositorio)

# Pruebas de la app
npm install            # instala `pg`
python3 make-fixtures.py
node static-server.mjs &           # la app en :8765
PGHOST=/var/run/postgresql node sb-server.mjs &   # el emulador en :8766
node pl-e2e.cjs
node favs-e2e.cjs     # sobre una base recién creada
node dnd-e2e.cjs      # sobre una base recién creada
```

