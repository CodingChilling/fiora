# Pruebas de Ajustes

`settings-e2e.cjs` recorre Ajustes con Playwright en móvil (390 px) y escritorio (1280 px):

- La portada lista las siete secciones con un resumen real de cada una («Sin conectar», «Sin sesión», «1 bucket · N canciones»…), sin formularios, y destaca la guía mientras no hay bucket.
- Cada sección abre su propia página (`#/ajustes/<sección>`), sin desbordamiento horizontal; «Atrás» vuelve a la portada y una sección desconocida muestra la portada.
- En escritorio, el menú lateral marca la sección actual y permite cambiar de una a otra.
- **Guía del bucket (Ayuda)**: los dos caminos («Crear mi bucket», 7 pasos, y «Tengo un enlace», 4 pasos), el progreso, que solo el paso actual esté abierto, los nombres de la consola de Oracle y las preguntas frecuentes.
- Se hace la guía de verdad contra los emuladores: iniciar sesión, conectar el bucket desde el formulario del paso 5 y añadir la clave de API desde el paso 6. Cada paso se marca hecho solo y la guía termina en «¡Todo listo!». La clave privada no queda en `localStorage` ni en cookies.

Necesita la app en :8765, el emulador de Supabase en :8766 y el de Oracle en :8769 (los mismos que [`tests/sharing`](../sharing/README.md)). Con `SHOTS=<carpeta>` guarda capturas.

```bash
cd tests/settings && node settings-e2e.cjs
```

No se prueba la consola real de Oracle: los nombres de sus menús pueden cambiar con el tiempo.
