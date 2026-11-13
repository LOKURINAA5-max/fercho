# Pinchos la 17 · Cómo ponerlo en línea (proyecto NUEVO, separado de Fercho)

Es el mismo sistema (pedidos por QR, caja, cocina por zonas o comandas impresas, domicilios con mapa,
inventario, contabilidad, 2FA) con la marca, los colores y la carta de **Pinchos la 17**.

> Va en un repositorio, un servicio de Render y una base de Neon **nuevos**. No reutilices los de Fercho:
> cada negocio debe tener sus propios datos, usuarios y claves.

## 1. Base de datos (Neon)
1. Crea un proyecto nuevo en Neon (región cercana a Render). Copia la cadena de conexión.
2. No la pegues en chats ni la subas a GitHub.

## 2. Código (GitHub)
1. Crea un repositorio **privado** nuevo (ej. `pinchos17`).
2. Sube TODO el contenido de esta carpeta. **No subas** `.env` ni `impresion/config.json`.

## 3. Servidor (Render → New → Web Service → el repositorio nuevo)
Variables de entorno (Environment):
| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | la cadena de Neon |
| `DATABASE_SSL` | `true` |
| `JWT_SECRET` | una clave larga nueva (50+ caracteres al azar, distinta de la de Fercho) |
| `ADMIN_USUARIO` | el usuario del dueño, ej. `dueno17` |
| `ADMIN_CLAVE` | mínimo 10 caracteres con letras y números |
| `NEQUI_NUMERO` / `NEQUI_NOMBRE` | los del negocio, si recibe Nequi |
| `NODE_ENV` | `production` |

Al arrancar, el sistema crea solo las tablas y el usuario administrador.
Después del primer ingreso **borra `ADMIN_CLAVE`** en Render.

## 4. Primer día en el sistema
1. Entra como administrador → **Carta** → **«Cargar la carta de Pinchos la 17»**.
   Se cargan 75 productos: 7 pinchos, 5 asados, mute, 5 adicionales, 15 cervezas y 42 bebidas.
2. **Bebidas sin precio:** entran en $0 y **agotadas** (el cliente no las puede pedir).
   Ponles precio con **Editar** y quedan disponibles solas.
3. **Adicionales** ($1.500 c/u: arroz, papa, yuca, guacamole, chorizo de cerdo) aparecen dentro de cada pincho
   y asado como opción (se pueden elegir varios), y también como productos sueltos.
4. Bebidas con sabores (gaseosas, Hit, Mr. Tea, Gatorade, Econolitro, Coca-Cola 400 ml) son un solo producto
   con la opción **Sabor**.
5. Zonas de cocina ya creadas: **Asador** (pinchos, asados, chorizo adicional) y **Cocina** (mute, arroz, papa,
   yuca, guacamole). Las bebidas no pasan por cocina.
6. **Inventario**: crea los insumos (carne, pollo, chunchullo, chorizo, rellena, mazorca, cada bebida…) y la
   receta de cada producto para que descuente existencias.
7. **Ajustes → Domicilios**: marca la ubicación del local (Calle 17 # 25-78) si vas a cobrar por kilómetro.
8. **QR**: imprime el código de cada mesa. **Usuarios**: crea los usuarios de caja y cocina.

## Qué cambió frente al sistema de Fercho
- Marca: nombre, logo, colores (carbón, amarillo con borde rojo, llamas naranja), tipografía, dirección y
  WhatsApp en la portada y en el comprobante.
- Carta nueva (`src/menu-carta.js`); zonas Asador + Cocina; sin menú de ejemplo.
- La carga de la carta ahora admite grupos de opciones opcionales y de varias opciones, y productos sin precio.
- Un producto en $0 y agotado se activa solo al ponerle precio.

## Versión 1.1 · Comandas impresas más legibles, por cable USB o WiFi
- Comanda nueva: zona en blanco sobre negro, número del pedido enorme, «2 x PINCHO MIXTO» en letra doble,
  cada adicional en su propio renglón, «SIN …» resaltado y la nota del cliente en letra alta.
- La Cocina ve para qué plato es cada adicional («3 x ARROZ · Para: Pincho de carne con chunchullo»).
- El agente de impresión maneja impresoras **WiFi / cable de red** (por IP) y **USB** (impresora compartida en Windows)
  al mismo tiempo, con `--prueba`, `--buscar` (encuentra impresoras WiFi) e `--impresoras` (lista las USB).
- `impresion/iniciar-agente.bat` lo deja corriendo y lo reinicia solo. Guía completa: `impresion/LEEME.md`.
- Desde el navegador: selector de papel 80 / 58 mm.
- Solo cambian archivos; no hay migración de base de datos.
