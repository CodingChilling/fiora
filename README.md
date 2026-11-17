# Fiora

Tu música, sin suscripciones. Una app web instalable (PWA) para escuchar tu propia biblioteca, guardarla en tu nube personal y descubrir música libre y radios.

- **Tu biblioteca**: importa archivos o carpetas enteras (MP3, FLAC, M4A, OGG, WAV…). Lee título, artista, álbum, carátula y letra de las etiquetas.
- **Biblioteca cómoda**: búsqueda y pestañas siempre a mano al desplazarte (pulsa `/` para buscar, `Esc` para borrar); la búsqueda también muestra los artistas y álbumes que coinciden; canciones agrupadas por letra (con índice lateral para saltar) o por fecha; filtros rápidos de un toque; orden para canciones, álbumes y artistas; botón de reproducir en cada álbum y artista; géneros y ambientes como tarjetas con sus carátulas; y al volver de un álbum o artista sigues donde estabas.
- **Filtros**: en Biblioteca → Canciones, filtra por dónde están (sin conexión, nube, solo en el dispositivo, música libre), me gusta, géneros, lo que transmite, época, escuchas y fecha en que se añadieron, y ordena por título, artista, álbum, escuchas, año o duración. La búsqueda no distingue tildes.
- **Sin conexión**: la música importada o descargada se guarda en el dispositivo y la app se abre sin internet (ver [Reproducción](#reproducción-sin-conexión-gestos-cola-y-transiciones)).
- **Descargas**: baja una canción, un álbum o una playlist entera dentro de la app, o guarda el archivo en la carpeta de descargas del móvil u ordenador.
- **Nube personal**: conecta uno o varios buckets de Oracle Cloud Object Storage y escucha tu música desde cualquier dispositivo. En el bucket solo hay música: playlists, favoritos y estadísticas van a tu cuenta.
- **Compartir tu música con pocas personas**: un enlace de solo lectura para cada una (como mucho 5 a la vez), con caducidad y revocable. Escuchan tus canciones; sus playlists son suyas y nadie ve las de nadie, salvo las que cada uno decida compartir. Más abajo, [Compartir tu música](#compartir-tu-música).
- **Playlists compartidas**: comparte una playlist con quien elijas entre las personas que conectan el mismo bucket; cada una puede editarla (canciones y capítulos) o solo verla, y los cambios hechos a la vez se fusionan sin perder ninguno. Más abajo, [Compartir playlists](#compartir-playlists).
- **Cuenta**: inicia sesión con correo y contraseña y recupera tus datos en cualquier dispositivo.
- **Playlists personalizables**: portada propia (recortable) o collage de carátulas, colores automáticos o elegidos, emoji, descripción, frase, etiquetas y estado de ánimo; carrusel de hasta 15 fotos con visor a pantalla completa; orden manual arrastrando, filtros, buscador y ordenaciones que no tocan tu orden; capítulos que se pliegan y se reproducen por separado; hasta 3 canciones destacadas; notas personales en cada canción; «Descubre más» con canciones de tu biblioteca; estadísticas con gráficos; modos sorpresa y ambiente; y módulos que se activan y reordenan por playlist. Todo se sincroniza con tu cuenta (Supabase). **«Canciones que te gustan»** tiene el mismo diseño y se personaliza igual; sus canciones las decide el corazón, por defecto de la más reciente a la más antigua, y se puede reordenar a mano (las nuevas favoritas entran arriba) o volver al orden por fecha. No se puede eliminar.
- **Favoritos**, aleatorio y repetición, controles en la pantalla de bloqueo.
- **Cola**: lo que añades a mano suena antes de seguir con lo que estabas escuchando; desliza una canción a la derecha para añadirla. Al acabar, continúa sola con canciones parecidas.
- **Audio espacial (8D)**, opcional: un efecto de movimiento del sonido para las canciones de tu biblioteca, pensado para auriculares. Se configura solo en **Perfil → Ajustes → Audio y reproducción** y no cambia tus archivos. Más abajo, [Audio espacial (8D)](#audio-espacial-8d).
- **Letras** sincronizadas (incrustadas en el archivo o de [LRCLIB](https://lrclib.net)) y carátulas.
- **Para ti**: mezcla diaria, mezclas por ambiente y por hora del día, redescubre y radio a partir de una canción. Aprenden de lo que terminas, lo que saltas y lo que escuchas seguido; todo se calcula en tu dispositivo.
- **Perfil**: tu identidad musical en un sitio: quién eres, tu criatura sonora, todas tus estadísticas (minutos por día, horas y días en que más escuchas, y tus artistas, canciones, álbumes, géneros y ambientes más oídos) y tu evolución. Los **Ajustes** están dentro de Perfil, en el engranaje de arriba a la derecha.
- **Estadísticas por pestañas** (en Perfil): además del resumen de siempre, **Tiempo** (calendario de calor del año, reloj de 24 horas, rachas, récords e hitos, sesiones y comparación con la semana anterior), **Gustos** (décadas y año medio de tu música, ambiente por franja del día, río de géneros y concentración por artista), **Biblioteca** (cuánto has explorado, favoritas olvidadas con «Reproducir todas», canciones que nunca o siempre saltas y crecimiento) y **Conexiones** (red de canciones que pones seguidas y mapa de radios). **Resumen del mes** en tarjetas deslizables, exportable como imagen. Todo se calcula en el dispositivo con datos que ya existían; no se registra nada nuevo. Las escuchas por canción no se guardan por mes, así que la canción y el artista del resumen son «de siempre», y se dice.
- **Tu criatura sonora**: un animal, entre 15, que representa cómo escuchas, dibujado como una escultura 3D de miles de partículas que reaccionan al cursor, al dedo y al sonido. Con explicación basada en tus cifras, ADN musical, metamorfosis, bestiario y constelación de recuerdos. Más abajo, [Tu criatura sonora](#tu-criatura-sonora).
- **Géneros y ambiente**: cada canción puede tener varios géneros y etiquetas de lo que transmite (alegre, melancólica, enérgica…).
- **Modo desarrollador** (solo con la clave de API de Oracle del propietario del bucket): edita portada, título, artistas, álbum, géneros y ambiente desde la app y escríbelos en los archivos; borra canciones de la nube. Los géneros y el ambiente también se pueden etiquetar con IA.
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

En cada dispositivo tuyo, pega la misma URL para ver la misma biblioteca. Para **subir, cambiar o borrar** música desde la app hace falta además la clave de API de Oracle en ese dispositivo (**Ajustes → Modo desarrollador**; ver [Modo desarrollador](#modo-desarrollador-y-etiquetado-con-ia)): sin ella, el bucket es de solo lectura en ese dispositivo. También puedes subir directamente con la consola de Oracle; se organiza como `Artista/Álbum/archivo`.

> La URL funciona como una contraseña: quien la tenga puede leer y escribir en el bucket. Fiora la guarda en el dispositivo y, si inicias sesión, en tu fila de Supabase (que solo puedes leer tú). **No la compartas**, no la publiques ni la subas a este repositorio: para compartir tu música usa enlaces de solo lectura.

**Qué hay en el bucket.** Solo música y las portadas de canciones que elijas en el editor (`_fiora/portadas/`). Playlists, favoritos, escuchas, emisoras y ediciones viven en tu dispositivo y en tu cuenta de Supabase. Las versiones anteriores guardaban una copia de todo eso en `_fiora/datos.json`, dentro del primer bucket; la app la elimina al sincronizar (con la clave de API la borra; sin ella la deja vacía).

## Compartir tu música

Pensado para un número muy pequeño de personas. Necesitas la clave de API de Oracle en tu dispositivo (ver [Modo desarrollador](#modo-desarrollador-y-etiquetado-con-ia)).

1. En **Ajustes → Nube → Compartir «tu bucket»**, escribe para quién es y la caducidad (1 mes, 3 meses, 6 meses o 1 año) y pulsa **Crear enlace de solo lectura**. Fiora pide a Oracle una *Pre-Authenticated Request* de bucket nueva con acceso `AnyObjectRead` y listado de objetos.
2. Copia el enlace y envíaselo por un canal privado. Solo se muestra esa vez; Fiora no lo guarda en ningún sitio.
3. La otra persona, con **su propia cuenta**, lo pega en **Ajustes → Nube → Conectar bucket**.

Qué puede hacer: escuchar y descargar tus canciones. Qué no: subir, cambiar ni borrar nada. Oracle rechaza cualquier escritura con ese enlace, también fuera de la app, y la app tampoco lo ofrece. Sus playlists, favoritos y escuchas se guardan en su cuenta de Supabase, nunca en el bucket. No ve los tuyos ni tú los suyos, porque cada fila está protegida con RLS, salvo las playlists que cada uno comparta a propósito (ver abajo).

En la misma pantalla ves los enlaces vigentes y caducados, y puedes **revocar** cualquiera: deja de funcionar al momento. Como mucho hay 5 enlaces vigentes a la vez. Lo que alguien ya haya descargado en su dispositivo no se puede borrar a distancia. Solo se listan los enlaces creados por Fiora; los demás (por ejemplo, la URL de tus dispositivos) se gestionan en la consola de Oracle, en **Bucket → Pre-Authenticated Requests**.

> **Si antes compartiste la URL de lectura y escritura de tu bucket**, quien la tenga puede seguir escribiendo en él y pudo leer la copia de tus datos (`_fiora/datos.json`). Revócala en la consola de Oracle (**Bucket → Pre-Authenticated Requests → Delete**), crea otra para tus dispositivos, pégala en **Ajustes → Nube** y da a cada persona un enlace de solo lectura. Si sus apps llegaron a mezclar tus playlists con las suyas y las guardaron en su cuenta, [`supabase/compartido-limpieza.sql`](supabase/compartido-limpieza.sql) las localiza.

## Compartir playlists

Las personas que conectan un mismo bucket con su propia cuenta forman su **grupo**, y dentro de él cada una puede compartir sus playlists con quien quiera. Hay que ejecutar una vez [`supabase/migrations/20261116120000_shared_playlists.sql`](supabase/migrations/20261116120000_shared_playlists.sql) en el SQL Editor (después de las otras dos; es idempotente).

- **Cómo se forma el grupo.** El dispositivo con la clave de API de Oracle del bucket guarda en él `_fiora/grupo.json`, con un identificador y una clave aleatorios (nada personal). Quien puede leer el bucket, también con un enlace de solo lectura, presenta esa clave a Supabase al sincronizar y entra en el grupo. Supabase solo guarda la huella (SHA-256) de la clave.
- **Cómo te ven.** Cada persona elige su nombre para el grupo, en **Ajustes → Nube → Playlists compartidas** o la primera vez que comparte. Nunca se muestra el correo.
- **Compartir.** En la playlist, **Compartir** muestra a las personas del grupo. Marcas a quién y eliges, para cada una, **Puede editar** o **Solo ver**. Si alguna canción de la playlist no está en ese bucket, el diálogo lo avisa, porque quien la reciba no podrá escucharla. «Canciones que te gustan» no se comparte.
- **Qué ve quien la recibe.** Aparece en **Playlists → Compartidas contigo**, con el nombre de quien la compartió. Ve canciones, capítulos, portada, colores, descripción, etiquetas y fotos del carrusel. **No ve** las notas personales ni las escuchas, y sus propias escuchas de esa playlist no se guardan.
- **Qué puede hacer.**
  - Con **Puede editar**: añadir canciones (desde «Descubre más», arrastrando o con «Añadir a playlist…»), quitarlas, ordenarlas, moverlas de capítulo y crear, renombrar o borrar capítulos.
  - El aspecto, las fotos, las destacadas, compartirla y eliminarla son solo de su dueño.
  - Con **Solo ver**: escucharla y descargarla.
  - Cualquiera puede **dejar de verla** desde su menú ⋯.
- **Cambios a la vez.** Si dos personas (o dos dispositivos) la cambian a la vez, no se pisa nada.
  - Cada guardado lleva la versión de la que partía. Si alguien guardó después, la app trae lo nuevo, junta los dos cambios y vuelve a guardar.
  - Lo que uno añade se añade y lo que uno quita se quita. Si solo uno reordenó, vale su orden.
- **Quitar el acceso.**
  - Al **revocar el enlace** de una persona en Ajustes → Nube, la app cambia la clave del grupo. Quien sigue pudiendo leer el bucket entra solo con la nueva al sincronizar; quien ya no, deja de ver al momento todo lo que le habían compartido.
  - Si revocas un enlace desde la consola de Oracle, pulsa **Renovar el grupo** en Ajustes → Nube.
  - Desmarcar a alguien en **Compartir** o eliminar la playlist también le quita el acceso.
- **Seguridad.**
  - Las tablas nuevas tienen RLS y ningún acceso directo: todo pasa por funciones que comprueban quién llama.
  - Solo se comparte con miembros vigentes del grupo, y Supabase comprueba en cada lectura que quien recibe y quien comparte siguen en él.
  - Quien colabora solo puede cambiar canciones y capítulos, aunque llame a Supabase directamente.
  - En Storage, la portada y las fotos de una playlist compartida se pueden leer, nunca cambiar.
  - Pruebas en [`tests/sharing`](tests/sharing/README.md).

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

**Pruebas.** En [`tests/playlists`](tests/playlists/README.md) hay pruebas de la migración (incluido RLS) en PostgreSQL y pruebas de la app de punta a punta. Las de compartir el bucket están en [`tests/sharing`](tests/sharing/README.md).

## Modo desarrollador y etiquetado con IA

Se activa en **Ajustes → Modo desarrollador**, y **solo con la clave de API de Oracle** de quien creó el bucket guardada en ese dispositivo y con permiso sobre algún bucket conectado. La app lo comprueba con una petición firmada a Oracle. Sin clave (o al quitarla) el interruptor queda bloqueado y desaparece todo lo que conlleva: editar metadatos, escribir en los archivos, subir, borrar de la nube, canciones repetidas, géneros predefinidos, etiquetado con IA y compartir. Para añadir la clave, en la consola de Oracle ve a tu perfil → **Mi perfil → Claves API → Agregar clave API → Generar par de claves API**, descarga la clave privada, pulsa **Agregar**, y pega en Fiora la vista previa de la configuración y el archivo `.pem`. Las peticiones se firman en el navegador (RSA-SHA256, como indica Oracle). La clave privada se guarda en ese dispositivo como clave no exportable y nunca se sincroniza. Tiene los permisos de tu usuario de Oracle, así que añádela solo en dispositivos tuyos (o crea un usuario aparte con permiso solo sobre tus buckets).

Con el modo activado, el menú ⋯ de cada canción tiene «Editar metadatos».

- **Las ediciones se escriben dentro del archivo** (MP3: ID3v2; FLAC: comentarios Vorbis; M4A: átomos de iTunes) y, si la canción está en la nube, se sube el archivo actualizado en lugar del anterior. Se escriben los géneros (`GENRE`/`TCON`) y también **lo que transmite** (`MOOD`: `TMOO` en ID3v2.4, `TXXX:MOOD` en ID3v2.3, `MOOD` en FLAC y `----:com.apple.iTunes:MOOD` en M4A, como hacen MusicBrainz Picard y otros). Solo se tocan los campos editados; el resto de etiquetas y el sonido quedan exactamente igual. **Tras subir, la app vuelve a leer el archivo de la nube y comprueba que los cambios están**; si no, avisa y lo deja pendiente. El editor muestra lo que hay guardado ahora mismo en el archivo. Al importar o sincronizar, «lo que transmite» también se lee del archivo (acepta los nombres en inglés: *happy*, *sad*, *chill*…). Varios artistas se escriben separados por comas (con comillas los que llevan coma) y varios géneros, separados por «; ». Los demás dispositivos (y otras personas con el mismo bucket) lo ven al sincronizar, que ocurre al abrir la app, al volver a ella y cada 5 minutos mientras está abierta. Detectan cualquier cambio del archivo, aunque no cambie de tamaño, por su `etag` y su fecha de modificación, y releen solo sus etiquetas. Reconocen el archivo actualizado como la misma canción: conservan playlists, «me gusta» y escuchas, y vuelven a descargar la copia sin conexión si la tenían.
- **Actualizar todo lo anterior**: en **Ajustes → Nube → Actualizar archivos de la nube**, la app revisa cada archivo de tus buckets y lo compara con lo que tiene la app (géneros, lo que transmite y cualquier edición, también las hechas antes de que existiera esta función). Para revisar solo lee la parte de las etiquetas (unos 100–200 KB por canción, sin la portada ni el audio). Después dice cuántos archivos hay que actualizar y cuántos MB se moverán, y los escribe y comprueba uno a uno. Se puede detener; la próxima vez sigue con lo que falte. Los archivos que ya están bien no se tocan. Al terminar muestra un **informe** con cada canción: actualizada, ya estaba bien, error (y por qué) o formato que no admite etiquetas. Mientras trabaja mantiene la pantalla encendida (en el móvil, si se bloquea la pantalla o cambias de app, el navegador lo pausa). Admite etiquetas antiguas y de otros programas: ID3v2.2 de iTunes (se convierte a 2.3 sin perder nada), etiquetas con *unsynchronisation*, cabecera extendida, portada antes del texto, varios valores por campo, solo ID3v1, y M4A con `moov` al principio o al final. Los géneros con barra («Hip-Hop/Rap», «R&B/Soul») se conservan enteros.
- Tras etiquetar con IA, la app pregunta antes de escribir en los archivos, porque las canciones que solo están en la nube hay que descargarlas y volver a subirlas. En Ajustes aparece cuántas canciones tienen cambios pendientes de escribir.
- Las ediciones también se guardan como datos de la app y viajan con tu cuenta (nunca con el bucket). Así se ven en los formatos que no admiten escribir etiquetas (OGG, Opus, WAV) y en la música libre. Quien tenga tu bucket compartido ve lo que esté escrito dentro de los archivos. Las portadas que elijas se suben a `_fiora/portadas/` en el primer bucket y se incrustan en el archivo (reducidas a 400 px).
- **Canciones repetidas**: detecta las canciones con el mismo título y los mismos artistas (sin importar mayúsculas, tildes ni el orden de los artistas) y las lista en Ajustes. Un botón borra las copias sobrantes: se conserva la que tiene portada y, si todas la tienen (o ninguna), la más reciente; también puedes elegir a mano qué copia conservar o marcar un grupo como «no son repetidas». Las playlists, los «me gusta» y las escuchas de las copias borradas pasan a la que se conserva.
- **Borrar de la nube**: el menú ⋯ de una canción de la nube tiene «Borrar también de la nube», y las copias repetidas que están en la nube se borran de su bucket. Oracle no permite borrar con la URL del bucket (*«Pre-authenticated requests can't be used to delete buckets or objects»*), así que se borra con la API de Oracle y la clave. Las versiones anteriores, sin clave, dejaban el archivo vacío; «Borrar los archivos que quedaron vacíos» los limpia.
- **Géneros predefinidos**: el editor ofrece una lista de géneros habituales, y puedes añadir los tuyos en Ajustes.
- **Etiquetado con IA**: elige el servicio, pega su clave de API y el modelo. Funciona con Claude (console.anthropic.com), con OpenAI (platform.openai.com; los modelos de GPT y Codex), con Gemini (claves de aistudio.google.com/api-keys), con los modelos abiertos de **Hugging Face** (Llama, Qwen, Mistral, DeepSeek…; token «Fine-grained» de huggingface.co/settings/tokens con el permiso «Make calls to Inference Providers») y con cualquier servicio que tenga una API compatible con la de OpenAI y admita llamadas desde el navegador. La app envía título, artistas, álbum y año, y recibe géneros y ambiente. La llamada sale directamente de tu navegador con tu clave, que se guarda solo en ese dispositivo y nunca se sincroniza. Cada uso puede tener coste en tu cuenta de ese servicio.
- **Buscar portadas que faltan**: con la misma IA (servicio, clave y modelo de los géneros), en **Ajustes → Modo desarrollador → «Buscar portada de N canciones sin portada»** o en el menú ⋯ de una canción sin portada → «Buscar portada». Un modelo de lenguaje no puede dar imágenes fiables, así que el trabajo se reparte en dos partes:
  1. **Primero, directamente con los datos del archivo** (título, artista y álbum), sin IA: es lo normal y basta con una consulta por disco (las canciones del mismo disco, aunque una diga «YHLQMDLG (Deluxe)» y otra «YHLQMDLG», se agrupan). **La IA solo entra para las que así no se encuentran** o cuyos datos no dicen nada («Track 01», «Artista desconocido»): identifica su álbum o single con el título y artista oficiales, por lotes de 20, y se vuelve a buscar. Si no la reconoce, lo dice y no se inventa nada. Para quien lo usa no cambia nada: el mismo botón, el mismo aviso y el mismo progreso.
  2. **La imagen se busca en tres catálogos públicos, gratuitos y sin clave**, de más rápido a más lento:
     - **Apple** ([iTunes Search API](https://performance-partners.apple.com/search-api)): una consulta da el disco y su portada (600 px). Apple pide no pasar de unas 20 consultas por minuto, y la app lo respeta.
     - **YouTube Music, a través de [Piped](https://github.com/TeamPiped/Piped)**: servidores públicos de voluntarios que replican YouTube y dejan consultarlo desde el navegador (YouTube directamente no lo permite). Tiene casi todo, incluida música que no está en las tiendas. Sus servidores van y vienen: la app toma la lista pública de servidores, usa el primero que contesta (en 8 s como mucho) y, si ninguno lo hace, sigue sin ellos. Solo se aceptan imágenes cuadradas: las portadas de YouTube Music, nunca un fotograma de un vídeo.
     - **[MusicBrainz](https://musicbrainz.org)** y su [Cover Art Archive](https://coverartarchive.org): una consulta por segundo e imágenes de archive.org (más lento), con discos que los demás no tienen.

     Si el navegador no deja leer alguno, se sigue con los demás. Varios discos se buscan a la vez. En todos, **solo se acepta si título y artista coinciden exactamente** (sin contar tildes, mayúsculas ni añadidos como «Deluxe», «- Single» o « - Topic»): un disco del mismo nombre de otro artista, o «MOTOMAMI +» en lugar de «MOTOMAMI», no vale. El aviso final dice cuántas imágenes salieron de cada catálogo.

  3. **Ninguna canción se queda sin portada.** Si su disco no tiene portada (o no se identifica), se usa, por este orden: la de otra canción del **mismo álbum** de tu biblioteca; la más repetida entre las canciones del **mismo artista** de tu biblioteca; la de **otro disco del artista** en Apple, YouTube Music o MusicBrainz (mejor un álbum que un single); y, si no se sabe ni el artista (p. ej. «Track 01»), una **portada generada** en el dispositivo con un degradado, el título y el artista. La app anota de dónde salió cada una («del disco», «del álbum», «del artista» o «generada»).

  Las canciones del mismo disco comparten portada y una sola búsqueda. Las portadas se reducen a 600 px y se suben a `_fiora/portadas/` para tus otros dispositivos. Después **se escriben dentro de cada archivo (MP3, FLAC, M4A) y se suben a la nube junto con el resto de metadatos editados**, con la misma comprobación que el resto de ediciones; el resto del archivo no cambia (los WAV, OGG y Opus no admiten etiquetas: allí la portada la ven la app y tus dispositivos). Si la IA o MusicBrainz fallan a mitad, las canciones que faltan se quedan sin tocar para la próxima vez, en lugar de recibir una portada provisional. A la IA le llegan título, artistas, álbum y año; a Apple, YouTube Music (Piped) y MusicBrainz, solo el disco, el artista y el título. Ninguna espera puede dejar la búsqueda colgada: la IA tiene 90 s como mucho (mientras, el aviso cuenta los segundos) y cada consulta o descarga, 20 s; si la IA falla, se sigue sin ella.

## Tu criatura sonora

Está en **Perfil**. Es una interpretación visual de hábitos musicales observables, no un perfil psicológico. Para tenerla en todos tus dispositivos hay que ejecutar una vez [`supabase/migrations/20261117120000_creature.sql`](supabase/migrations/20261117120000_creature.sql) en el SQL Editor (es idempotente); sin ella funciona igual, guardada solo en el dispositivo.

**Los 15 animales**

| Animal | Patrón | Indicadores principales |
|---|---|---|
| Búho · el noctámbulo | Música de noche | Parte de las escuchas entre las 21:00 y las 6:00; días con música de noche |
| Alondra · el madrugador | Música por la mañana | Parte de las escuchas entre las 6:00 y las 12:00; días con música de mañana |
| Lobo · el fiel | Vuelve a lo mismo | Escuchas de tus 5 artistas principales; de canciones ya conocidas; repeticiones en el día |
| Zorro · el explorador | Descubre | Escuchas de canciones nuevas para ti; artistas nuevos |
| Elefante · el nostálgico | Recupera | Reencuentros con canciones que llevaban más de 60 días sin sonar |
| Tortuga · el maratoniano | Sesiones largas | Duración mediana de sesión; sesiones de una hora o más |
| Liebre · el de los momentos | Ratos cortos y frecuentes | Sesiones de 15 minutos o menos; sesiones por día |
| Colibrí · el inquieto | Cambia mucho | Canciones saltadas; cambios de artista entre canciones seguidas |
| Camaleón · el versátil | Muchos estilos | Diversidad de géneros; días en que cambia el género principal |
| Delfín · el navegante | Biblioteca y radio | Equilibrio de tiempo entre las dos; cambios dentro de una sesión |
| Águila · el viajero | Radios del mundo | Países de las emisoras escuchadas; países nuevos |
| Abeja · el curador | Organiza | Playlists creadas, canciones añadidas y cambios guardados por semana |
| Ardilla · el coleccionista | Guarda | Canciones añadidas a la biblioteca y favoritas por semana |
| Pingüino · el ritualista | Muy regular | Días con la misma franja principal; días con música |
| Ballena · el inmersivo | Se sumerge | Canciones de 6 minutos o más; canciones seguidas del mismo álbum; escuchadas hasta el final |

Cada animal se define en un solo sitio (`ANIMALS` en `js/creature.js`: textos, reglas, evidencia mínima, hechos de la explicación, colores, movimiento y hábitat) y su geometría en `js/creature-shapes.js`. Añadir uno no toca el motor.

**Cómo se asigna** (reglas deterministas, sin IA)

1. De los resúmenes diarios del período (7, 30 o 90 días, o todo el historial) se calculan indicadores. Casi todos son proporciones, para que escuchar más horas no dé más puntos.
2. Cada regla de un animal compara un indicador con dos valores: desde cuál empieza a contar y en cuál cuenta del todo. Entre los dos, vale de 0 a 1.
3. La puntuación del animal (0–100) es mitad la media ponderada de sus reglas y mitad su regla esencial más débil. Si falta el dato de una regla esencial o no hay evidencia mínima, el animal no participa.
4. **Principal**: la puntuación más alta, si llega a 30. **Secundario**: el siguiente, solo si llega a 40 y al 60 % del principal.
5. **Datos insuficientes**: con menos de 15 escuchas (o 45 minutos) en 3 días distintos, o si ningún animal llega al mínimo, no se asigna ninguno: «Tu criatura está tomando forma».
6. **Metamorfosis**: la criatura se revisa como mucho una vez al día y solo cambia si otro animal la supera en 8 puntos durante 3 días distintos.

La puntuación no es un porcentaje de afinidad; la app muestra su desglose regla a regla. «Tus 5 artistas principales» solo se usa si has escuchado al menos a 10 artistas. Los géneros solo cuentan con canciones etiquetadas. Los países salen de las emisoras, nunca del nombre de un artista.

**Qué se guarda**

- Un **resumen por día** con contadores: escuchas, segundos, franjas de 3 horas, canciones nuevas o repetidas, reencuentros, saltos, duración de las sesiones, géneros, segundos de radio por país y cambios en playlists. Sin canciones, sin artistas y sin horas exactas. Se conservan 400 días.
- Una **entrada por mes** para el bestiario (animal, puntuación y cifras principales) y la criatura actual.
- Tus preferencias de la experiencia.
- En Supabase van a tres tablas con RLS (`fiora_habit_days`, `fiora_creature_log`, `fiora_creature_state`): solo su dueño las lee. Nunca van al bucket.
- En **Ajustes → Tu criatura sonora** puedes desactivarla (deja de guardarse el resumen; las estadísticas siguen), quitar animaciones, hábitat o reacción al sonido, elegir el período principal y **eliminar sus datos** sin tocar tus estadísticas.

**La figura 3D**

- **Geometrías originales de Fiora**, sin modelos de terceros: cada animal es un volumen hecho con elipsoides y conos redondeados unidos con suavidad (campo de distancia). Las partículas se reparten sobre su superficie y su interior.
- **Three.js** (MIT), copiado en `vendor/`. Se carga solo al abrir Perfil o la criatura. Una sola geometría con buffers; entre 3.600 y 15.000 partículas según el dispositivo, y menos si va lento.
- **Interacción**: las partículas cercanas al cursor o al dedo se apartan (o se acercan, en modo atracción) y vuelven con inercia. Arrastrar gira, la rueda o el pellizco acercan, y hay botones para todo.
- **Sonido**: reacciona al volumen real solo con canciones descargadas en la app (se analiza el archivo en el dispositivo). Con emisoras o canciones en streaming el navegador no deja analizar el audio, así que la animación es ambiental y la app lo dice.
- **Datos en las partículas**, con leyenda: colores secundarios por género, puntos periféricos por variedad, destellos por canciones nuevas y un anillo por fuente (biblioteca y radio).
- **Accesibilidad**: respeta «reducir movimiento», se puede pausar, y sin WebGL muestra una silueta estática con la misma información.
- **Compartir**: crea una imagen (o una animación de 4 s donde el navegador lo permite) en el dispositivo, sin subir nada. Tú eliges si lleva alias, secundario o alguna cifra; por defecto, ninguna.

**Limitaciones**

- Los indicadores de sesiones, descubrimiento, reencuentros y radio empiezan a contar desde que existe el resumen diario. De lo anterior solo se usan los totales, y solo en «Todo el historial».
- Entre dispositivos, de cada contador del día se conserva el valor más alto: si escuchas el mismo día en dos dispositivos, ese día puede quedar corto.
- La constelación se ve entera y agrupada en el centro: la cámara no se acerca más que su encuadre. Tocar una estrella (o elegirla en la lista) la resalta y muestra su tarjeta, sin recargar la escena. Allí solo están los botones que hacen algo: animación, hábitat y pantalla completa (girar y acercar son para la figura). El botón «girar con un dedo» solo aparece en pantallas táctiles.
- La constelación no incluye «artista nuevo descubierto» ni «canción recuperada» con nombre, porque el resumen no guarda qué canciones son.
- La animación exportable depende de `MediaRecorder`; donde no existe, solo hay imagen.

Pruebas en [`tests/profile`](tests/profile/README.md).

## Audio espacial (8D)

Un efecto opcional que mueve el sonido mientras escuchas. Está apagado por defecto y toda su configuración vive en **Perfil → Ajustes → Audio y reproducción**: no hay botones ni indicadores en el reproductor ni en ninguna otra pantalla. No mejora la calidad de la música; añade un efecto.

**A qué se aplica**

| Fuente | ¿Se procesa? |
|---|---|
| Canciones importadas o descargadas en la app | Sí, siempre |
| Canciones de tu biblioteca que suenan directamente desde Oracle | Sí, si el bucket responde con cabeceras CORS; si no, audio original |
| Música libre que has guardado en tu biblioteca | Sí, si su servidor permite CORS; si no, audio original |
| Música libre reproducida desde Explorar | No |
| Emisoras de radio (cualquiera) | Nunca |

**Modos**

| Modo | Qué hace | Movimiento |
|---|---|---|
| Suave | Paneo estéreo senoidal lento (`StereoPannerNode`) | Amplitud hasta 0,6 · una vuelta cada 8–33 s |
| Circular | Paneo estéreo más amplio, con un filtro que apaga un poco los agudos al pasar «por detrás». Es un efecto estéreo, no sonido 3D real | Amplitud hasta 0,9 · una vuelta cada 4–20 s |
| Envolvente (experimental) | Mezcla mono situada con `PannerNode` y HRTF en una órbita alrededor de la cabeza, sumada al estéreo original | Una vuelta cada 5–25 s |

- **Intensidad** (0–100 %): cuánto se mueve el sonido. Al 0 % sale el original, muestra a muestra.
- **Velocidad** (0–100 %): la frecuencia del movimiento dentro del rango de cada modo.
- Los cambios se aplican en marcha y suavizados (unos 150 ms), sin reiniciar la canción.

**Cómo está hecho (`js/spatial.js`)**

- **Dos elementos de audio y una sola fuente audible.** El de siempre se usa para radios, Explorar, el efecto apagado y todo lo que no se pueda procesar, y nunca se conecta a Web Audio. El segundo solo existe para la ruta espacial y se conecta una única vez al grafo. Así, nada de lo que falle en el procesamiento puede dejar la reproducción normal en silencio.
- **Antes de cada canción** se decide la ruta: tiene que estar en tu biblioteca, no ser una radio, el efecto estar activado y la fuente ser legible por Web Audio. Para direcciones de otro servidor se hace antes una petición de comprobación; solo si pasa se carga con `crossOrigin` anónimo.
- **Vuelta segura:** si el elemento espacial da error o el sonido no arranca, la misma canción sigue por el elemento normal en el mismo punto, sin avisos y sin tocar tu preferencia.
- **Nunca más alto que el original:** el paneo se compensa instante a instante para que ningún canal supere a la entrada, y la rama HRTF lleva un limitador.
- **Preferencias:** en el dispositivo (funciona sin conexión) y, con sesión, en tu cuenta junto al resto de ajustes. No hay tablas nuevas ni se sube audio a ningún sitio.

**Medido** (con señales de prueba, `tests/audio/spatial-graph.cjs`): el balance izquierda-derecha oscila con el período esperado en los tres modos; el pico nunca supera al de entrada; el nivel medio baja entre 2 y 5 dB en Suave y Circular y entre 2 y 10 dB en Envolvente según la señal.

**Límites y pendientes**

- **Sin validar de oído.** Las pruebas miden movimiento y niveles, no si suena agradable. La comodidad, la claridad de las voces y si el modo Envolvente merece quedarse hay que juzgarlos escuchando; ese modo es el que más cambia el timbre y el volumen.
- **Solo probado en Chromium.** Firefox, Safari, iOS y Android no se han probado, ni la reproducción en segundo plano en el móvil con el efecto activo.
- **Oracle real sin probar:** se ha verificado contra un emulador, con y sin CORS. Con tu bucket, si Oracle no manda esas cabeceras, las canciones en streaming sonarán en original (las descargadas en la app se procesan siempre).
- Activar el efecto a mitad de canción la pasa de un elemento de audio al otro: puede notarse un corte muy breve.

Pruebas en [`tests/audio`](tests/audio/README.md).

## Reproducción: sin conexión, gestos, cola y transiciones

**Sin conexión.** La app entera se guarda al instalarse (también la escena 3D de la criatura y el mapa de radios), así que se abre sin internet. Una píldora arriba avisa «Sin conexión · solo lo descargado». Las canciones que no están descargadas aparecen atenuadas y, al tocarlas, se explica por qué no suenan; al pasar de canción se saltan. Explorar avisa de que la música libre y las radios necesitan internet, y las letras dicen que no hay conexión. Los cambios (playlists, favoritos, ajustes) se guardan en el dispositivo y se suben al volver. Si la red «parece» funcionar pero no carga nada, a los 3,5 s se usa la copia guardada.

**Deslizar la canción que suena.** En el mini reproductor del móvil o en la carátula de «Reproduciendo»: a la izquierda, la siguiente; a la derecha, la anterior. Un gesto corto o vertical no hace nada. Con una radio en directo, tampoco.

**Reproducción automática → tu cola.** Cuando se acaba lo que escuchas y siguen canciones parecidas, en la Cola cada una lleva un botón **+** (o se desliza a la derecha) para pasarla a tu cola. El menú ⋯ ofrece también «Reproducir a continuación», y hay un botón «Añadir todas a tu cola». La canción sale de la reproducción automática, así que no suena dos veces.

**Transiciones y fundidos** (Perfil → Ajustes → Audio y reproducción). Todo viene apagado.

| Opción | Qué hace |
| --- | --- |
| Transición entre canciones | «Una tras otra» o «Mezcla cruzada» (de 1 a 12 s): el final de una canción suena a la vez que el principio de la siguiente, con curvas de potencia constante |
| Fundido de entrada / de salida | De 0 a 10 s al empezar y al acabar cada canción. Dependen de la posición: al buscar o volver atrás, el volumen siempre es el correcto |
| Suavizar pausa y reanudación | Un fundido de 0,35 s en vez de un corte |
| Mezclar también al saltar de canción | Al pulsar siguiente o anterior, la que suena se desvanece (hasta 3 s con mezcla cruzada, 1 s si no) |

- Los fundidos multiplican el volumen que elijas, nunca lo cambian. En canciones cortas, entrada y salida juntas ocupan como mucho el 40 % de la canción.
- No hay mezcla si no hay nada detrás, con «repetir una» ni con radios (las radios solo usan el fundido de pausa).
- Funciona con el audio espacial: los dos elementos espaciales pasan por el mismo efecto.
- Se guarda en el dispositivo y, con sesión, en tu cuenta (sin tablas nuevas).
- **iPhone y iPad no dejan que una página cambie el volumen**: allí los fundidos y la mezcla no se aplican (se avisa en Ajustes) y la reproducción sigue como siempre.

**Límites.** Probado solo en Chromium (escritorio y móvil emulado). Sin probar en Firefox, Safari, iOS y Android reales, ni con la pantalla apagada en el móvil: los fundidos usan un temporizador que algunos navegadores ralentizan en segundo plano (la mezcla también se comprueba con cada avance de la canción).

Pruebas en [`tests/playback`](tests/playback/README.md).

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
- **Bucket compartido**: cada persona recibe su propio enlace de solo lectura. Oracle impide escribir con él, caduca y se puede revocar. En el bucket no hay datos personales: playlists, favoritos, escuchas, ediciones y ajustes solo van a la cuenta de cada persona, protegida con RLS (nadie lee las filas ni las imágenes de otra cuenta). Subir, cambiar o borrar archivos y el modo desarrollador solo funcionan con la clave de API del propietario.
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
| `js/player.js` | Reproductor, cola y controles del sistema; elige entre la ruta normal y la espacial |
| `js/spatial.js` | Audio espacial (8D): grafo de Web Audio, modos, comprobación de compatibilidad |
| `js/covers.js` | Portadas que faltan: búsqueda en Apple (iTunes Search API), YouTube Music (Piped) y MusicBrainz / Cover Art Archive, y portadas generadas |
| `js/fades.js` | Fundidos y mezcla cruzada: ajustes, curvas y volumen de cada momento |
| `js/library.js`, `js/tags.js` | Importación y lectura de etiquetas |
| `js/cloud.js` | Oracle Cloud Object Storage (uno o varios buckets) |
| `js/flac.js` | Conversión sin pérdida de WAV a FLAC |
| `js/playlists-data.js` | Playlists: modelo, sincronización con Supabase (cola de pendientes, reintentos), imágenes pendientes de subir, escuchas por playlist |
| `js/profile-ui.js` | Perfil y la experiencia «Tu criatura sonora» (pestañas, controles, exportar, panel de Ajustes) |
| `js/stats-extra.js`, `js/stats-ui.js` | Estadísticas por pestañas de Perfil y resumen del mes: cálculos y gráficos (HTML y SVG propios) |
| `js/habits.js` | Resumen diario de hábitos, historial de criaturas y preferencias; sincronización con Supabase |
| `js/creature.js` | Motor de la criatura: indicadores, los 15 animales, puntuaciones, explicaciones, ADN y metamorfosis |
| `js/creature-data.js` | Une los datos de Fiora con el motor; criatura oficial, bestiario y recuerdos |
| `js/creature-shapes.js` | Geometrías 3D de los 15 animales y reparto de partículas |
| `js/creature3d.js` | Escena 3D de partículas con Three.js: física, gestos, hábitats, metamorfosis y constelación |
| `js/playlist-ui.js` | Playlists: vista, editor por categorías, carrusel y visor, capítulos, filtros, reordenar, recomendaciones, estadísticas, modos |
| `js/images.js` | Imágenes de las playlists: validación, miniaturas, colores con contraste, Supabase Storage, caché y fotos solo locales |
| `supabase/migrations/` | Migraciones para Supabase: playlists, Explorar, playlists compartidas y criatura sonora (tablas, RLS, funciones, bucket) |
| `js/tagwrite.js` | Escritura de metadatos dentro de MP3, FLAC y M4A |
| `js/vault.js` | Cifrado de las claves de IA con una clave del dispositivo no exportable |
| `js/groups.js`, `js/merge.js` | Grupo de cada bucket (para compartir playlists) y fusión de cambios hechos a la vez |
| `js/oci.js` | Peticiones firmadas a la API de Oracle: comprobar la clave, borrar archivos y crear, listar y revocar enlaces de solo lectura |
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

Las etiquetas se leen con [jsmediatags](https://github.com/aadsm/jsmediatags) (licencia BSD-3-Clause, en `vendor/`). Las fronteras del mapa son de [Natural Earth](https://www.naturalearthdata.com) 1:110m (dominio público), convertidas con `world-atlas`, `topojson-client` e `i18n-iso-countries` solo al generar `data/world.json`. La figura 3D usa [Three.js](https://threejs.org) 0.180 (licencia MIT, en `vendor/`, con su licencia en `vendor/three.LICENSE`). La app no carga nada desde servidores externos.
