# Despliegue paso a paso · Fercho

Ruta recomendada para tu primer lanzamiento: **GitHub + Render (servicio web + base PostgreSQL) + dominio**.

> Para la salida a producción con dominio, alta disponibilidad, copias, monitoreo, plan B y guion de demo, lee también **`DESPLIEGUE_PRODUCCION.md`**.
No necesitas terminal en el servidor: el sistema crea las tablas y tu administrador solo la primera vez que arranca.

> Aclaración: tu plan Pro de Claude no incluye servidor. El hosting es un servicio aparte, que se paga a su proveedor.
> Los precios y límites cambian: **revisa los planes vigentes antes de pagar** (en especial: disco persistente, y cuánto dura la base gratuita).

## Lo que necesitas antes (30 min)
- [ ] Cuenta en **GitHub** (github.com) y **Render** (render.com), ambas con tu correo
- [ ] Un **dominio** (opcional al inicio; imprime los QR solo cuando tengas el definitivo)
- [ ] Una **app de autenticación** en tu celular (Google Authenticator o Microsoft Authenticator)
- [ ] Un **gestor de claves** o un papel guardado: aquí anotarás contraseñas y códigos de recuperación

## Fase 1 · Subir el proyecto a GitHub
1. En GitHub: **New repository** → nombre `fercho` → **Private** → *Create*.
2. Descomprime `fercho-beta-v7.zip`. Verifica que dentro de `fercho-backend` **NO** exista un archivo `.env`.
3. En la página del repositorio vacío, pulsa **uploading an existing file** y arrastra **el contenido** de `fercho-backend`
   (no la carpeta). Confirma que se vean `src`, `db`, `public`, `package.json`… → **Commit changes**.

## Fase 2 · Crear la base de datos en Render
1. Render → **New +** → **PostgreSQL**. Nombre `fercho-db`, región cercana a Colombia (la más próxima disponible).
2. Elige el plan. Un plan de pago con copias automáticas es lo recomendable para clientes reales; el gratuito sirve solo para probar.
3. *Create Database*. Cuando esté lista, copia **Internal Database URL** (la usarás en la Fase 3).

## Fase 3 · Crear el servicio web
1. Render → **New +** → **Web Service** → conecta tu repositorio `fercho`.
2. Configura:
   - **Runtime:** Node · **Build Command:** `npm install` · **Start Command:** `node src/server.js`
   - **Health Check Path:** `/api/salud`
3. En **Environment** agrega estas variables:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `DATABASE_SSL` | `true` |
| `DATABASE_URL` | la *Internal Database URL* de la Fase 2 |
| `JWT_SECRET` | 48+ caracteres aleatorios (genéralos en tu computador: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `EXIGIR_2FA` | `admin` |
| `ADMIN_USUARIO` | tu usuario (ej. `dueno`) |
| `ADMIN_CLAVE` | clave de 10+ caracteres con letras y números (**temporal**) |
| `CARGAR_CATALOGO_EJEMPLO` | `false` si ya quieres empezar con tu menú vacío |
| `NEQUI_NUMERO` / `NEQUI_NOMBRE` | solo si usarás Nequi |

4. **Fotos:** desde la v7.2 se guardan dentro de la base de datos, así que **no necesitas disco ni `UPLOADS_DIR`**.
5. **Create Web Service**. En *Logs* debes ver `[arranque] Base de datos vacía: creando las tablas...`,
   `Administrador "dueno" creado` y `Fercho API lista`.

## Fase 4 · Primer ingreso y seguridad
1. Abre la URL que te da Render (`https://fercho-xxxx.onrender.com`). Entra con **Personal** → tu usuario y `ADMIN_CLAVE`.
2. El sistema te obliga a **activar la verificación en dos pasos**: escanea el QR con tu app y escribe el código.
   **Anota los 8 códigos de recuperación en papel.** No se vuelven a mostrar.
3. Vuelve a Render → Environment → **borra `ADMIN_CLAVE`** y guarda (se reinicia solo). Luego cambia tu clave en el botón 🔑.
4. En **Usuarios** crea una cuenta por persona (caja y cocina), con clave propia.

## Fase 5 · Tu negocio real
1. **Inventario:** crea tus insumos con el stock real (usa "Conteo" para ajustar).
2. **Platos:** crea el menú con precios, foto y receta (cuánto insumo gasta cada plato).
3. Si cargaste el menú de ejemplo, desactívalo o ajústalo (precios, "agotado").
4. Prueba un turno completo con tu propio celular: abrir caja → pedido por QR → confirmar → cocina → cobrar → cerrar caja.
5. Borra los datos de prueba (los pedidos de prueba cuentan en los reportes). Desde tu computador, con la URL externa de la base:
   `node --env-file=.env scripts/limpiar-pruebas.js --confirmar --forzar`

## Fase 6 · Dominio y QR
1. Compra o usa un dominio y en Render → *Settings → Custom Domains* agrégalo. Sigue las instrucciones DNS que te muestra; el HTTPS se activa solo.
2. Con el dominio funcionando, entra como admin → **QR** y genera los códigos **desde esa dirección**. Imprímelos.
3. Prueba escanear uno con **un celular que no sea el tuyo**.

## Fase 7 · Protección de la base (antes de recibir clientes)
Desde tu computador, con el proyecto y un `.env` local que tenga `DATABASE_URL_ADMIN` = *External Database URL* de Render:
1. `node --env-file=.env scripts/crear-usuario-bd.js` → imprime una `DATABASE_URL` de **permisos mínimos**.
2. En Render, reemplaza `DATABASE_URL` por esa nueva, y agrega `DATABASE_URL_ADMIN` con la URL de administrador (solo se usa al arrancar para migraciones).
3. Confirma en *Logs* que el sistema arrancó sin errores.

## Fase 8 · Vigilancia y respaldo
- [ ] **UptimeRobot** (gratis): monitor HTTP sobre `https://tu-dominio/api/salud`, con aviso a tu correo/celular.
- [ ] **Copias de seguridad** automáticas de la base activadas en Render, y anota cuántos días guardan.
- [ ] **Una copia propia mensual:** `scripts/backup.sh` con la URL externa, guardada fuera del servidor.
- [ ] **Prueba de restauración** al menos una vez (`scripts/probar-backup.sh`). Una copia que nunca se probó no cuenta.

## Fase 9 · Lista de verificación final
- [ ] HTTPS activo y `NODE_ENV=production`
- [ ] `ADMIN_CLAVE` borrada del servidor; 2FA activo; códigos de recuperación en papel
- [ ] El servidor usa el usuario de base de permisos mínimos
- [ ] Cuentas por persona; cuentas de prueba desactivadas
- [ ] Datos de prueba borrados y stock real cargado
- [ ] Monitoreo y copias funcionando
- [ ] QR generados desde el dominio definitivo y probados
- [ ] Aviso de privacidad visible (guardas teléfonos y direcciones)
- [ ] Plan B: pedidos en papel y datos móviles si falla el internet
- [ ] Lanzamiento suave: una semana con clientes conocidos, un turno al día, y tú presente

## Si algo falla
| Síntoma | Causa probable |
|---|---|
| El servicio no arranca, logs dicen `JWT_SECRET debe tener al menos 32...` | Falta o es corto |
| `no pg_hba.conf entry` o `SSL` | Falta `DATABASE_SSL=true` |
| `ADMIN_CLAVE debe tener mínimo 10...` | Clave débil; corrígela en Environment |
| No puedes iniciar sesión por HTTP | Con `NODE_ENV=production` solo funciona por HTTPS |
| Las fotos desaparecen | Usas una versión anterior a la v7.2 (guardaba fotos en disco) |
| El primer acceso tarda mucho | Planes gratuitos "duermen" el servicio; los clientes lo notarían: usa un plan siempre activo |
| Perdiste el celular del 2FA | Usa un código de recuperación; si no, otro admin lo restablece desde Usuarios |

## Alternativa: servidor propio (VPS)
Si prefieres más control y menor costo mensual, sigue la **Opción A** de `DESPLIEGUE.md` (Docker + HTTPS automático).


## Novedades v7 (importante al desplegar)

- El sistema crea/actualiza las tablas solo al arrancar (incluye `migracion_04_pos.sql`).
- **Los clientes solo pueden pedir cuando la caja está abierta.** Abre la caja cada día antes de abrir el local.
- Variables opcionales: `COCINA_META_MIN=10` y `COCINA_ALERTA_MIN=15` (minutos para los colores del cronómetro de cocina).
- Para reiniciar la numeración no hay que hacer nada: al cerrar la caja y abrir la siguiente, los pedidos empiezan en #1.
- Después de las pruebas, usa `node --env-file=.env scripts/limpiar-pruebas.js` para empezar en limpio.
