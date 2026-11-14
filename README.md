# Fiora

Tu música, sin suscripciones. Una app web instalable (PWA) para escuchar tu propia biblioteca, guardarla en tu nube personal y descubrir música libre y radios.

- **Tu biblioteca**: importa archivos o carpetas enteras (MP3, FLAC, M4A, OGG, WAV…). Lee título, artista, álbum, carátula y letra de las etiquetas.
- **Biblioteca cómoda**: búsqueda y pestañas siempre a mano al desplazarte (pulsa `/` para buscar, `Esc` para borrar); la búsqueda también muestra los artistas y álbumes que coinciden; canciones agrupadas por letra (con índice lateral para saltar) o por fecha; filtros rápidos de un toque; orden para canciones, álbumes y artistas; botón de reproducir en cada álbum y artista; géneros y ambientes como tarjetas con sus carátulas; y al volver de un álbum o artista sigues donde estabas.
- **Filtros**: en Biblioteca → Canciones, filtra por dónde están (sin conexión, nube, solo en el dispositivo, música libre), me gusta, géneros, lo que transmite, época, escuchas y fecha en que se añadieron, y ordena por título, artista, álbum, escuchas, año o duración. La búsqueda no distingue tildes.
- **Sin conexión**: la música importada o descargada se guarda en el dispositivo y la app se abre sin internet.
- **Descargas**: baja una canción, un álbum o una playlist entera dentro de la app, o guarda el archivo en la carpeta de descargas del móvil u ordenador.
- **Nube personal**: conecta uno o varios buckets de Oracle Cloud Object Storage y escucha tu música desde cualquier dispositivo. Playlists, favoritos y estadísticas se sincronizan.
- **Cuenta**: inicia sesión con correo y contraseña y recupera tus datos en cualquier dispositivo.
- **Playlists personalizables**: portada propia (recortable) o collage de carátulas, colores automáticos o elegidos, emoji, descripción, frase, etiquetas y estado de ánimo; carrusel de hasta 15 fotos con visor a pantalla completa; orden manual arrastrando, filtros, buscador y ordenaciones que no tocan tu orden; capítulos que se pliegan y se reproducen por separado; hasta 3 canciones destacadas; notas personales en cada canción; «Descubre más» con canciones de tu biblioteca; estadísticas con gráficos; modos sorpresa y ambiente; y módulos que se activan y reordenan por playlist. Todo se sincroniza con tu cuenta (Supabase). **«Canciones que te gustan»** tiene el mismo diseño y se personaliza igual; sus canciones las decide el corazón, por defecto de la más reciente a la más antigua, y se puede reordenar a mano (las nuevas favoritas entran arriba) o volver al orden por fecha. No se puede eliminar.
- **Favoritos**, aleatorio y repetición, controles en la pantalla de bloqueo.
- **Cola**: lo que añades a mano suena antes de seguir con lo que estabas escuchando; desliza una canción a la derecha para añadirla. Al acabar, continúa sola con canciones parecidas.
- **Letras** sincronizadas (incrustadas en el archivo o de [LRCLIB](https://lrclib.net)) y carátulas.
- **Para ti**: mezcla diaria, mezclas por ambiente y por hora del día, redescubre y radio a partir de una canción. Aprenden de lo que terminas, lo que saltas y lo que escuchas seguido; todo se calcula en tu dispositivo.
- **Estadísticas**: panel con tus minutos por día, horas y días en que más escuchas, y tus artistas, canciones, álbumes, géneros y ambientes más oídos.
- **Géneros y ambiente**: cada canción puede tener varios géneros y etiquetas de lo que transmite (alegre, melancólica, enérgica…).
- **Modo desarrollador**: edita portada, título, artistas, álbum, géneros y ambiente desde la app; los cambios se sincronizan con tu cuenta y tu nube. Los géneros y el ambiente también se pueden etiquetar con IA.
- **Explorar**: música con licencias abiertas de [Internet Archive](https://archive.org), [Openverse](https://openverse.org), [Wikimedia Commons](https://commons.wikimedia.org) y [Jamendo](https://www.jamendo.com), y emisoras de [Radio Browser](https://www.radio-browser.info), en tres vistas (Para ti · Música libre · Radios) con un buscador común, ambientes, géneros, ciudades con su hora local, Radio Roulette, Sorpréndeme, Fiora Atlas (globo y mapa), Universo musical, Radar de emisoras parecidas, Pasaporte musical, Viajes musicales, Degustación de radios, mezclador de descubrimiento, y emisoras favoritas y colecciones sincronizadas. Más abajo, [Explorar](#explorar).

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

## Playlists en Supabase

Las playlists se guardan en tablas propias de tu proyecto de Supabase y sus imágenes en Supabase Storage, para que portadas, fotos, capítulos, notas y estadísticas te acompañen en todos tus dispositivos. **Hay que preparar Supabase una vez**:

1. En Supabase → **SQL Editor**, abre y ejecuta el archivo [`supabase/migrations/20261114120000_playlists.sql`](supabase/migrations/20261114120000_playlists.sql) de este repositorio (o `supabase db push` si usas la CLI). Es idempotente: se puede repetir sin perder nada, y no toca `fiora_datos`.
2. Vuelve a abrir la app. En **Ajustes → Cuenta** verás «Playlists: Guardado en tu cuenta». La primera vez, las playlists que ya tenías se suben solas, con sus canciones y su orden.

Mientras no se ejecute, la app lo detecta, lo indica en Ajustes y sigue funcionando como antes (las playlists se guardan en el dispositivo, en `fiora_datos` y en el bucket de Oracle). No se pierde nada.

**Qué crea la migración**

| Tabla / objeto | Para qué |
|---|---|
| `fiora_playlists` | Nombre, descripción, emoji, frase, ánimo, etiquetas, destacadas, colores, portada (ruta y encuadre), módulos y preferencias, fechas y marca de eliminada. |
| `fiora_playlist_tracks` | Canciones de cada playlist (por su id estable), su **orden manual**, capítulo y fecha en que se añadieron. Una canción no se repite en una playlist. |
| `fiora_playlist_sections` | Capítulos: nombre, descripción, orden y si están plegados. |
| `fiora_playlist_photos` | Fotos del carrusel: ruta en Storage, miniatura, tamaño, tipo, dimensiones, descripción y orden. Máximo 15 (también si se escribe directamente en la tabla). |
| `fiora_playlist_notes` | Notas personales sobre canciones de una playlist. |
| `fiora_playlist_plays` | Escuchas por playlist, canción y **día** (veces y segundos). Nada más: ni horas exactas ni dispositivo. |
| `fiora_save_playlist`, `fiora_load_playlists`, `fiora_count_plays` | Guardan una playlist completa en una transacción (si otro dispositivo guardó algo más nuevo, no lo pisa), la cargan y suman escuchas. Devuelven las rutas de imágenes que dejan de usarse para borrarlas de Storage (sin archivos huérfanos). |
| Bucket `fiora-playlists` | **Privado**, máximo **16 MB** por archivo y solo imágenes (JPEG, PNG, WebP, GIF, AVIF). Carpetas `{tu id}/{playlist}/covers/…` y `…/photos/…`. |

**Seguridad.** Todas las tablas tienen RLS: cada usuario solo puede leer, crear, cambiar o borrar sus propias filas, y las funciones se ejecutan con los permisos de quien llama (`security invoker`). En Storage, cada usuario solo puede leer, subir, sustituir y borrar archivos dentro de su carpeta; nadie más ve tus fotos, ni siquiera con la URL. Los usuarios anónimos no tienen acceso. Las imágenes se descargan con la sesión del usuario y se guardan en caché en el dispositivo. En PostgreSQL nunca se guardan imágenes, solo sus rutas y datos.

**Fotos de más de 16 MB.** El límite está en `js/config.js` (`IMAGE_MAX_BYTES`) y es el mismo que el del bucket. Antes de subir, la app comprueba que el archivo sea de verdad una imagen (por su contenido, no por la extensión), su tamaño y sus dimensiones. Si una foto supera los 16 MB, avisa y deja elegir: usarla **solo en este dispositivo** (se guarda en IndexedDB, nunca se sube y lleva la marca «Solo local»), reducirla y subirla (solo si lo eliges), elegir otra o cancelar. Los demás dispositivos ven la portada sincronizada o la predeterminada. Si el navegador no garantiza que guardará la foto, la app lo dice.

**Sin conexión.** Los cambios se guardan primero en el dispositivo y se suben solos al volver la conexión. Si una subida se corta, la foto se queda en el dispositivo como «Pendiente de subir» y se reintenta. La cabecera de cada playlist muestra si está guardada, guardándose, pendiente o con un error (con un botón para reintentar).

**Pruebas.** En [`tests/playlists`](tests/playlists/README.md) hay pruebas de la migración (incluido RLS) en PostgreSQL y pruebas de la app de punta a punta.

## Modo desarrollador y etiquetado con IA

Se activa en **Ajustes → Modo desarrollador**. Añade «Editar metadatos» al menú ⋯ de cada canción.

- **Las ediciones se escriben dentro del archivo** (MP3: ID3v2; FLAC: comentarios Vorbis; M4A: átomos de iTunes) y, si la canción está en la nube, se sube el archivo actualizado en lugar del anterior. Se escriben los géneros (`GENRE`/`TCON`) y también **lo que transmite** (`MOOD`: `TMOO` en ID3v2.4, `TXXX:MOOD` en ID3v2.3, `MOOD` en FLAC y `----:com.apple.iTunes:MOOD` en M4A, como hacen MusicBrainz Picard y otros). Solo se tocan los campos editados; el resto de etiquetas y el sonido quedan exactamente igual. **Tras subir, la app vuelve a leer el archivo de la nube y comprueba que los cambios están**; si no, avisa y lo deja pendiente. El editor muestra lo que hay guardado ahora mismo en el archivo. Al importar o sincronizar, «lo que transmite» también se lee del archivo (acepta los nombres en inglés: *happy*, *sad*, *chill*…). Varios artistas se escriben separados por comas (con comillas los que llevan coma) y varios géneros, separados por «; ». Los demás dispositivos (y otras personas con el mismo bucket) lo ven al sincronizar, que ocurre al abrir la app, al volver a ella y cada 5 minutos mientras está abierta. Detectan cualquier cambio del archivo, aunque no cambie de tamaño, por su `etag` y su fecha de modificación, y releen solo sus etiquetas. Reconocen el archivo actualizado como la misma canción: conservan playlists, «me gusta» y escuchas, y vuelven a descargar la copia sin conexión si la tenían.
- **Actualizar todo lo anterior**: en **Ajustes → Nube → Actualizar archivos de la nube**, la app revisa cada archivo de tus buckets y lo compara con lo que tiene la app (géneros, lo que transmite y cualquier edición, también las hechas antes de que existiera esta función). Para revisar solo lee la parte de las etiquetas (unos 100–200 KB por canción, sin la portada ni el audio). Después dice cuántos archivos hay que actualizar y cuántos MB se moverán, y los escribe y comprueba uno a uno. Se puede detener; la próxima vez sigue con lo que falte. Los archivos que ya están bien no se tocan. Al terminar muestra un **informe** con cada canción: actualizada, ya estaba bien, error (y por qué) o formato que no admite etiquetas. Mientras trabaja mantiene la pantalla encendida (en el móvil, si se bloquea la pantalla o cambias de app, el navegador lo pausa). Admite etiquetas antiguas y de otros programas: ID3v2.2 de iTunes (se convierte a 2.3 sin perder nada), etiquetas con *unsynchronisation*, cabecera extendida, portada antes del texto, varios valores por campo, solo ID3v1, y M4A con `moov` al principio o al final. Los géneros con barra («Hip-Hop/Rap», «R&B/Soul») se conservan enteros.
- Tras etiquetar con IA, la app pregunta antes de escribir en los archivos, porque las canciones que solo están en la nube hay que descargarlas y volver a subirlas. En Ajustes aparece cuántas canciones tienen cambios pendientes de escribir.
- Las ediciones también se guardan como datos de la app y viajan con tu cuenta y con el primer bucket. Así se ven en los formatos que no admiten escribir etiquetas (OGG, Opus, WAV) y en la música libre. Las portadas que elijas se suben a `_fiora/portadas/` en ese bucket y se incrustan en el archivo (reducidas a 400 px).
- **Canciones repetidas**: detecta las canciones con el mismo título y los mismos artistas (sin importar mayúsculas, tildes ni el orden de los artistas) y las lista en Ajustes. Un botón borra las copias sobrantes: se conserva la que tiene portada y, si todas la tienen (o ninguna), la más reciente; también puedes elegir a mano qué copia conservar o marcar un grupo como «no son repetidas». Las playlists, los «me gusta» y las escuchas de las copias borradas pasan a la que se conserva.
- **Borrar de la nube**: en modo desarrollador, el menú ⋯ de una canción de la nube tiene «Borrar también de la nube», y las copias repetidas que están en la nube se borran de su bucket. Oracle no permite borrar con la URL del bucket (*«Pre-authenticated requests can't be used to delete buckets or objects»*), así que:
  - **Sin más configuración**, el archivo se sobrescribe vacío (0 bytes): no ocupa espacio y desaparece de la app en todos tus dispositivos, pero su nombre sigue en el bucket.
  - **Con una clave de API de Oracle** (Ajustes → Modo desarrollador → Borrar de verdad en Oracle), se borra de verdad. En la consola de Oracle: tu perfil → **Mi perfil → Claves API → Agregar clave API → Generar par de claves API**, descarga la clave privada, pulsa **Agregar**, y pega en Fiora la vista previa de la configuración y el archivo `.pem`. Las peticiones se firman en el navegador (RSA-SHA256, como indica Oracle); la clave privada se guarda en ese dispositivo como clave no exportable y nunca se sincroniza. Tiene los permisos de tu usuario de Oracle, así que añádela solo en dispositivos tuyos (o crea un usuario aparte con permiso solo sobre tus buckets). Con la clave puesta, «Borrar los archivos que quedaron vacíos» limpia del bucket las canciones vaciadas antes.
- **Géneros predefinidos**: el editor ofrece una lista de géneros habituales, y puedes añadir los tuyos en Ajustes.
- **Etiquetado con IA**: elige el servicio, pega su clave de API y el modelo. Funciona con Claude (console.anthropic.com), con OpenAI (platform.openai.com; los modelos de GPT y Codex), con Gemini (claves de aistudio.google.com/api-keys), con los modelos abiertos de **Hugging Face** (Llama, Qwen, Mistral, DeepSeek…; token «Fine-grained» de huggingface.co/settings/tokens con el permiso «Make calls to Inference Providers») y con cualquier servicio que tenga una API compatible con la de OpenAI y admita llamadas desde el navegador. La app envía título, artistas, álbum y año, y recibe géneros y ambiente. La llamada sale directamente de tu navegador con tu clave, que se guarda solo en ese dispositivo y nunca se sincroniza. Cada uso puede tener coste en tu cuenta de ese servicio.

## Explorar

Una sola sección del menú con tres vistas: **Para ti** (lo más visual: ambientes, canciones y radios destacadas, géneros, destinos y experiencias), **Música libre** (los catálogos de siempre y novedades, géneros y recomendaciones) y **Radios** (tus emisoras y colecciones, descubrimiento del día, destacadas, tendencias, ciudades, países y géneros). El buscador de arriba consulta a la vez los catálogos de música y el directorio de radios y agrupa los resultados (canciones, álbumes, artistas, emisoras, países, etiquetas); si una fuente falla, las demás siguen y la que falla ofrece reintentar. La búsqueda se conserva al cambiar de vista.

**De dónde sale cada cosa (nada se inventa)**
- **Emisoras**: [Radio Browser](https://api.radio-browser.info), directorio comunitario gratuito. Se elige un servidor de su lista y, si falla, el siguiente; se avisa del clic al empezar a escuchar (lo piden sus normas; solo se envía el identificador de la emisora). Solo se muestran emisoras HTTPS en formatos que el navegador puede reproducir. Las «tendencias» son los **clics de las últimas 24 horas** en el directorio (no oyentes en directo) y los votos de su comunidad.
- **Ambientes** («Noches de neón», «Café parisino»…): cada uno es una lista de etiquetas en `js/discover.js`. Las canciones son las que el catálogo etiqueta con ellas y las radios las que tienen esas etiquetas en el directorio; la página lo dice. No se atribuye un estado de ánimo a nada por intuición.
- **Ciudades**: lista fija con coordenadas y zona horaria. La hora local es la real y el «amanecer», «atardecer» o «noche» se calcula con la altura del sol en ese momento. Las emisoras son las que el directorio sitúa a menos de 40 km (por sus coordenadas); las que no tienen coordenadas se encuentran por país.
- **Atlas**: solo emisoras con coordenadas válidas, agrupadas por cercanía. Globo o mapa plano (automático: plano con «reducir movimiento» o si el globo va lento). El mapa (Natural Earth, dominio público) y el Atlas se descargan solo al abrirlo. Hay una lista accesible como alternativa.
- **Radar**: emisoras parecidas por etiquetas, idioma y país, con el motivo de cada una. No analiza el sonido.
- **Mezclador** (opcional): Familiar ↔ Sorprendente (géneros de tu biblioteca y lo que escuchas), Local ↔ Internacional (tu país) y Tranquilo ↔ Energético (solo por etiquetas, marcado como aproximado).
- **Pantalla de directo**: logo, país, géneros, idioma, códec y bitrate, favoritas, parecidas y Radar. La animación es decorativa (lo dice) porque los streams de otros sitios no permiten analizar su sonido. Radio Browser no informa de qué canción suena, así que no se muestra.

**Experiencias**: Radio Roulette (cualquier lugar, solo música, un género, un país o «fuera de mi zona»; no repite las últimas y, si una emisora no responde, pasa a otra), Sorpréndeme (canción, emisora o lo que sea), Universo musical (géneros relacionados según una taxonomía editable), Viajes musicales (destinos, orden, género, 3/5/10 minutos por emisora; pausar, saltar, repetir y terminar), Degustación (15/30/60 s por emisora) y Pasaporte musical. Ninguna graba ni guarda audio, y todas usan el mismo reproductor: nunca suenan dos cosas a la vez, y si pones otra música la experiencia termina sola.

**Pasaporte musical** (opcional, se desactiva en su pantalla): un país se sella cuando escuchas una emisora suya un tiempo mínimo seguido (30 s, 1, 2 o 5 minutos; por defecto 1 minuto, sin contar pausas). Abrir una ficha no cuenta. Solo se guarda el país, cuándo se descubrió y con qué emisora.

**Emisoras favoritas, colecciones, pasaporte y preferencias en Supabase.** Sin sesión todo funciona y se guarda en el dispositivo; con sesión se sincroniza. Hay que ejecutar una vez [`supabase/migrations/20261115120000_explore.sql`](supabase/migrations/20261115120000_explore.sql) en el SQL Editor (después de la de playlists; es idempotente). Mientras no se ejecute, Radios lo indica y todo sigue guardándose en el dispositivo.

| Tabla / función | Para qué |
|---|---|
| `fiora_radio_favorites` | Emisoras favoritas: el identificador y una ficha mínima de referencia (nombre, URL del stream, logo, país, etiquetas), nunca audio. |
| `fiora_radio_collections`, `fiora_radio_collection_items` | Colecciones: nombre, descripción, portada opcional y emisoras en tu orden. |
| `fiora_passport` | Un sello por país: primera y última vez, y la emisora. |
| `fiora_explore_prefs` | Mezclador, tu país, pasaporte, modo del Atlas, intervalos y el último viaje. |
| `fiora_load_explore`, `fiora_radio_fav`, `fiora_save_radio_collection`, `fiora_passport_stamp`, `fiora_save_explore_prefs` | Cargar y guardar (las colecciones y preferencias no pisan una versión más nueva de otro dispositivo). |

Todas con RLS (cada usuario solo ve y cambia lo suyo; el rol anónimo no tiene acceso), funciones `security invoker`, límites de tamaño y borrado en cascada al eliminar la cuenta. Las portadas de las colecciones van al bucket `fiora-playlists` con el mismo límite de 16 MB y la misma opción de usarlas solo en el dispositivo. Con esta migración, las emisoras favoritas dejan de viajar en la copia general de la cuenta: así, una emisora quitada en un dispositivo ya no reaparece.

**Pruebas.** En [`tests/explore`](tests/explore/README.md): la migración con RLS en PostgreSQL y la app de punta a punta contra emuladores de Radio Browser, los catálogos y Supabase.

## Catálogos de música libre

En **Explorar** eliges dónde buscar. Todo se puede escuchar en línea, añadir a la biblioteca y (si la licencia lo permite) descargar; cada canción enlaza a su origen y su licencia.

| Catálogo | Qué hay | Clave |
| --- | --- | --- |
| Internet Archive | Conciertos, netlabels, grabaciones antiguas | No |
| Openverse | Música Creative Commons de Jamendo, ccMixter y otros | No (unas 200 búsquedas al día por conexión) |
| Wikimedia Commons | Dominio público y libre; mucha clásica | No |
| Jamendo | Música independiente actual | *Client ID* gratuito de devportal.jamendo.com |

La clave de Jamendo se pega en **Explorar → Música libre → Jamendo** (se guarda en ese dispositivo) o en `js/config.js`.

## Seguridad

- **Política de seguridad de contenido (CSP)** en `index.html`: solo se ejecuta el código de la propia app. Quedan bloqueados los scripts externos, los scripts y manejadores inline (`onclick=…`, `javascript:`) y `eval`, así que un texto malicioso en unas etiquetas, un catálogo o unas letras no puede ejecutar código. Las conexiones solo pueden ir por HTTPS (catálogos, nube, cuentas, IA) y, para modelos de IA locales, a `localhost`. Los estilos inline están permitidos porque la app los usa para colores y anchos, y no ejecutan código.
- **Claves de IA cifradas**: cada dispositivo genera una clave AES-GCM de 256 bits no exportable (el navegador la guarda, pero nadie puede leer su valor). Las claves de API se guardan cifradas con ella y ligadas a su proveedor, y solo se descifran en memoria al llamar al servicio. Las que se guardaron sin cifrar en versiones anteriores se cifran al abrir la app.
- **Clave de API de Oracle**: se guarda como clave privada no exportable; solo sirve para firmar en ese dispositivo.
- Ninguna de estas claves se sincroniza con tu cuenta ni con el bucket.
- Límite de cualquier app web: la propia página puede usar sus claves, así que lo que protege frente a código malicioso es la CSP; el cifrado protege frente a quien copie los datos del navegador. Pon un límite de gasto en tus cuentas de IA y, en Oracle, usa un usuario con permiso solo sobre tus buckets.

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
| `js/playlists-data.js` | Playlists: modelo, sincronización con Supabase (cola de pendientes, reintentos), imágenes pendientes de subir, escuchas por playlist |
| `js/playlist-ui.js` | Playlists: vista, editor por categorías, carrusel y visor, capítulos, filtros, reordenar, recomendaciones, estadísticas, modos |
| `js/images.js` | Imágenes de las playlists: validación, miniaturas, colores con contraste, Supabase Storage, caché y fotos solo locales |
| `supabase/migrations/` | Migraciones para Supabase: playlists y Explorar (tablas, RLS, funciones, bucket) |
| `js/tagwrite.js` | Escritura de metadatos dentro de MP3, FLAC y M4A |
| `js/vault.js` | Cifrado de las claves de IA con una clave del dispositivo no exportable |
| `js/oci.js` | Peticiones firmadas a la API de Oracle (borrado real de archivos) |
| `js/account.js`, `js/sync.js`, `js/config.js` | Cuentas con Supabase y sincronización de datos |
| `js/sources.js` | Catálogos de música libre |
| `js/explore-ui.js` | Explorar: vistas, buscador universal y experiencias |
| `js/radio.js` | Directorio de emisoras Radio Browser (servidores, caché, formatos reproducibles) |
| `js/discover.js` | Ambientes, géneros, ciudades y hora local, ruleta, radar y mezclador |
| `js/radio-data.js` | Favoritas, colecciones, pasaporte y preferencias (dispositivo + Supabase) |
| `js/session.js` | Viajes musicales y degustación (emisoras por tiempo) |
| `js/atlas.js`, `data/world.json` | Globo y mapa (se cargan al usarlos); `tools/make-world.mjs` genera el mapa |
| `js/lyrics.js`, `js/recs.js` | Letras y recomendaciones |
| `js/ai.js` | Etiquetado de géneros y ambiente con IA |
| `js/db.js`, `js/store.js` | Almacenamiento en IndexedDB |
| `sw.js`, `manifest.webmanifest` | Modo sin conexión e instalación |

Las etiquetas se leen con [jsmediatags](https://github.com/aadsm/jsmediatags) (licencia BSD-3-Clause, en `vendor/`). Las fronteras del mapa son de [Natural Earth](https://www.naturalearthdata.com) 1:110m (dominio público), convertidas con `world-atlas`, `topojson-client` e `i18n-iso-countries` solo al generar `data/world.json`; la app no carga ninguna librería externa.
