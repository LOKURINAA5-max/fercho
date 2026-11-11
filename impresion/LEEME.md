# Comandas impresas por zona

En **Ajustes → Forma de trabajo de la cocina** elige «Comandas impresas por zona».
Al confirmar un pedido, el sistema crea una comanda por cada zona que participa (Plancha, Asador…). Hay dos formas de que salgan en papel:

## Opción A · Un equipo por impresora (sin instalar nada)
1. Conecta la impresora térmica al equipo (USB o red) y déjala como **impresora predeterminada**.
2. Abre Chrome con `--kiosk-printing` para que imprima sin mostrar la ventana de impresión
   (Windows: clic derecho al acceso directo → Propiedades → al final de «Destino» agrega ` --kiosk-printing`).
3. Entra con un usuario de **cocina**, abre **Comandas**, elige la zona y enciende «Imprimir automáticamente».
4. Deja esa página abierta. Con «TODAS» una sola impresora saca las comandas de todas las zonas.

## Opción B · Impresoras de red con el agente (sin equipos en cocina)
Sirve para impresoras térmicas con cable de red o WiFi (protocolo ESC/POS, puerto 9100: Epson, Xprinter, 3nStar, etc.).
1. Dale a cada impresora una **IP fija** (se configura en la impresora o en el router) y anótala.
2. En el panel crea un usuario de rol **cocina** solo para esto (por ejemplo `impresora`), **sin** verificación en dos pasos.
3. En un computador del local que esté siempre encendido (el de caja sirve) instala Node.js 18 o superior.
4. Copia `config.ejemplo.json` como `config.json` y escribe la dirección del sitio, el usuario, la clave y la IP de cada zona.
   El nombre de cada impresora debe ser igual al de la zona. Con una sola impresora usa `"todas"`.
5. Ejecuta: `node impresion/agente.mjs`. Déjalo abierto; reintenta solo si se cae internet o una impresora.

`config.json` contiene una clave: **no lo subas a GitHub** (ya está en `.gitignore`).

## Si algo falla
- La caja muestra un aviso rojo cuando una comanda lleva más de 40 segundos sin imprimirse (impresora apagada, sin papel o sin conexión).
- Las comandas no se pierden: quedan en cola y salen cuando la impresora vuelve.
- En **Comandas** se ven las de hoy, se pueden imprimir en ese equipo o mandar una copia a la zona.
- Desde Caja, «Reimprimir en cocina» vuelve a mandar las comandas de un pedido.
