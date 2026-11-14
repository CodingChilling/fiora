# Pruebas de Explorar

| Archivo | Qué prueba |
|---|---|
| `rls.sql` | La migración `supabase/migrations/20261115120000_explore.sql` en PostgreSQL: favoritas, colecciones (orden, duplicados, versión vieja que no pisa, borrado que devuelve la portada a eliminar), pasaporte (un sello por país, fechas), preferencias, límites de tamaño y formato, **RLS** (otro usuario y un anónimo no ven ni tocan nada) y borrado en cascada de la cuenta. |
| `explore-e2e.cjs` | La app de punta a punta con Playwright (escritorio, móvil, «reducir movimiento», sin sesión y dos cuentas): los criterios de aceptación del rediseño de Explorar. |
| `rb-server.mjs` | Emulador de Radio Browser, Openverse e Internet Archive con los parámetros documentados que usa la app (búsqueda por nombre, etiqueta, país, idioma, coordenadas, `order=random`…), emisoras de prueba con coordenadas válidas e inválidas, streams que funcionan y streams caídos, y un interruptor para hacer fallar una fuente. |
| `make-fixtures.sh` | Genera el audio de prueba (silencio) con ffmpeg. |

Usan también el emulador de Supabase y el servidor de la app de [`../playlists`](../playlists/README.md).

## Cómo ejecutarlas

Requisitos: PostgreSQL 15+, Node 20+, Playwright con Chromium y ffmpeg.

```bash
# Base de datos con las dos migraciones (ver ../playlists/README.md para crearla)
psql -d sbtest -f ../../supabase/migrations/20261115120000_explore.sql
psql -d sbtest -f rls.sql          # cada línea muestra el resultado o el error esperado

./make-fixtures.sh
node rb-server.mjs &                              # :8767
(cd ../playlists && node static-server.mjs &)     # la app en :8765
(cd ../playlists && node sb-server.mjs &)         # Supabase en :8766
node explore-e2e.cjs                              # sobre una base recién creada
```

La prueba del pasaporte espera 30 s de escucha real y la de la degustación 15 s, así que tarda unos dos minutos.
