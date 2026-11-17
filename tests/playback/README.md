# Pruebas de reproducción

`playback-e2e.cjs` (Playwright, Chromium) comprueba de punta a punta:

- **Deslizar la canción que suena** (móvil emulado): izquierda → siguiente, derecha → anterior, en el mini reproductor y en la carátula; los gestos cortos, verticales o sobre una radio no hacen nada.
- **Reproducción automática → tu cola**: botón +, menú «Reproducir a continuación», deslizar a la derecha y «Añadir todas a tu cola». Las canciones salen de la reproducción automática y tu cola suena en orden.
- **Fundidos y transiciones**: entrada y salida según la posición, el volumen elegido se respeta, pausa suave, mezcla cruzada (dos canciones a la vez, potencia constante, la anterior cuenta como terminada), sin mezcla si no hay nada detrás o con «repetir una», saltos manuales, radios, mezcla con el audio espacial, persistencia, sincronización con la cuenta y navegadores que no dejan cambiar el volumen.
- **Sin conexión**: la app se abre desde la copia del service worker (también la escena 3D), aviso visible, canciones no descargadas marcadas y saltadas, aviso en Explorar y letras, vuelta de la conexión y red que no responde (la app se abre en menos de 9 s).

Necesita los servidores de prueba (ver `tests/playlists/README.md`): la app en :8765, el emulador de Supabase en :8766 sobre una base recién creada y el de radios en :8767.

```bash
cd tests/playback && NODE_PATH=/opt/node-tools/node_modules node playback-e2e.cjs
```

Resultado: 56 comprobaciones correctas, varias ejecuciones seguidas. Incluye la carrera de cambiar de lista mientras la canción anterior está en sus últimos segundos (se provoca retrasando la carga con una escritura larga en IndexedDB).
