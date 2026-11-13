# Producción con dominio · Fercho (demo al empresario y clientes reales)

Esta guía complementa a `DESPLIEGUE_PASO_A_PASO.md` (que explica cada clic en Render). Aquí está **lo que decide si el sistema se cae o no**.

## 1. Qué se puede prometer (y qué no)

Ningún sistema en internet garantiza 0 caídas. Un objetivo realista y honesto para un restaurante es:

- **Servidor y base siempre encendidos**, con reinicio automático si algo falla (segundos de corte, no horas).
- **Datos protegidos:** copias automáticas + una copia propia fuera del proveedor.
- **Plan B para el momento en que falle el internet del local** (no depende del software).

Lo que **no** cubre esta versión: modo sin internet (si el local se queda sin conexión, las pantallas no actualizan) ni varios servidores en paralelo.

## 2. Arquitectura recomendada

```
Cliente (celular, QR) ─┐
Caja / Cocina (tablet) ─┼─▶ https://tu-dominio ─▶ Render Web Service (1 instancia, siempre activa)
Administrador          ─┘                              │
                                                       ├─▶ Render PostgreSQL (plan de pago, con copias)
```

| Pieza | Qué elegir | Por qué |
|---|---|---|
| Servicio web | Plan **de pago** (nunca el gratuito) | El gratuito se duerme tras un rato sin visitas: el primer cliente esperaría mucho. En Render el plan más pequeño de pago es `0.5c-512mb`; `1c-2g` da más holgura. El sistema usa ~90 MB, cualquiera de los dos alcanza. |
| Base de datos | Plan **de pago** de Render Postgres | Los planes gratuitos no tienen recuperación ni copias. |
| Fotos | Nada que contratar (desde v7.2) | Las fotos del menú se guardan dentro de la base de datos; ya no hace falta disco. |
| Región | La más cercana a Colombia que ofrezca Render, **la misma** para web y base | Menos latencia entre ambos. |

> Los precios y planes cambian: confírmalos en la página de precios de Render el día que contrates.

### Dos reglas que salen de la documentación de Render
1. **Desde la v7.2 no se usa disco**, así que Render puede hacer despliegues sin corte. Aun así, despliega **fuera del horario de atención** y con una copia reciente.
2. **Una sola instancia:** los avisos en tiempo real (SSE) viven en la memoria del servidor. Es suficiente para un restaurante (ver sección 4), pero crecer "horizontalmente" requeriría un cambio de diseño.

## 3. Dominio y HTTPS

1. Compra el dominio (por ejemplo en Namecheap, GoDaddy o un registrador `.co`).
2. Render → tu servicio → **Settings → Custom Domains → Add**. Agrega `www.tudominio.co` y, si quieres, el dominio sin `www`.
3. En el panel DNS del registrador crea **exactamente** los registros que Render te muestra (normalmente un `CNAME` para `www` y un registro `A`/`ALIAS` para el dominio raíz).
4. Espera a que Render marque el dominio como verificado; el certificado HTTPS se emite solo.
5. Entra como admin → **QR** y genera los códigos **ya desde el dominio definitivo**. Imprímelos solo después.
6. Prueba escaneando con un celular que no sea el tuyo y con datos móviles (no con el WiFi del local).

Variables que deben estar (ya explicadas en la guía paso a paso): `NODE_ENV=production`, `TRUST_PROXY=1`, `DATABASE_SSL=true`, `JWT_SECRET` largo, `EXIGIR_2FA=admin`, y **sin** `ADMIN_CLAVE` después del primer ingreso.

## 4. Cuánto aguanta (medido)

Prueba de carga en el entorno de desarrollo (2 núcleos, no en Render, así que son cifras orientativas):

| Prueba | Resultado |
|---|---|
| 100 clientes viendo el menú a la vez | ~1.300 peticiones/s, latencia media 77 ms, 0 errores |
| 100 conexiones consultando el estado del local | ~2.500 peticiones/s, 0 errores |
| 30 clientes creando pedidos a la vez (con transacción) | ~285 pedidos/s, 0 errores, **numeración sin repetidos** |
| Memoria del servidor tras la prueba | ~87 MB |

Un restaurante pequeño o mediano recibe, en su pico, unos pocos pedidos por minuto: el sistema tiene **cientos de veces** de margen. El cuello de botella real no es el software sino el internet del local y el celular del cliente.

Protecciones que ya trae: límite de 120 pedidos cada 10 min por red (el WiFi del local cuenta como una sola red; sube `LIMITE_PEDIDOS_10MIN` si lo necesitas), 5 intentos de clave y bloqueo, conexión a la base con tiempo máximo por consulta (15 s), cierre ordenado al reiniciar, y manejo de errores que evita que un fallo suelto apague el sistema.

## 5. Copias de seguridad (qué hay y qué falta)

| Capa | Qué ofrece | Lo que debes hacer |
|---|---|---|
| Render Postgres | Recuperación a un momento exacto: 3 días en workspace Hobby, 7 en Pro; copias lógicas guardadas 7 días (solo planes de pago) | Confirma en tu panel cuántos días tienes realmente. |
| Fotos | Van dentro de la base | Quedan cubiertas por las mismas copias de la base. |
| **Copia propia** | `scripts/backup.sh` | Cada semana (o a diario con cron en tu PC): descarga una copia con la URL externa de la base y guárdala **fuera de Render** (Drive, disco externo). |

Haz **una prueba de restauración** (`scripts/probar-backup.sh`) antes del lanzamiento.

## 6. Vigilancia

- **UptimeRobot** (gratis): monitor HTTP a `https://tu-dominio/api/salud` cada 5 minutos, con aviso al correo y al celular. Ese endpoint también consulta la base: si responde `ok`, todo el sistema está vivo.
- En Render, activa los avisos de fallo de despliegue y de reinicio al correo.
- Revisa los **Logs** de Render los primeros días: el sistema registra cada petición y cada error.

## 7. Plan B si se cae el internet del local (imprímelo y pégalo en la caja)

1. Las pantallas de caja y cocina muestran una barra roja: **"Sin conexión con el servidor"**.
2. Cambia a **datos móviles**: comparte internet desde el celular del dueño (zona WiFi) a la tablet de caja y cocina.
3. Si tampoco hay: **comandas en papel** (número, mesa, productos, total). Cobra normal y anota.
4. Al volver la conexión, registra los pedidos que quedaron en papel. Como la caja sigue abierta, el cierre cuadra con lo cobrado.
5. Si el sistema (no el internet) falla: revisa `https://tu-dominio/api/salud`; en Render → *Manual Deploy → Restart*.

## 8. Reglas de operación

- **Nunca despliegues cambios en horario de servicio** (un cambio mal probado puede dejar el local sin sistema).
- Antes de cada despliegue: copia propia de la base.
- Una cuenta por persona; el administrador con 2FA y códigos de recuperación **en papel**.
- Al abrir el local: abrir caja (sin caja abierta los clientes no pueden pedir). Al cerrar: terminar o cancelar todos los pedidos y cerrar caja; los números vuelven a #1 en la siguiente jornada.
- Cuando el dueño pida cambios de precios o platos: se hacen desde el panel, sin tocar el servidor.

## 9. Guion de demo al empresario (15 minutos)

Antes de la reunión: base limpia (`limpiar-pruebas.js`), 8–10 platos reales con precio y foto, insumos con costo, 3 usuarios (admin, caja, cocina), y 3 dispositivos cargados (tu celular como cliente, una tablet o PC para caja y otra para cocina).

1. **Cliente:** escanear QR → elegir mesa → pedir con "sin cebolla" → ver el avance.
2. **Caja:** abrir caja con la base → confirmar el pedido → cobrar en efectivo con billete de $50.000 y mostrar los **vueltos**.
3. **Cocina:** ver el cronómetro, marcar ítems, pasar a listo; mostrar dos pedidos a la vez.
4. **Domicilio y Nequi:** un pedido por cada uno.
5. **Cierre de caja:** contar por denominación, mostrar la diferencia y que el siguiente día empieza en #1.
6. **Administrador:** contabilidad (ventas, gastos, utilidad), platos más vendidos, márgenes, recomendador de stock, alertas en tiempo real y el CSV para el contador.
7. **Seguridad:** 2FA y el historial de accesos.

Después de la demo, **borra los datos de prueba** antes de recibir clientes reales.

## 10. Lista final antes de decir "estamos en producción"

- [ ] Plan de pago en servicio web **y** base; Auto-Deploy en Off
- [ ] Dominio verificado, HTTPS activo, QR generados desde el dominio y probados con datos móviles
- [ ] `ADMIN_CLAVE` eliminada; 2FA activo; códigos de recuperación en papel
- [ ] Usuario de base de permisos mínimos (`crear-usuario-bd.js`)
- [ ] UptimeRobot activo y probado (apaga el servicio un momento y confirma que llega el aviso)
- [ ] Copia propia hecha y restauración probada
- [ ] Menú, precios, costos y recetas reales cargados; datos de prueba borrados
- [ ] Plan B impreso junto a la caja; datos móviles disponibles
- [ ] Lanzamiento suave: una semana con clientes conocidos y alguien presente

## 11. Cuándo habría que rediseñar

Si algún día el negocio tiene varias sedes o cientos de pedidos por minuto, habría que (1) mover las fotos a un almacenamiento de objetos si fueran muchas, (2) pasar los avisos en tiempo real a `LISTEN/NOTIFY` de PostgreSQL para usar varias instancias, y (3) agregar una réplica de la base. Para un restaurante hoy no es necesario.
