# Versión 8 · Qué cambió y cómo actualizar

## Cómo actualizar (sin perder datos)
1. Hazlo **fuera del horario de atención**, con la caja **cerrada** y sin pedidos pendientes.
2. Sube a GitHub los archivos de este paquete (reemplazan a los anteriores; **no subas `.env` ni claves**).
3. Render se actualiza solo y aplica la migración de la base (`db/migracion_06_v8.sql`) una sola vez.
4. Entra como administrador → **Carta** → botón **«Cargar la carta de Fercho»**. Te pregunta si quitas los platos de ejemplo. Aceptar = deja solo la carta real (120 productos, promociones y almuerzos de fin de semana).
5. Revisa en **Carta → Detalles** las zonas de cada plato y en **Inventario** carga insumos, presentaciones y recetas en gramos.

## Cocina por zonas
- Zonas **Plancha** y **Asador** ya creadas. En **Ajustes** puedes crear, renombrar, cambiar el color o desactivar zonas.
- Cada plato se asigna a una o varias zonas con su «parte» (Carta → Detalles).
- Cada tablet elige su zona en **Cocina** (queda guardada en esa tablet) y ve solo sus tareas, más el estado de las otras zonas.
- El pedido queda **listo** solo cuando todas las zonas terminan. Si una zona termina y otra tarda, su tarjeta se resalta pasado el tiempo configurado.
- **Despacho (armar)**: interruptor en Ajustes. Encendido: al terminar las zonas alguien arma el pedido y lo marca «armado». La pantalla de despacho también se puede mostrar u ocultar.

## Pedidos
- Se pueden **editar** solo antes de que cocina empiece (cliente: antes de que caja confirme).
- Si ya está en cocina, «Pedir algo más» crea un **pedido complemento** ligado al original, al final de la fila; en caja se pueden **juntar cuentas**.
- Cancelar en preparación: solo el **administrador**, con motivo obligatorio; queda como desperdicio y avisa.
- **Caja**: ver pedidos, confirmar, entregar y cobrar; ve el estado por zona en solo lectura.
- **Facturas**: cada cobro genera un comprobante interno **inmutable** (numeración sin saltos). Búsqueda por semana, número, mesa, teléfono o nombre, y reimpresión. *No es factura electrónica DIAN.*

## Inventario y contabilidad
- Unidad base (g, ml, u), **presentaciones** (bulto, canastilla), **merma %**, peso por unidad y **costo promedio ponderado**.
- Las compras de inventario son **gastos de inversión**: no afectan la utilidad del día ni (si son de otra fuente) la caja. Se ven desde el resumen semanal; hay un interruptor para verlas en el diario.
- Vista **Utilidad** (por defecto, sin contar dos veces) y vista **Flujo de caja**.
- Si una compra se paga con dinero del cajón, se registra como retiro de caja para que el cierre cuadre.
- **Conteos físicos**: la pestaña «Conteos y diferencias» compara lo teórico con lo real.
- Precios, costos y cantidades están **bloqueados hasta pulsar «Editar»**; cada cambio queda en la bitácora (quién, antes, después, cuándo).

## Caja
- Punto de venta en 3 columnas (pedido actual / menú rápido / resumen de pago), números grandes, atajos `/` buscar · `F2` enviar a cocina · `F4` cobrar.
- Agregar base/ingreso y retiros de efectivo; el administrador recibe alerta de cada uno.

## Promociones y diseño
- Las promociones se crean como un plato (opcionalmente armado con otros platos), con fecha de inicio y fin.
- **Barra de promociones** y **carrusel de imágenes** en la página del cliente; el administrador los enciende o apaga (Ajustes) y publica anuncios con imagen.
- Nuevo diseño con los colores y el logo de la marca (los colores están en `public/css/marca.css`, variables `:root`).

## Decisiones que tomé (dime si quieres cambiarlas)
- **No** incluí *descuentos* ni *pago con tarjeta* (necesitan permisos, motivo y auditoría; lo hacemos si lo confirman).
- Los jugos con dos precios en la carta se cargaron como «precio 1 / opción 2»: ajústalos en Carta.
- Las zonas por defecto salen de la carta (carnes/pollo/perros → Plancha; pinchos y carnes al carbón → Asador); revísalas en Detalles.

---
# Versión 8.1 · Domicilios, imágenes y pedido sin salirse

## Para el cliente
- **Promociones**: al tocar una imagen del carrusel se abre ampliada, con el botón «Pedir esta promo». Se cierra tocando fuera.
- **Fotos de los platos** más grandes en la carta; al abrir un plato la foto ocupa el ancho y se puede tocar para verla completa.
- **Ventana del pedido**: sección «¿Algo más?» con buscador y categorías para agregar productos sin salir; cantidades con + / − y «Quitar algo / nota» en cada línea.

## Domicilios (Ajustes → Domicilios)
El dueño elige una de tres formas:
1. **Sin cobro** (el valor se acuerda con el cliente).
2. **Tarifa fija**: un solo valor para todos.
3. **Por kilómetro**: valor mínimo que cubre X km + valor por cada km adicional, con cobertura máxima opcional. Redondea hacia arriba a $500.

En cualquier forma, **el personal puede cambiar el valor de un pedido** desde Caja («Cambiar valor») o escribirlo al crear el pedido.

- El cliente marca su ubicación con **«Usar mi ubicación»** (GPS del celular) o **«Marcar en el mapa»** (arrastra el pin). En modo por kilómetro es obligatoria.
- Además escribe la dirección y un campo de **barrio / punto de referencia**.
- En Caja cada domicilio tiene **«Abrir en Maps»**: abre Google Maps en el punto exacto para el domiciliario (si el cliente no marcó ubicación, busca la dirección escrita en Bucaramanga).
- Para el modo por kilómetro hay que **marcar la ubicación del local** (Ajustes → Domicilios). «Probar tarifa en un punto» permite revisar los valores antes de usarlos.
- La distancia es una **estimación**: línea recta × factor de ruta (1,3 por defecto, ajustable). No usa servicios de pago ni claves.
- El domicilio se suma al total, aparece en la factura y en Contabilidad como «Domicilios cobrados» (está incluido en ventas; si ese dinero es del domiciliario, regístralo como retiro/gasto al entregárselo).
- Un pedido complemento de un domicilio no cobra un segundo domicilio.

## Actualizar
Igual que la versión 8: subir archivos a GitHub; Render aplica sola `db/migracion_07_domicilio.sql`. Archivos nuevos: `src/domicilio.js`, `public/js/ubicacion.js`, `public/vendor/leaflet/`.

## 8.1.1 · Revisión de interfaces
- En Inventario y Carta, al pulsar «Editar» ya no se esconden botones: los botones bajan de línea y, en tablets y celulares, cada producto se muestra como tarjeta.
- Las pestañas y los filtros bajan de línea en vez de quedar ocultos; las tablas de solo lectura muestran su barra de desplazamiento.
- El menú de ejemplo ahora trae zonas de cocina asignadas (pinchos → Asador, el resto → Plancha).

## 8.2 · Banners publicitarios y cierre del seguimiento
- **Banners publicitarios** arriba del buscador del menú (interruptor en Ajustes → «Banners publicitarios»). Muestran tus anuncios con imagen y, automáticamente, las promociones activas. Se deslizan solos cada 5 s, tienen flechas ‹ ›, botón de pausa, puntos para saltar, «Ver todas» (lista completa para explorar) y ✕ para ocultarlos. Se pausan al pasar el mouse o tocar. Al tocar un banner se amplía y ofrece «Pedir».
- **Seguimiento del cliente**: cuando el pedido está entregado y cobrado aparece el botón «Cerrar»; además se borra solo a los 10 minutos. Si aún no está cobrado, se mantiene visible.

## 8.3 · Cobro en pantalla grande y panel de caja
- **«Cobrar»** en la lista de pedidos abre la pantalla de tres columnas: a la izquierda el pedido (con «juntar cuentas»), al centro el menú por si el cliente quiere **agregar algo más** (sale a cocina como pedido adicional y se cobra ahí mismo), a la derecha el resumen de pago con billetes, «Exacto», vueltos y el botón Cobrar. Atajos: Enter o F4 cobrar, Esc volver. Al terminar vuelve a la lista de pedidos.
- **Panel de la caja** rediseñado con casillas y números grandes: ventas del turno, base, efectivo, Nequi, ingresos, retiros, efectivo que debe haber y pedidos por cobrar. Botones más grandes para base/ingreso, retiro y cierre.
- El cajero (rol caja) ve base, ingresos, retiros y por cobrar; las ventas y el efectivo esperado solo los ve el administrador, para que el conteo de cierre sea a ciegas.

## 8.4 · Cierre de caja y montos con puntos
- **Montos en pesos con puntos de miles** mientras se escribe (100000 se ve 100.000): apertura de caja, dinero recibido, ingresos y retiros, valor del domicilio, gastos, compras, precios de la carta y tarifas de domicilio.
- **Cierre de caja** rediseñado: cada billete ($100.000 a $1.000) con botones − / + y su subtotal, monedas aparte, y el total contado en grande.
- El cajero sigue sin ver las ventas ni el efectivo esperado (solo el administrador), para que el conteo sea a ciegas.
- **Cierre de caja con dos formas de contar**: «Contar por billetes» o «Escribir el total» (un solo valor). El sistema recuerda la última forma usada en ese equipo.

## 8.5 · Opciones dentro de un plato (presentaciones, tamaños, guarniciones, adicionales)
- Un plato puede tener **grupos de opciones** con precio extra. Ej.: «Pincho solo pollo» → Guarnición: papas al vapor ($0) / papas a la francesa (+$5.000). El cliente ve una sola tarjeta («Desde $9.000»), elige y el precio se actualiza.
- Cada grupo puede ser **obligatorio** (hay que elegir) u opcional, y permitir **una** o **varias** opciones (sirve para adicionales: tocineta extra, queso extra…).
- Cada opción puede tener su **zona de cocina** (las papas a la francesa de un pincho le salen a la Plancha) y sus **insumos** (descuenta inventario solo cuando se pide).
- La opción elegida aparece en el pedido, la cocina, la comanda, la factura y los más vendidos. Los cambios de precio de las opciones quedan en la bitácora.
- Se administra en **Carta → botón «Opciones»** de cualquier plato, nuevo o existente. «Copiar las opciones de otro plato» ahorra trabajo.
- **Carta de Fercho**: con/sin papa (hamburguesas, perros, desgranados), guarnición de los pinchos y tamaño de naranjadas y Hit personal ahora son UN plato con opciones (102 productos en vez de 120). Si ya la habías cargado, vuelve a pulsar «Cargar la carta de Fercho» aceptando reemplazar.
- Archivo nuevo de base de datos: `db/migracion_08_opciones.sql` (se aplica sola).

## 8.6 · Otro cobro (algo que no está en la carta)
- En la pantalla de venta y en la de cobro hay un botón **«➕ Otro cobro (bolsa, envase…)»**: se escribe qué se cobra, el valor de cada uno y la cantidad. Hay accesos rápidos (Bolsa, Portacomidas, Envase, Desechables, Vaso).
- Queda como una línea más del pedido, resaltada como «Cobro adicional», y sale en la factura con su descripción, cantidad y valor.
- **Solo la caja y el administrador** pueden usarlo; el servidor rechaza cualquier intento desde la página del cliente.
- No va a cocina ni descuenta inventario. Suma a las ventas.
- Archivo nuevo de base de datos: `db/migracion_09_cobro_libre.sql` (se aplica sola).

---
# Versión 9 · Cocina con comandas impresas por zona (alternativa a las pantallas)

Es el **mismo proyecto** con un interruptor: **Ajustes → Forma de trabajo de la cocina** → «Pantallas por zona» o «Comandas impresas por zona». Se puede cambiar en cualquier momento (cuando no haya pedidos en cocina), sin reinstalar ni perder datos.

## Cómo funciona con comandas impresas
- Al **confirmar** un pedido (o al crearlo desde caja) se genera **una comanda por cada zona** que participa. Cada comanda trae solo lo que hace esa zona, en letra grande: zona, número de pedido, mesa/domicilio/mostrador, hora, productos con sus opciones, «SIN…», notas, y «También preparan: …» para coordinar con las otras zonas.
- El pedido pasa de una vez a **en preparación** (el inventario se descuenta ahí). Ya no se puede editar: lo adicional sale como **complemento** con su propia comanda marcada «COMPLEMENTO DEL #N».
- Si el administrador **cancela** un pedido en preparación, a las zonas les sale una comanda **ANULADO** con el motivo.
- Los pedidos sin nada de cocina (solo bebidas) no imprimen y quedan listos.
- **La caja marca «✔ Ya está listo»** cuando cocina entrega el pedido, y luego «Entregar» y «Cobrar» como siempre. El cliente sigue viendo el avance en su celular.
- Caja tiene **«Reimprimir en cocina»** por pedido y un **aviso rojo** si alguna comanda lleva más de 40 s sin imprimirse (impresora apagada o sin papel). Las comandas no se pierden: quedan en cola.

## Cómo se imprimen (ver `impresion/LEEME.md`)
- **Opción A (sin instalar nada):** un equipo por impresora con Chrome en modo `--kiosk-printing`, pestaña **Comandas**, zona elegida e «Imprimir automáticamente». Con «TODAS», una sola impresora saca las de todas las zonas.
- **Opción B (impresoras de red):** el programa `impresion/agente.mjs` en un computador del local envía cada comanda a la impresora de su zona (ESC/POS, puerto 9100).

## Qué no cambia
Zonas, platos por zona, opciones, pedidos por QR, domicilios, caja, facturas, inventario, contabilidad y promociones funcionan igual en las dos formas. En modo comandas se ocultan las pestañas Cocina y Despacho y aparece **Comandas**.

Archivo nuevo de base de datos: `db/migracion_10_comandas.sql` (se aplica sola).

## 9.1 · Rendimiento (la página responde más rápido)
- El menú del cliente se pinta de inmediato; antes esperaba una consulta de sesión que solo sirve al personal.
- Menú, configuración y anuncios se piden **al mismo tiempo** (antes uno tras otro) y el servidor los guarda unos segundos en memoria: menos consultas a la base de datos.
- El mapa y los códigos QR se cargan **solo cuando se usan** (antes en cada visita).
- Menos trabajo gráfico en tablets y celulares modestos: fondo fijo sin repintado al desplazar, sin desenfoque en las ventanas, tarjetas fuera de pantalla no se dibujan.
- Logo y librerías quedan guardados en el navegador. Índice nuevo para la lista de pedidos abiertos (`db/migracion_11_rendimiento.sql`).
