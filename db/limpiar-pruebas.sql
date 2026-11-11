-- =====================================================================================
--  Fercho · BORRAR LOS DATOS DE PRUEBA para empezar en limpio (antes del video o de abrir al público)
--  Cómo usarlo: Neon → tu proyecto → SQL Editor → pega TODO este archivo → Run.
--
--  BORRA: pedidos, comandas, facturas, turnos y movimientos de caja, alertas, gastos,
--         compras e historial del inventario, cambios de precio y registro de ingresos al sistema.
--  CONSERVA: usuarios, carta (platos, opciones, promociones, fotos), recetas, insumos,
--            zonas, anuncios y todos los ajustes.
--  Después: el primer pedido será el #1 y la primera factura la N.º 1.
--  NO se puede deshacer: crea antes una rama de respaldo en Neon (Branches → Create branch).
-- =====================================================================================
BEGIN;

TRUNCATE impresiones, pedido_tareas, pedido_items, facturas, pedidos,
         movimientos_caja, auditoria_caja, turnos_caja, gastos,
         movimientos_inventario, compras_inventario, cambios_precio, accesos
RESTART IDENTITY;

-- OPCIONAL · Poner en 0 el stock de todos los insumos (para cargar el inventario real desde cero).
-- Para usarlo, borra los dos guiones del inicio de la línea siguiente:
-- UPDATE insumos SET cantidad = 0;

COMMIT;

-- Comprobación: todo debe salir en 0
SELECT (SELECT count(*) FROM pedidos)  AS pedidos,  (SELECT count(*) FROM facturas) AS facturas,
       (SELECT count(*) FROM turnos_caja) AS turnos, (SELECT count(*) FROM gastos)  AS gastos,
       (SELECT count(*) FROM compras_inventario) AS compras;
