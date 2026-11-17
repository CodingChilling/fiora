# Pruebas de las portadas que faltan

`covers-e2e.cjs` (Playwright, Chromium) prueba la búsqueda de portadas del modo desarrollador de punta a punta:

- Sube al emulador de Oracle archivos MP3 y FLAC reales, creados con ffmpeg.
- Conecta el bucket con su clave de API y activa el modo desarrollador.
- Configura la IA como un servicio compatible con OpenAI.

La IA, MusicBrainz y el Cover Art Archive se simulan con respuestas en el formato de sus API. Desde el entorno de pruebas no hay acceso a esos servidores, así que **no se ha probado contra MusicBrainz real**.

Qué comprueba:

- La IA falla: no se consulta nada ni se marca ninguna canción.
- Las canciones del mismo disco comparten portada y una sola búsqueda.
- Coincidencias estrictas: no vale otro artista ni «MOTOMAMI +» por «MOTOMAMI».
- Ninguna canción queda sin portada. Si su disco no tiene portada, recibe la de otra canción del mismo álbum, la de otra del mismo artista (de la biblioteca o de MusicBrainz) o, sin artista conocido, una generada.
- Como mucho una consulta por segundo a MusicBrainz.
- Las portadas se suben a `_fiora/portadas/`.
- El MP3 (APIC) y el FLAC (PICTURE) de la nube llevan la portada dentro y conservan el resto de etiquetas.
- No quedan cambios pendientes.
- La portada se ve en la biblioteca y en otro dispositivo.
- Lo ya intentado no se vuelve a pedir.

Necesita ffmpeg, la app en :8765, el emulador de Supabase en :8766 (con una base recién creada) y el de Oracle en :8769.

```bash
cd tests/covers && NODE_PATH=/opt/node-tools/node_modules node covers-e2e.cjs
```

Resultado: 30 comprobaciones correctas.
