# Fiora

Tu música, sin suscripciones. Una app web instalable (PWA) para escuchar tu propia biblioteca, guardarla en tu nube personal y descubrir música libre y radios.

- **Tu biblioteca**: importa archivos o carpetas enteras (MP3, FLAC, M4A, OGG, WAV…). Lee título, artista, álbum, carátula y letra de las etiquetas.
- **Sin conexión**: la música importada o descargada se guarda en el dispositivo y la app se abre sin internet.
- **Descargas**: baja una canción, un álbum o una playlist entera dentro de la app, o guarda el archivo en la carpeta de descargas del móvil u ordenador.
- **Nube personal**: conecta uno o varios buckets de Oracle Cloud Object Storage y escucha tu música desde cualquier dispositivo. Playlists, favoritos y estadísticas se sincronizan.
- **Cuenta**: inicia sesión con correo y contraseña y recupera tus datos en cualquier dispositivo.
- **Playlists y favoritos**, cola de reproducción, aleatorio y repetición, controles en la pantalla de bloqueo.
- **Letras** sincronizadas (incrustadas en el archivo o de [LRCLIB](https://lrclib.net)) y carátulas.
- **Para ti**: mezcla diaria, redescubre, lo más escuchado y radio a partir de una canción. Todo se calcula en tu dispositivo.
- **Explorar**: música con licencias abiertas de [Internet Archive](https://archive.org), [Openverse](https://openverse.org), [Wikimedia Commons](https://commons.wikimedia.org) y [Jamendo](https://www.jamendo.com), y emisoras de [Radio Browser](https://www.radio-browser.info).

No hay servidor propio ni seguimiento: es HTML, CSS y JavaScript sin paso de compilación.

## Publicarla con GitHub Pages

1. En el repositorio: **Settings → Pages**.
2. En *Build and deployment*, elige **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guarda.
3. Al cabo de un minuto estará en `https://<tu-usuario>.github.io/fiora/`.
4. Ábrela en el móvil o el ordenador y usa **Instalar app** / **Añadir a pantalla de inicio**.

## Conectar Oracle Cloud

1. En la consola de Oracle Cloud: **Storage → Buckets → Create Bucket** (déjalo privado).
2. Dentro del bucket: **Pre-Authenticated Requests → Create Pre-Authenticated Request**.
   - *Target*: **Bucket**
   - *Access type*: **Permit object reads and writes**
   - Marca **Enable Object Listing**
   - Pon una fecha de caducidad lejana.
3. Copia la URL (solo se muestra una vez) y pégala en **Ajustes → Nube** dentro de Fiora.

Puedes conectar **varios buckets** a la vez (por ejemplo, para repartir la música o ampliar espacio): repite los pasos y añádelos en **Ajustes → Nube → Conectar otro bucket**. Toda la música aparece junta en la biblioteca, y eliges a cuál van las subidas.

Con **Reducir el tamaño al subir, sin perder calidad**, los archivos WAV se convierten a FLAC antes de subirlos: el sonido es idéntico muestra a muestra y ocupan en torno a la mitad. MP3, M4A, OGG y FLAC ya están comprimidos (reducirlos más sí perdería calidad), así que se suben tal cual.

Después puedes subir música desde la app (**Ajustes → Subir a la nube**) o directamente al bucket con la consola de Oracle; se organiza como `Artista/Álbum/archivo`. En cada dispositivo, pega la misma URL para ver la misma biblioteca.

> La URL funciona como una contraseña: quien la tenga puede leer y escribir en el bucket. Fiora la guarda únicamente en el dispositivo. No la publiques ni la subas a este repositorio.

## Cuentas (iniciar sesión)

Con una cuenta, tus playlists, favoritos, estadísticas, emisoras, ajustes y la conexión a Oracle se guardan y se recuperan al entrar desde cualquier dispositivo. Las cuentas viven en un proyecto gratuito de [Supabase](https://supabase.com):

1. Crea un proyecto en supabase.com.
2. En **SQL Editor**, ejecuta:

   ```sql
   create table public.fiora_datos (
     user_id uuid primary key default auth.uid() references auth.users on delete cascade,
     datos jsonb not null default '{}'::jsonb,
     actualizado timestamptz not null default now()
   );
   alter table public.fiora_datos enable row level security;
   create policy "Cada usuario solo ve y cambia sus datos"
     on public.fiora_datos for all to authenticated
     using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

3. En **Authentication → URL Configuration**, pon como *Site URL* la dirección de la app (`https://<tu-usuario>.github.io/fiora/`), para que los enlaces de confirmación y de cambio de contraseña vuelvan a ella.
4. Copia la **Project URL** y la clave pública (**anon** o **publishable**) de *Project Settings → API* y:
   - pégalas en **Ajustes → Cuenta** dentro de la app (se guardan solo en ese dispositivo), o
   - escríbelas en `js/config.js` para que valgan en todos los dispositivos.

La clave pública está pensada para ir en el navegador: lo que protege los datos es la política de la tabla, que solo deja a cada usuario leer y escribir su propia fila. **No uses nunca la clave `service_role` / `secret`.**

Por defecto Supabase pide confirmar el correo al crear la cuenta. Si la app es solo para ti, puedes desactivarlo en *Authentication → Sign In / Providers → Email → Confirm email*.

## Catálogos de música libre

En **Explorar** eliges dónde buscar. Todo se puede escuchar en línea, añadir a la biblioteca y (si la licencia lo permite) descargar; cada canción enlaza a su origen y su licencia.

| Catálogo | Qué hay | Clave |
| --- | --- | --- |
| Internet Archive | Conciertos, netlabels, grabaciones antiguas | No |
| Openverse | Música Creative Commons de Jamendo, ccMixter y otros | No (unas 200 búsquedas al día por conexión) |
| Wikimedia Commons | Dominio público y libre; mucha clásica | No |
| Jamendo | Música independiente actual | *Client ID* gratuito de devportal.jamendo.com |

La clave de Jamendo se pega en **Explorar → Jamendo** (se guarda en ese dispositivo) o en `js/config.js`.

## Probarla en local

```bash
python3 -m http.server 8000
```

Y abre `http://localhost:8000`.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `index.html`, `css/styles.css` | Página y estilos |
| `js/app.js` | Pantallas, menús y navegación |
| `js/player.js` | Reproductor, cola y controles del sistema |
| `js/library.js`, `js/tags.js` | Importación y lectura de etiquetas |
| `js/cloud.js` | Oracle Cloud Object Storage (uno o varios buckets) |
| `js/flac.js` | Conversión sin pérdida de WAV a FLAC |
| `js/account.js`, `js/sync.js`, `js/config.js` | Cuentas con Supabase y sincronización de datos |
| `js/sources.js` | Catálogos de música libre y radios |
| `js/lyrics.js`, `js/recs.js` | Letras y recomendaciones |
| `js/db.js`, `js/store.js` | Almacenamiento en IndexedDB |
| `sw.js`, `manifest.webmanifest` | Modo sin conexión e instalación |

Las etiquetas se leen con [jsmediatags](https://github.com/aadsm/jsmediatags) (licencia BSD-3-Clause, en `vendor/`).
