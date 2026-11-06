// Borra los datos de PRUEBA para empezar en limpio (antes de lanzar a clientes reales).
// BORRA: pedidos, turnos de caja, auditoría de caja, movimientos de caja, gastos y movimientos de inventario.
// CONSERVA: usuarios, menú (platos), recetas e insumos (con las cantidades que tengan ahora).
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
await pool.query('TRUNCATE auditoria_caja, movimientos_caja, gastos, pedido_items, pedidos, turnos_caja, movimientos_inventario RESTART IDENTITY');
console.log(`Listo: se borraron ${b.pedidos} pedidos y ${b.turnos} turnos de caja. La numeración de pedidos vuelve a empezar en 1.`);
await pool.end();
