# Pruebas de Perfil y de «Tu criatura sonora»

| Archivo | Qué prueba |
|---|---|
| `creature-test.mjs` | El motor (`js/creature.js`) con **perfiles de escucha sintéticos**: cada uno de los 15 patrones produce su animal y una explicación con sus cifras; datos insuficientes y escucha sin patrón no asignan ninguno; el secundario exige evidencia; escuchar más horas con el mismo reparto da la misma puntuación; ADN musical; metamorfosis sin oscilaciones; 15 definiciones y 15 geometrías distintas y en 3D; unión de un mismo día entre dispositivos. |
| `profile-e2e.cjs` | La app de punta a punta con Playwright (escritorio y móvil, con WebGL por software): navegación Perfil/Ajustes, ajustes y estadísticas conservados, escucha real anotada en el resumen diario, asignación y explicación, las 15 criaturas dibujadas en 3D, partículas que reaccionan al cursor y al dedo y vuelven con inercia, giro y zoom, pausa de animaciones y hábitat, reacción al sonido real, ADN, secundario, metamorfosis, bestiario, constelación, exportación a PNG, sincronización con Supabase entre dos dispositivos, otra cuenta sin acceso, alternativa sin WebGL, «reducir movimiento», desactivar la criatura y eliminar sus datos sin tocar las estadísticas, y consola sin errores. |
| `stats-test.mjs` | Los cálculos de las estadísticas por pestañas (`js/stats-extra.js`) con datos fabricados: calendario que cruza de año, rachas con huecos, semana frente a la anterior, sesiones, décadas con canciones sin año, ambiente por franja, río de géneros, concentración y bloques, biblioteca explorada, favoritas olvidadas, saltos, crecimiento, parejas de canciones y resumen de un mes con y sin datos. |
| `stats-e2e.cjs` | Las pestañas en la app (escritorio y móvil) con los datos de `seed-stats.cjs`: cada bloque se pinta con los valores calculados, avisos cuando faltan datos, etiquetas al señalar un día, «Reproducir todas», red manejable con ratón y teclado, mapa de radios, pestaña recordada, resumen del mes con cambio de mes y exportación a PNG, sin desplazamiento horizontal en el móvil y sin errores en consola. Solo necesita la app en `:8765`. |

## Cómo ejecutarlas

```bash
node creature-test.mjs
```

```bash
node stats-test.mjs
```

`profile-e2e.cjs` usa los mismos servidores que las pruebas de playlists (ver `../playlists/README.md`): la app en `:8765` y `sb-server.mjs` en `:8766` sobre una base recién creada, además de los audios de `../playlists/fixtures`.

```bash
node profile-e2e.cjs
```

```bash
node stats-e2e.cjs
```

Con `SHOTS=<carpeta>` guarda capturas de Perfil, de la experiencia, de cada animal y de la tarjeta exportada.
