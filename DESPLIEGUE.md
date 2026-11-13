# Guía de despliegue · Fercho

Dos caminos. Elige uno:

* **A. Servidor propio (VPS) con Docker** — control total, un solo servidor. Recomendado si te sientes cómodo con una terminal.
* **B. Plataforma administrada (Render, Railway, Fly.io…)** — menos mantenimiento, sin tocar servidores.

> Antes de lanzar a clientes reales, completa la **lista de verificación** del final.

---
## Opción A · VPS con Docker (HTTPS automático)

**Necesitas:** un VPS con Ubuntu 22.04/24.04 (2 vCPU, 2–4 GB RAM, 40 GB SSD), un dominio y acceso SSH.

1. **Dominio:** crea un registro DNS tipo `A` (por ejemplo `pedidos.tunegocio.com`) apuntando a la IP del VPS.
   Si usas Cloudflare, déjalo en modo "DNS only" mientras Caddy obtiene el certificado.
2. **Prepara el servidor** (por SSH):
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   ```
   Entra al servidor solo con llave SSH (desactiva la contraseña en `/etc/ssh/sshd_config`: `PasswordAuthentication no`).
3. **Sube el proyecto** al servidor (git clone o scp) y entra a la carpeta.
4. **Crea el `.env`:** `cp .env.example .env` y completa como mínimo:
   ```
   DOMINIO=pedidos.tunegocio.com
   POSTGRES_PASSWORD=<clave larga aleatoria>
   JWT_SECRET=<48 bytes hex: openssl rand -hex 48>
   DATABASE_URL=postgres://fercho_admin:<la misma clave>@db:5432/fercho
   EXIGIR_2FA=admin
   NEQUI_NUMERO=...   NEQUI_NOMBRE=...   (si usarás Nequi)
   ```
5. **Arranca:** `docker compose up -d --build`. La primera vez crea las tablas y el catálogo de ejemplo.
6. **Crea el administrador:**
   ```bash
   docker compose run --rm app node scripts/crear-usuario.js admin "UnaClaveLarga2026" admin
   ```
7. **Usuario de base de datos con permisos mínimos** (importante):
   ```bash
   docker compose run --rm -e DATABASE_URL_ADMIN="postgres://fercho_admin:<clave>@db:5432/fercho" app node scripts/crear-usuario-bd.js
   ```
   Copia la línea `DATABASE_URL=...fercho_app...` que imprime, reemplaza la `DATABASE_URL` del `.env`, deja la de administrador
   como `DATABASE_URL_ADMIN` y reinicia: `docker compose up -d`.
8. Abre `https://tu-dominio`, entra como admin y **activa la verificación en dos pasos** (te la pedirá).
9. Crea los usuarios de caja y cocina en "Usuarios", carga tu menú real, el stock inicial y genera los QR **desde el dominio definitivo**.

**Actualizar:** sube los archivos nuevos y `docker compose up -d --build`. Si hay migraciones nuevas:
`docker compose run --rm -e DATABASE_URL_ADMIN=... app node scripts/migrar.js db/migracion_XX.sql`.

**Copias de seguridad:** `docker compose exec -T db pg_dump -U fercho_admin -Fc fercho > backups/fercho_$(date +%F).dump`
(prográmalo con `crontab -e` cada noche y copia el archivo FUERA del servidor).

---
## Opción B · Plataforma administrada (Render / Railway / Fly.io)

1. Sube el proyecto a un repositorio **privado** de GitHub (el `.gitignore` ya excluye `.env`).
2. Crea una **base PostgreSQL** administrada y un **servicio web Node**. Comando de inicio: `node src/server.js`.
3. Variables de entorno del servicio: `NODE_ENV=production`, `TRUST_PROXY=1`, `DATABASE_SSL=true`, `JWT_SECRET`, `EXIGIR_2FA=admin`,
   `DATABASE_URL` (la que da la plataforma), `NEQUI_NUMERO`/`NEQUI_NOMBRE`.
4. **Fotos:** desde la v7.2 se guardan en la base de datos; no necesitas disco. (Solo en versiones anteriores había que montar un disco persistente y apuntar `UPLOADS_DIR` a él.)
5. Desde tu computador, con la URL externa de la base como `DATABASE_URL_ADMIN` en tu `.env` local, ejecuta una vez:
   ```
   node --env-file=.env scripts/migrar.js db/schema.sql
   psql "<url>" -f db/seed.sql        (o pega seed.sql en el editor SQL de la plataforma)
   node --env-file=.env scripts/crear-usuario.js admin "UnaClaveLarga2026" admin
   node --env-file=.env scripts/crear-usuario-bd.js     # imprime la URL de permisos mínimos para el servicio web
   ```
6. Configura el **dominio propio** del servicio (HTTPS lo pone la plataforma) y la **comprobación de salud** en `/api/salud`.
7. Activa las **copias automáticas** de la base en el panel de la plataforma y confirma cuántos días guarda.

---
## Servicios recomendados (gratis o muy económicos)
* **Cloudflare** delante del dominio: DNS, certificado, protección contra ataques y reglas de límite de peticiones.
* **UptimeRobot**: monitor sobre `https://tu-dominio/api/salud`; te avisa por correo/Telegram si el sistema se cae.
* **Sentry** (opcional): registro de errores del servidor.

## Variables de entorno
Todas están documentadas dentro de `.env.example`.

## Lista de verificación antes de lanzar
- [ ] HTTPS funcionando y `NODE_ENV=production`
- [ ] `JWT_SECRET` aleatorio de 48+ bytes, y el `.env` NO está en GitHub
- [ ] El servidor usa el usuario `fercho_app` (no `postgres`/administrador)
- [ ] La base de datos NO es accesible desde internet
- [ ] Verificación en dos pasos activa en el administrador (y códigos de recuperación guardados en papel)
- [ ] Contraseñas reales para caja y cocina (una cuenta por persona); cuentas de prueba desactivadas
- [ ] Copia de seguridad diaria programada, copiada fuera del servidor, y **restauración probada** (`scripts/probar-backup.sh`)
- [ ] Monitoreo en `/api/salud` con aviso al celular
- [ ] Datos de prueba borrados (`scripts/limpiar-pruebas.js`), stock real cargado
- [ ] QR generados desde el dominio definitivo, impresos y probados con un celular de un cliente (no el tuyo)
- [ ] Aviso de privacidad visible (se guardan teléfonos y direcciones) y plan para borrar datos antiguos
- [ ] Probado un turno completo: apertura, pedidos de mesa y domicilio, Nequi, cierre
- [ ] Plan B por si falla el internet o el sistema (pedidos en papel, datos móviles de respaldo)


## Novedades v7 (importante al desplegar)

- El sistema crea/actualiza las tablas solo al arrancar (incluye `migracion_04_pos.sql`).
- **Los clientes solo pueden pedir cuando la caja está abierta.** Abre la caja cada día antes de abrir el local.
- Variables opcionales: `COCINA_META_MIN=10` y `COCINA_ALERTA_MIN=15` (minutos para los colores del cronómetro de cocina).
- Para reiniciar la numeración no hay que hacer nada: al cerrar la caja y abrir la siguiente, los pedidos empiezan en #1.
- Después de las pruebas, usa `node --env-file=.env scripts/limpiar-pruebas.js` para empezar en limpio.
