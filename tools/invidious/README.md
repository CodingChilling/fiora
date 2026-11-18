# Servidor de descargas para Fiora (Invidious)

YouTube bloquea a los servidores públicos de descarga, que están en centros de datos, pero no a las conexiones de casa. Con esta carpeta montas Invidious en un ordenador de tu casa (o una Raspberry Pi) y lo publicas en internet con https. Todos los usuarios de Fiora pueden usarlo mientras ese equipo esté encendido.

Piezas:
- **Invidious**: la API de YouTube que usa Fiora.
- **invidious-companion**: habla con YouTube y sirve el audio.
- **PostgreSQL**: la base de datos de Invidious.
- **Caddy**: una sola puerta en el puerto 8080, con el permiso CORS que necesita Fiora.

Todo lo de esta carpeta es gratuito.

## 1. Instalar Docker

- **Windows o Mac**: [Docker Desktop](https://docs.docker.com/desktop/).
- **Linux o Raspberry Pi**: [Docker Engine](https://docs.docker.com/engine/install/).

## 2. Poner tus claves

Genera dos claves aleatorias. En Windows puedes usar la terminal de Git Bash.

```bash
openssl rand -hex 8
```

```bash
openssl rand -hex 20
```

- La primera tiene **exactamente 16 caracteres**. Pégala en `docker-compose.yml` en los **dos** sitios donde pone `CAMBIA_16_CARACT`.
- La segunda va en `hmac_key`, en lugar de `CAMBIA_ESTA_CLAVE_POR_UNA_LARGA_Y_ALEATORIA`.

En una Raspberry Pi (ARM64), cambia la imagen de Invidious por `quay.io/invidious/invidious:latest-arm64`.

## 3. Arrancar

En esta carpeta:

```bash
docker compose up -d
```

Comprueba que funciona abriendo en ese ordenador `http://localhost:8080/api/v1/videos/jNQXAC9IVRw`. Debe salir un texto largo (JSON) con `"title":"Me at the zoo"`.

- Si sale un error con «Sign in to confirm you're not a bot», YouTube también bloquea tu conexión: no hay nada más que hacer con esta instalación.
- Si algo no arranca, mira los registros:

```bash
docker compose logs -f
```

## 4. Publicarlo con https (gratis)

Fiora va por https, así que el servidor también tiene que estarlo para que lo usen otros dispositivos.

- **Dirección fija (recomendado): [Tailscale Funnel](https://tailscale.com/kb/1223/funnel).** Es gratuito y no hace falta tener dominio. Instala Tailscale en ese ordenador, inicia sesión y ejecuta:

  ```bash
  tailscale funnel --bg 8080
  ```

  Te da una dirección fija del tipo `https://tu-equipo.tu-red.ts.net`.
- **Para probar: túnel rápido de Cloudflare.** Sin cuenta, pero la dirección cambia cada vez que lo arrancas:

  ```bash
  cloudflared tunnel --url http://localhost:8080
  ```

## 5. Ponerlo en Fiora

- **Solo para ti:** en Fiora, abre **Explorar → Descargar → Servidor de descarga**, pega la dirección https y pulsa **Guardar y probar**. Si inicias sesión, se guarda en tu cuenta.
- **Para todos los usuarios:** pon la dirección en `YT_SERVER` dentro de `js/config.js` y publica la app. Fiora lo usará antes que los servidores públicos, y quien tenga uno propio seguirá usando primero el suyo.

## Mantenimiento

YouTube cambia a menudo. Si deja de funcionar, actualiza las imágenes:

```bash
docker compose pull
```

```bash
docker compose up -d
```

## Cosas a tener en cuenta

- Mientras el ordenador esté apagado, las descargas vuelven a depender de los servidores públicos.
- El audio pasa por tu conexión de casa. Con mucho uso, YouTube podría limitar también tu IP.
- Cualquiera que conozca la dirección puede usar tu servidor.
- Este archivo de Docker es una versión resumida de la [guía oficial de Invidious](https://docs.invidious.io/installation/), y no se ha podido arrancar aquí (no hay Docker ni acceso a YouTube). Si algo falla, como errores de base de datos o de companion, compárala con la guía oficial, que manda.
