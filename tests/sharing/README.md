# Pruebas de compartir el bucket

| Archivo | Qué prueba |
|---|---|
| `sharing-e2e.cjs` | De punta a punta, con dos cuentas (propietario en escritorio y Ana en el móvil). Comprueba que: el modo desarrollador y todo lo que conlleva (editar, subir, borrar, repetidas, compartir) solo se activan con la clave de API de Oracle; la copia antigua de datos personales (`_fiora/datos.json`) desaparece del bucket y no se mezcla; el enlace para Ana se crea con una petición firmada como de solo lectura (`AnyObjectRead` con listado) y con la caducidad elegida; Ana escucha y descarga pero no puede escribir (ni en la app ni con su URL fuera de ella); nadie ve las playlists del otro (también en Supabase); no se escribe nada personal en el bucket; como mucho 5 enlaces vigentes; revocar corta el acceso al momento; y quitar la clave lo desactiva todo sin que la clave ni los enlaces viajen a la cuenta. |
| `oracle-server.mjs` | Emulador de Oracle Object Storage: PAR de bucket (lista, lectura por rangos, escritura solo si la PAR la permite, 404 si está revocada o caducada) y API firmada (comprobar la clave, borrar objetos y crear, listar y revocar PAR). Verifica las firmas como Oracle, también las peticiones con cuerpo (`x-content-sha256`, `content-type`, `content-length`). |
| `make-fixtures.mjs` | Genera una clave de API de prueba (no vale para nada real). |

## Cómo ejecutarlas

Además de lo que piden las [pruebas de las playlists](../playlists/README.md) (PostgreSQL con la migración y su emulador de Supabase):

```bash
node make-fixtures.mjs
node ../playlists/static-server.mjs &                     # la app en :8765
(cd ../playlists && node sb-server.mjs &)                 # Supabase en :8766, base recién creada
node oracle-server.mjs &                                  # Oracle en :8769
node sharing-e2e.cjs
```

Con `SHOTS=<carpeta>` guarda capturas del enlace creado, del panel de la nube y de la vista de Ana.
