# Fiora

Tu música, sin suscripciones. Una app web instalable (PWA) para escuchar tu propia biblioteca, guardarla en tu nube personal y descubrir música libre y radios.

- **Tu biblioteca**: importa archivos o carpetas enteras (MP3, FLAC, M4A, OGG, WAV…). Lee título, artista, álbum, carátula y letra de las etiquetas.
- **Sin conexión**: la música importada o descargada se guarda en el dispositivo y la app se abre sin internet.
- **Nube personal**: conecta un bucket de Oracle Cloud Object Storage y escucha tu música desde cualquier dispositivo. Playlists, favoritos y estadísticas se sincronizan.
- **Playlists y favoritos**, cola de reproducción, aleatorio y repetición, controles en la pantalla de bloqueo.
- **Letras** sincronizadas (incrustadas en el archivo o de [LRCLIB](https://lrclib.net)) y carátulas.
- **Para ti**: mezcla diaria, redescubre, lo más escuchado y radio a partir de una canción. Todo se calcula en tu dispositivo.
- **Explorar**: música con licencias abiertas de [Internet Archive](https://archive.org) y emisoras de [Radio Browser](https://www.radio-browser.info).

No hay servidor propio, cuentas ni seguimiento: es HTML, CSS y JavaScript sin paso de compilación.

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

Después puedes subir música desde la app (**Ajustes → Subir a la nube**) o directamente al bucket con la consola de Oracle; se organiza como `Artista/Álbum/archivo`. En cada dispositivo, pega la misma URL para ver la misma biblioteca.

> La URL funciona como una contraseña: quien la tenga puede leer y escribir en el bucket. Fiora la guarda únicamente en el dispositivo. No la publiques ni la subas a este repositorio.

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
| `js/cloud.js` | Oracle Cloud Object Storage |
| `js/sources.js` | Internet Archive y radios |
| `js/lyrics.js`, `js/recs.js` | Letras y recomendaciones |
| `js/db.js`, `js/store.js` | Almacenamiento en IndexedDB |
| `sw.js`, `manifest.webmanifest` | Modo sin conexión e instalación |

Las etiquetas se leen con [jsmediatags](https://github.com/aadsm/jsmediatags) (licencia BSD-3-Clause, en `vendor/`).
