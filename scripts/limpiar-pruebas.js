// Borra los datos de PRUEBA para empezar en limpio (antes de lanzar a clientes reales).
// Hace lo mismo que db/limpiar-pruebas.sql (que se puede pegar en el SQL Editor de Neon sin instalar nada).
// BORRA: pedidos, comandas, facturas, turnos y movimientos de caja, alertas, gastos, compras e historial de inventario,
//        cambios de precio y registro de accesos.
// CONSERVA: usuarios, carta, opciones, recetas, insumos, zonas, anuncios y ajustes.
// Uso: node --env-file=.env scripts/limpiar-pruebas.js --confirmar
import pg from 'pg';
const args = process.argv.slice(2);
if (!args.includes('--confirmar')) {
  console.error('Esto BORRA todos los pedidos, turnos de caja, auditoría y movimientos de inventario.\n' +
    'Conserva usuarios, menú, recetas e insumos. Haz una copia de seguridad antes.\n' +
    'Para continuar: node --env-file=.env scripts/limpiar-pruebas.js --confirmar');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !args.includes('--forzar')) {
  console.error('NODE_ENV=production: por seguridad no se ejecuta. Si de verdad lo quieres, agrega --forzar');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL });
const { rows: [b] } = await pool.query('SELECT (SELECT count(*) FROM pedidos)::int AS pedidos, (SELECT count(*) FROM turnos_caja)::int AS turnos');
// TRUNCATE no activa los bloqueos de borrado fila a fila de turnos/auditoría; por eso este script solo se corre a mano y con --confirmar.
await pool.query(`TRUNCATE impresiones, pedido_tareas, pedido_items, facturas, pedidos, movimientos_caja, auditoria_caja, turnos_caja, gastos,
  movimientos_inventario, compras_inventario, cambios_precio, accesos RESTART IDENTITY`);
console.log(`Listo: se borraron ${b.pedidos} pedidos y ${b.turnos} turnos de caja. Pedidos y facturas vuelven a empezar en 1.`);
await pool.end();
