# Despliegue con GitHub + Neon + Render

Resultado: el código vive en **GitHub**, la base de datos PostgreSQL en **Neon** y el servidor Node.js en **Render**.
Tiempo estimado: 30–40 minutos. Nada de esto requiere instalar programas en tu computador, salvo el navegador.

```
GitHub (código)  ──── conecta ────▶  Render (servidor)  ──── SSL ────▶  Neon (PostgreSQL)
```

## Antes de empezar
- Cuenta en **github.com**, **neon.com** y **render.com** (puedes entrar con GitHub en las tres).
- Descomprime `fercho-beta-v7.2.zip` y ubica la carpeta `fercho-backend` (la que contiene `package.json`, `src`, `db`, `public`, `render.yaml`).
- Dentro de esa carpeta **no debe existir** un archivo `.env` ni la carpeta `node_modules`. (El `.gitignore` ya los protege.)
- Anota en papel: usuario y clave de administrador que quieras usar (la clave: mínimo 10 caracteres, con letras y números).

---

## Paso 1 · Subir el proyecto a GitHub
1. En GitHub: **New repository** → nombre `fercho` → **Public** si la profesora lo va a abrir sin cuenta, o **Private** y le das acceso desde *Settings → Collaborators* → Create.
2. En la página del repositorio vacío pulsa **uploading an existing file**.
3. Arrastra **el contenido** de `fercho-backend` (las carpetas `src`, `db`, `public`, `scripts`, `docs` y los archivos sueltos como `package.json`, `render.yaml`, `README.md`), **no** la carpeta `fercho-backend` completa.
4. Pulsa **Commit changes**.
5. Comprueba que en la raíz del repositorio se vean `package.json` y `render.yaml`, y que **no** aparezca `.env`.

> Nunca subas el archivo `.env`: contiene claves.

## Paso 2 · Crear la base de datos en Neon
1. En Neon: **Create project**. Nombre `fercho`. Elige la versión más reciente de PostgreSQL y una región cercana a Colombia (por ejemplo **AWS US East (N. Virginia)**).
2. Cuando se cree, pulsa **Connect** (arriba a la derecha).
3. En la ventana, **desactiva** la opción **Connection pooling** (así obtienes la conexión directa).
4. Copia la cadena que aparece. Se parece a:
   ```
   postgresql://neondb_owner:XXXXXXXX@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Cambia al final `sslmode=require` por `sslmode=verify-full` (es lo mismo en la práctica y evita una advertencia). Si aparece `&channel_binding=require`, puedes dejarlo o quitarlo.
6. Guárdala: la vas a pegar en Render. **No la subas a GitHub ni la pegues en chats.**

No crees tablas a mano: el sistema las crea solo la primera vez que arranca.

## Paso 3 · Crear el servidor en Render
**Opción A (recomendada): con el archivo `render.yaml`**
1. En Render: **New +** → **Blueprint**.
2. Conecta tu cuenta de GitHub y elige el repositorio `fercho`.
3. Render lee `render.yaml` y te pide los valores que no están en el archivo:
   - `DATABASE_URL`: pega la cadena de Neon del paso 2.
   - `ADMIN_USUARIO`: por ejemplo `juan` (solo minúsculas y números).
   - `ADMIN_CLAVE`: tu clave temporal (mín. 10 caracteres, con letras y números).
4. Pulsa **Apply** / **Deploy Blueprint**.

**Opción B: a mano**
1. **New +** → **Web Service** → elige el repositorio.
2. Configura: Runtime **Node**, Build Command `npm install`, Start Command `node src/server.js`, Health Check Path `/api/salud`, plan **Free**.
3. Agrega estas variables de entorno:

| Variable | Valor |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `DATABASE_SSL` | `true` |
| `DATABASE_URL` | la cadena de Neon |
| `JWT_SECRET` | texto largo aleatorio (genera uno con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `EXIGIR_2FA` | `admin` |
| `ADMIN_USUARIO` | tu usuario administrador |
| `ADMIN_CLAVE` | tu clave temporal |
| `CARGAR_CATALOGO_EJEMPLO` | `true` |

## Paso 4 · Verificar que arrancó
1. En Render abre la pestaña **Logs**. Espera a ver, en este orden:
   - `[arranque] Base de datos vacía: creando las tablas...`
   - `[arranque] Menú de ejemplo cargado`
   - `[arranque] Administrador "juan" creado`
   - `Fercho API lista en el puerto ...`
2. Abre la dirección `https://fercho-xxxx.onrender.com` que muestra Render. Debe cargar el menú (aparecerá **Cerrado** hasta que se abra la caja).
3. Prueba `https://fercho-xxxx.onrender.com/api/salud`: debe responder `{"estado":"ok"}`.

## Paso 5 · Primer ingreso y seguridad
1. Pulsa **Personal** e ingresa con tu usuario y `ADMIN_CLAVE`.
2. Como el administrador exige verificación en dos pasos, escanea el QR con Google Authenticator o Microsoft Authenticator y escribe el código. **Anota en papel los 8 códigos de recuperación.**
3. En Render → **Environment**, **borra `ADMIN_CLAVE`** y guarda (el servicio se reinicia solo).
4. En la pestaña **Usuarios** crea una cuenta de caja y otra de cocina.

## Paso 6 · Mostrarle el sistema a la profesora
**Antes de la revisión (5 minutos antes):**
- Abre la dirección de Render para **despertar el servidor** (el plan gratuito se duerme tras ~15 minutos sin visitas y tarda en despertar alrededor de un minuto).
- Abre un pedido de prueba de principio a fin para comprobar que todo responde.

**Recorrido sugerido:**
1. **GitHub:** el repositorio, el `README.md` con el diagrama entidad-relación y el historial de archivos.
2. **Neon:** *Tables* o *SQL Editor* con la base `neondb`: aquí se ve que **los datos viven en Neon**. Consultas útiles para mostrar:
   ```sql
   SELECT numero_dia, tipo, estado, total, metodo_pago FROM pedidos ORDER BY creado_en DESC LIMIT 10;
   SELECT nombre, precio, categoria FROM platos ORDER BY orden, id;
   SELECT fecha, categoria, monto FROM gastos ORDER BY id DESC;
   ```
3. **Render:** el servicio en ejecución, sus **Logs** y las variables de entorno.
4. **La aplicación:** abrir caja → pedir desde el celular → confirmar → cocina con cronómetro → cobrar con vueltos → cerrar caja → contabilidad.

## Detalles del plan gratuito (importante)
| Cosa | Qué pasa | Qué hacer |
|---|---|---|
| Render gratis se duerme | La primera visita tras ~15 min de inactividad tarda cerca de un minuto | Abrir la página antes de la revisión. Para mantenerlo despierto puedes usar un monitor gratuito (UptimeRobot) sobre `/api/salud` cada 5 minutos |
| Neon gratis "se suspende" | Tras unos minutos sin uso la base se duerme y despierta sola en el primer acceso (puede tardar un par de segundos) | Nada: el sistema ya espera hasta 10 s la conexión |
| Fotos | Se guardan **dentro de la base** (límite 300 KB cada una), así que no se pierden cuando Render reinicia | Subirlas desde Inventario |
| Límites de los planes | Los planes y cuotas gratuitas cambian | Revísalos en las páginas de precios de Render y Neon |

**Para el restaurante real:** pasa el servicio de Render a un plan de pago (no se duerme) y confirma en Neon el plan y la retención de copias de la base. Lee `DESPLIEGUE_PRODUCCION.md`.

## Actualizar el sistema después
1. En GitHub, sube los archivos nuevos (o usa Git) y haz **Commit**.
2. Render despliega solo si el despliegue automático está activo; si no, **Manual Deploy → Deploy latest commit**.
3. Las tablas se actualizan solas al arrancar.

## Si algo falla
| Síntoma | Causa probable |
|---|---|
| El despliegue falla en `npm install` | El `package.json` no está en la raíz del repositorio: subiste la carpeta completa en lugar de su contenido |
| `Falta DATABASE_URL en el .env` | No se pegó `DATABASE_URL` en las variables de Render |
| `password authentication failed` | La cadena de Neon se copió incompleta o con una contraseña vieja (en Neon: *Reset password* y copia de nuevo) |
| `The server does not support SSL connections` o `SSL` | Falta `?sslmode=verify-full` al final de la cadena |
| `JWT_SECRET debe tener...` | Falta o es muy corto: con el Blueprint lo genera Render |
| `ADMIN_CLAVE debe tener mínimo 10 caracteres` | La clave temporal es corta o no mezcla letras y números |
| "Credenciales incorrectas" al entrar | La base ya tenía usuarios (el administrador solo se crea con la base vacía). Usa `node --env-file=.env scripts/crear-usuario.js usuario "Clave123456" admin` con la cadena de Neon en un `.env` local |
| La página carga muy lento la primera vez | El servidor gratuito estaba dormido |
| Dice "El local está cerrado" | Es normal: caja debe abrir el turno para que los clientes pidan |
