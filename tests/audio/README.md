# Pruebas del audio espacial (8D)

| Archivo | Qué prueba |
|---|---|
| `spatial-graph.cjs` | El grafo de `js/spatial.js` con `OfflineAudioContext` y señales de prueba (tono central, estéreo ancho, un solo canal, ruido y onda cuadrada al máximo): al 0 % y con el efecto apagado sale el original; cada modo mueve el sonido con el período esperado; la velocidad y la intensidad actúan; los tres modos dan resultados distintos; el pico nunca supera al de entrada y el nivel cambia poco a poco. |
| `spatial-e2e.cjs` | La app de punta a punta (Chromium): apagado por defecto; controles solo en Ajustes; activar a mitad de canción sin reiniciarla; el balance de salida oscila de verdad y responde a intensidad, velocidad y modo; pausa, búsqueda, volumen, repetir, aleatorio y cambio de pista; radios y música de Explorar siempre por la ruta normal; cambios rápidos y activar/desactivar repetido con una sola fuente sonando; restaurar; persistencia al recargar, entre dispositivos y tras cerrar sesión; sin conexión; el archivo guardado no cambia; Oracle con CORS (procesado) y sin CORS (original); contexto de audio suspendido, fallo a mitad de canción y navegador sin Web Audio. |

## Cómo ejecutarlas

`spatial-graph.cjs` solo necesita la app en `:8765`.

```bash
node spatial-graph.cjs
```

`spatial-e2e.cjs` necesita además el emulador de Supabase en `:8766` (base recién creada con las migraciones), el de radios en `:8767` (`../explore/rb-server.mjs`) y el de Oracle en `:8769` (`../sharing/oracle-server.mjs`, que tiene `/__nocors?on=1` para simular un bucket sin cabeceras CORS).

```bash
node spatial-e2e.cjs
```

Lo que estas pruebas no cubren: cómo suena (hay que escucharlo) y otros navegadores que no sean Chromium.
