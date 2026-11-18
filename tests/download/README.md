# Pruebas de Explorar → Descargar

`download-e2e.cjs` prueba la pestaña con Playwright a 390 px. Simula con `ctx.route` dos servidores de Piped (uno caído), un servidor propio de Invidious, el proxy de audio, Apple (iTunes), las miniaturas y el reproductor incrustado de YouTube. El audio es real y se genera con ffmpeg: M4A AAC **fragmentado** (como el de YouTube) y WebM/Opus.

Qué comprueba:
- **Enlaces**: vídeo, `youtu.be`, `shorts`, `music.youtube.com` y playlist; ids no válidos; «Ver más tarde» ignorada; error claro si no es de YouTube.
- **Limpieza de títulos**: «(Official Video)», «[Lyrics]», «- Topic», «VEVO», «Artista - Canción», «feat.», sin romper «Bailando con lobos».
- **Playlists**: un vídeo dentro de una lista pregunta «Solo esta canción» o «Toda la playlist», leyendo dos páginas. Se puede elegir qué canciones incluir.
- **Servidores**: el caído se prueba una vez y se usa el siguiente; el servidor propio va primero; si no responde ninguno, se dice.
- **Guardar en el dispositivo**: con `ffprobe`, el archivo lleva título, artista, artista del álbum, álbum, año y portada de 600×600, y el audio AAC sigue intacto.
- **Añadir a la biblioteca**: canciones sin conexión con portada, duración y metadatos leídos del archivo (también los editados a mano). Sin M4A, se convierte a MP3 con ID3 y se puede abrir. Se crea la playlist en Fiora con su nombre y orden. Un vídeo borrado da un error claro y se ofrece reintentar.
- **Portada sin Apple**: la miniatura se recorta a cuadrado y sin franjas negras.
- **Cancelar**: se puede cancelar a mitad sin dejar canciones a medias; el audio largo se pide en trozos.
- **Buscador de YouTube**: resultados sin shorts y reproductor incrustado. Si dentro del reproductor se pasa a otro vídeo, Fiora lo sigue. «Copiar enlace» copia ese vídeo, cambiar de búsqueda no reinicia el vídeo, y «Descargar» y las playlists del buscador llevan a la descarga.
- Sin errores en consola ni desbordamiento horizontal.

Necesita la app en :8765 (ver [`tests/playlists`](../playlists/README.md)), ffmpeg y ffprobe. Con `SHOTS=<carpeta>` guarda capturas.

```bash
cd tests/download && node download-e2e.cjs
```

**No se prueba aquí**: los servidores reales de Piped e Invidious ni si YouTube los bloquea, su CORS, la velocidad real, Safari e iOS (convertir Opus, compartir archivos) ni las descargas de varios archivos seguidos en el móvil.
