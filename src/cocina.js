// Lógica de la cocina por zonas: tareas, estados del pedido, inventario y reglas de edición.
// Todas las funciones reciben un cliente "c" que ya está dentro de una transacción.
import { HttpError, bad } from './errores.js';

export const DISPONIBLE = `p.activo AND NOT p.agotado
  AND (p.dias IS NULL OR cardinality(p.dias) = 0 OR extract(dow FROM now())::int = ANY(p.dias))
  AND (NOT p.es_promo OR ((p.promo_desde IS NULL OR p.promo_desde <= now()) AND (p.promo_hasta IS NULL OR p.promo_hasta >= now())))`;

export async function ajuste(c, clave) {
  const { rows: [r] } = await c.query('SELECT valor FROM ajustes WHERE clave = $1', [clave]);
  return r ? r.valor : null;
}
export const ajustes = async (c) => Object.fromEntries((await c.query('SELECT clave, valor FROM ajustes')).rows.map((r) => [r.clave, r.valor]));

// Valida las líneas que envía el cliente o el cajero y las normaliza
export function lineasDe(items, esCaja = false) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw bad('El pedido no tiene productos');
  return items.map((i) => {
    if (i?.libre) {   // cobro adicional que no está en la carta: solo la caja o el administrador
      if (!esCaja) throw new HttpError(403, 'Solo la caja puede agregar cobros adicionales');
      const nombre = String(i.descripcion || '').trim().slice(0, 60), precio = Number(i.precio), cantidad = Number(i.cantidad);
      if (nombre.length < 2) throw bad('Escribe por qué concepto es el cobro adicional');
      if (!Number.isInteger(precio) || precio < 50 || precio > 5000000) throw bad('Valor del cobro adicional inválido');
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw bad('Cantidad inválida');
      return { libre: true, plato_id: null, nombre, precio, cantidad, sin: [], nota: '', opciones: [], ops: [] };
    }
    const plato_id = Number(i?.plato_id), cantidad = Number(i?.cantidad);
    if (!Number.isInteger(plato_id) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw bad('Producto inválido');
    const sin = Array.isArray(i.sin) ? i.sin.slice(0, 20).map((s) => String(s).slice(0, 80)) : [];
    const opciones = Array.isArray(i.opciones) ? [...new Set(i.opciones.slice(0, 20).map(Number))] : [];
    if (opciones.some((o) => !Number.isInteger(o))) throw bad('Opción inválida');
    return { plato_id, cantidad, sin, nota: String(i.nota || '').slice(0, 200), opciones };
  });
}
export async function platosDisponibles(c, lines) {
  const ids = [...new Set(lines.filter((l) => !l.libre).map((l) => l.plato_id))];
  const { rows } = await c.query(`SELECT p.id, p.nombre, p.precio FROM platos p WHERE p.id = ANY($1) AND ${DISPONIBLE}`, [ids]);
  if (rows.length !== ids.length) throw bad('Algún producto no está disponible (agotado, fuera de horario o promoción vencida)');
  const byId = new Map(rows.map((p) => [p.id, p]));
  // Opciones del plato (presentación, guarnición, adicionales): se validan y se calcula el precio de cada línea
  const { rows: ops } = await c.query(`SELECT g.plato_id, g.id AS grupo_id, g.nombre AS grupo, g.obligatorio, g.multiple, o.id, o.nombre, o.precio_extra
    FROM opcion_grupos g LEFT JOIN opciones o ON o.grupo_id = g.id WHERE g.plato_id = ANY($1) ORDER BY g.orden, g.id, o.orden, o.id`, [ids]);
  for (const l of lines) {
    if (l.libre) continue;
    const pl = byId.get(l.plato_id), mias = ops.filter((o) => o.plato_id === l.plato_id), elegidas = [];
    for (const id of l.opciones || []) {
      const o = mias.find((x) => x.id === id);
      if (!o) throw bad(`Una opción de «${pl.nombre}» ya no está disponible. Vuelve a elegir`);
      elegidas.push(o);
    }
    for (const gid of new Set(mias.map((o) => o.grupo_id))) {
      const g = mias.find((o) => o.grupo_id === gid), n = elegidas.filter((o) => o.grupo_id === gid).length;
      if (!mias.some((o) => o.grupo_id === gid && o.id !== null)) continue;   // grupo sin opciones: se ignora
      if (g.obligatorio && n === 0) throw bad(`Elige ${g.grupo.toLowerCase()} para «${pl.nombre}»`);
      if (!g.multiple && n > 1) throw bad(`En «${pl.nombre}» solo se puede elegir una opción de ${g.grupo.toLowerCase()}`);
    }
    l.ops = elegidas.map((o) => ({ id: o.id, grupo: o.grupo, nombre: o.nombre, extra: Number(o.precio_extra) }));
    l.precio = Number(pl.precio) + l.ops.reduce((a, o) => a + o.extra, 0);
    l.nombre = (l.ops.length ? `${pl.nombre} (${l.ops.map((o) => o.nombre).join(', ')})` : pl.nombre).slice(0, 80);
  }
  return byId;
}
export async function insertarItems(c, pedidoId, lines, byId) {
  for (const l of lines) {
    const pl = byId.get(l.plato_id);
    await c.query(`INSERT INTO pedido_items (pedido_id, plato_id, nombre, precio_unit, cantidad, sin, nota, opciones, libre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [pedidoId, l.libre ? null : pl.id, l.nombre ?? pl.nombre, l.precio ?? pl.precio, l.cantidad, l.sin, l.nota || null, JSON.stringify(l.ops || []), !!l.libre]);
  }
  return lines.reduce((a, l) => a + Number(l.precio ?? byId.get(l.plato_id).precio) * l.cantidad, 0);
}

export async function bloquear(c, id) {
  const { rows: [p] } = await c.query('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
  if (!p) throw new HttpError(404, 'Pedido no encontrado');
  return p;
}

// Descuenta del inventario lo que consume el pedido (promociones: según los platos que las componen; con merma)
export async function descontarInventario(c, pedidoId, usuarioId) {
  const { rows } = await c.query(`
    WITH exp AS (
      SELECT coalesce(cb.plato_id, it.plato_id) AS plato_id, it.cantidad * coalesce(cb.cantidad, 1) AS qty, it.sin
      FROM pedido_items it LEFT JOIN plato_combo cb ON cb.promo_id = it.plato_id WHERE it.pedido_id = $1)
    SELECT r.insumo_id, round(sum(r.cantidad * e.qty / (1 - s.merma_pct / 100.0)), 2) AS qty
    FROM exp e JOIN recetas r ON r.plato_id = e.plato_id JOIN insumos s ON s.id = r.insumo_id
    WHERE NOT (s.nombre = ANY(e.sin)) GROUP BY r.insumo_id`, [pedidoId]);
  // Lo que gastan las opciones elegidas (ej.: papas a la francesa de un pincho)
  const { rows: extra } = await c.query(`
    SELECT r.insumo_id, round(sum(r.cantidad * it.cantidad / (1 - s.merma_pct / 100.0)), 2) AS qty
    FROM pedido_items it CROSS JOIN LATERAL jsonb_array_elements(it.opciones) o
    JOIN opcion_receta r ON r.opcion_id = (o->>'id')::int JOIN insumos s ON s.id = r.insumo_id
    WHERE it.pedido_id = $1 GROUP BY r.insumo_id`, [pedidoId]);
  for (const x of extra) {
    const r = rows.find((y) => y.insumo_id === x.insumo_id);
    if (r) r.qty = Math.round((Number(r.qty) + Number(x.qty)) * 100) / 100; else rows.push(x);
  }
  for (const r of rows) {
    const { rows: [i] } = await c.query('SELECT cantidad FROM insumos WHERE id = $1 FOR UPDATE', [r.insumo_id]);
    const real = Math.min(Number(i.cantidad), Number(r.qty));
    await c.query(`INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, delta, motivo, pedido_id, usuario_id)
       VALUES ($1, 'salida', $2, $3, 'Pedido en preparación', $4, $5)`, [r.insumo_id, r.qty, -real, pedidoId, usuarioId]);
    await c.query('UPDATE insumos SET cantidad = GREATEST(cantidad - $2, 0) WHERE id = $1', [r.insumo_id, r.qty]);
  }
}

// Crea las tareas por zona (una por ítem y zona; las promociones se reparten según sus componentes).
// Devuelve cuántas tareas tiene el pedido.
export async function crearTareas(c, pedidoId) {
  await c.query(`DELETE FROM pedido_tareas WHERE pedido_id = $1 AND estado = 'espera'`, [pedidoId]);
  await c.query(`
    INSERT INTO pedido_tareas (pedido_id, item_id, zona_id, nombre, origen, cantidad, sin, nota, parte)
    SELECT it.pedido_id, it.id, pz.zona_id,
           CASE WHEN e.es_combo THEN e.nombre_comp ELSE it.nombre END,
           CASE WHEN e.es_combo THEN it.nombre END,
           e.qty, it.sin, it.nota, pz.parte
    FROM pedido_items it
    JOIN LATERAL (
      SELECT coalesce(cb.plato_id, it.plato_id) AS plato_id, it.cantidad * coalesce(cb.cantidad, 1) AS qty,
             cb.plato_id IS NOT NULL AS es_combo, pl.nombre AS nombre_comp
      FROM (SELECT 1) x
      LEFT JOIN plato_combo cb ON cb.promo_id = it.plato_id
      LEFT JOIN platos pl ON pl.id = cb.plato_id) e ON TRUE
    JOIN plato_zonas pz ON pz.plato_id = e.plato_id
    JOIN zonas z ON z.id = pz.zona_id AND z.activa
    WHERE it.pedido_id = $1`, [pedidoId]);
  // Opciones con zona propia (y distinta a las del plato): tarea aparte para esa zona
  await c.query(`
    INSERT INTO pedido_tareas (pedido_id, item_id, zona_id, nombre, origen, cantidad, sin, nota)
    SELECT it.pedido_id, it.id, op.zona_id, left(op.nombre, 80), it.nombre, it.cantidad, '{}', it.nota
    FROM pedido_items it CROSS JOIN LATERAL jsonb_array_elements(it.opciones) o
    JOIN opciones op ON op.id = (o->>'id')::int
    JOIN zonas z ON z.id = op.zona_id AND z.activa
    WHERE it.pedido_id = $1
      AND NOT EXISTS (SELECT 1 FROM plato_zonas pz WHERE pz.plato_id = it.plato_id AND pz.zona_id = op.zona_id)
      AND NOT EXISTS (SELECT 1 FROM pedido_tareas t WHERE t.item_id = it.id AND t.zona_id = op.zona_id)`, [pedidoId]);
  const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM pedido_tareas WHERE pedido_id = $1', [pedidoId]);
  return n;
}

// Pedido sin nada que preparar (solo bebidas, por ejemplo): queda listo de inmediato
async function listoDirecto(c, pedidoId, usuarioId) {
  const { rows: [p] } = await c.query('SELECT inventario_descontado FROM pedidos WHERE id = $1', [pedidoId]);
  if (!p.inventario_descontado) await descontarInventario(c, pedidoId, usuarioId);
  await c.query(`UPDATE pedidos SET estado = 'listo', inventario_descontado = TRUE, zonas_listas = TRUE, zonas_listas_en = now(),
      preparacion_en = coalesce(preparacion_en, now()), listo_en = now() WHERE id = $1`, [pedidoId]);
}
// Pasa un pedido confirmado a la cocina.
// Con pantallas: queda en espera hasta que una zona lo empiece.
// Con comandas impresas: entra de una vez en preparación y se manda a imprimir una comanda por zona.
export const modoImpresion = async (c) => (await ajuste(c, 'modo_cocina')) === 'impresion';
export async function encolar(c, pedidoId, usuarioId) {
  const n = await crearTareas(c, pedidoId);
  if (n === 0) { await listoDirecto(c, pedidoId, usuarioId); return n; }
  if (await modoImpresion(c)) {
    const { rows: [p] } = await c.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
    await c.query(`UPDATE pedido_tareas SET estado = 'preparando', inicio_en = now() WHERE pedido_id = $1 AND estado = 'espera'`, [pedidoId]);
    await aPreparacion(c, p, usuarioId);
    await crearComandas(c, pedidoId, 'comanda');
  }
  return n;
}
// Crea una comanda por cada zona que participa en el pedido. tipo: 'comanda' | 'anulado' | 'copia'
export async function crearComandas(c, pedidoId, tipo = 'comanda', motivo = null) {
  const { rows: [p] } = await c.query(`SELECT p.*, coalesce(p.numero_dia, p.numero) AS num,
      (SELECT coalesce(o.numero_dia, o.numero) FROM pedidos o WHERE o.id = p.complemento_de) AS complemento_num FROM pedidos p WHERE p.id = $1`, [pedidoId]);
  const { rows: zs } = await c.query(`
    SELECT t.zona_id, z.nombre AS zona,
           json_agg(json_build_object('cantidad', t.cantidad, 'nombre', t.nombre, 'parte', t.parte, 'origen', t.origen, 'sin', t.sin, 'nota', t.nota) ORDER BY t.id) AS lineas
    FROM pedido_tareas t JOIN zonas z ON z.id = t.zona_id WHERE t.pedido_id = $1 GROUP BY t.zona_id, z.nombre, z.orden ORDER BY z.orden`, [pedidoId]);
  for (const z of zs) {
    const contenido = {
      numero: p.num, tipo_pedido: p.tipo, mesa: p.mesa, cliente: p.cliente, telefono: p.telefono, direccion: p.direccion, referencia: p.referencia,
      complemento_num: p.complemento_num, zona: z.zona, otras: zs.filter((x) => x.zona_id !== z.zona_id).map((x) => x.zona),
      hora: new Date().toISOString(), lineas: z.lineas, motivo,
    };
    await c.query('INSERT INTO impresiones (pedido_id, zona_id, tipo, contenido) VALUES ($1,$2,$3,$4)', [pedidoId, z.zona_id, tipo, JSON.stringify(contenido)]);
  }
  return zs.length;
}
// Comandas impresas: la caja marca el pedido como listo cuando la cocina lo entrega
export async function listoManual(c, id, usuarioId) {
  const p = await bloquear(c, id);
  if (!p.confirmado || !['espera', 'preparacion'].includes(p.estado)) throw new HttpError(409, 'El pedido no está en preparación');
  await c.query(`UPDATE pedido_tareas SET estado = 'lista', listo_en = now(), inicio_en = coalesce(inicio_en, now()) WHERE pedido_id = $1 AND estado <> 'lista'`, [id]);
  await aPreparacion(c, p, usuarioId);
  await c.query(`UPDATE pedidos SET estado = 'listo', listo_en = now(), zonas_listas = TRUE, zonas_listas_en = coalesce(zonas_listas_en, now()),
      preparacion_en = coalesce(preparacion_en, now()) WHERE id = $1`, [id]);
}

async function aPreparacion(c, p, usuarioId) {
  if (p.estado === 'espera') await c.query(`UPDATE pedidos SET estado = 'preparacion', preparacion_en = coalesce(preparacion_en, now()) WHERE id = $1`, [p.id]);
  if (!p.inventario_descontado) {
    await descontarInventario(c, p.id, usuarioId);
    await c.query('UPDATE pedidos SET inventario_descontado = TRUE WHERE id = $1', [p.id]);
  }
}
async function revisarCompleto(c, id) {
  const { rows: [x] } = await c.query(`SELECT count(*) FILTER (WHERE estado <> 'lista')::int AS pend, count(*)::int AS total FROM pedido_tareas WHERE pedido_id = $1`, [id]);
  if (x.total === 0 || x.pend > 0) return;
  await c.query(`UPDATE pedidos SET zonas_listas = TRUE, zonas_listas_en = coalesce(zonas_listas_en, now()) WHERE id = $1`, [id]);
  if ((await ajuste(c, 'despacho_activo')) !== 'true')
    await c.query(`UPDATE pedidos SET estado = 'listo', listo_en = now() WHERE id = $1 AND estado = 'preparacion'`, [id]);
}
const enCocina = (p) => {
  if (!p.confirmado || !['espera', 'preparacion'].includes(p.estado)) throw new HttpError(409, 'El pedido ya no está en cocina');
};
async function reabrirPedido(c, id) {
  await c.query(`UPDATE pedidos SET zonas_listas = FALSE, zonas_listas_en = NULL, estado = 'preparacion', listo_en = NULL
                 WHERE id = $1 AND estado IN ('preparacion','listo')`, [id]);
}

export async function empezarZona(c, id, zonaId, usuarioId) {
  const p = await bloquear(c, id); enCocina(p);
  const r = await c.query(`UPDATE pedido_tareas SET estado = 'preparando', inicio_en = now() WHERE pedido_id = $1 AND zona_id = $2 AND estado = 'espera'`, [id, zonaId]);
  if (!r.rowCount) {
    const { rowCount } = await c.query('SELECT 1 FROM pedido_tareas WHERE pedido_id = $1 AND zona_id = $2', [id, zonaId]);
    if (!rowCount) throw new HttpError(404, 'Esa zona no tiene nada que preparar en este pedido');
  }
  await aPreparacion(c, p, usuarioId);
}
export async function zonaLista(c, id, zonaId, usuarioId) {
  const p = await bloquear(c, id); enCocina(p);
  const { rowCount: hay } = await c.query('SELECT 1 FROM pedido_tareas WHERE pedido_id = $1 AND zona_id = $2', [id, zonaId]);
  if (!hay) throw new HttpError(404, 'Esa zona no tiene nada que preparar en este pedido');
  await c.query(`UPDATE pedido_tareas SET estado = 'lista', listo_en = now(), inicio_en = coalesce(inicio_en, now())
                 WHERE pedido_id = $1 AND zona_id = $2 AND estado <> 'lista'`, [id, zonaId]);
  await aPreparacion(c, p, usuarioId);
  await revisarCompleto(c, id);
}
export async function tareaHecha(c, tareaId, hecho, usuarioId) {
  const { rows: [t] } = await c.query('SELECT pedido_id FROM pedido_tareas WHERE id = $1', [tareaId]);
  if (!t) throw new HttpError(404, 'Tarea no encontrada');
  const p = await bloquear(c, t.pedido_id);
  if (hecho) {
    enCocina(p);
    await c.query(`UPDATE pedido_tareas SET estado = 'lista', listo_en = now(), inicio_en = coalesce(inicio_en, now()) WHERE id = $1`, [tareaId]);
    await aPreparacion(c, p, usuarioId);
    await revisarCompleto(c, p.id);
  } else {
    if (!['espera', 'preparacion', 'listo'].includes(p.estado)) throw new HttpError(409, 'El pedido ya salió de cocina');
    await c.query(`UPDATE pedido_tareas SET estado = 'preparando', listo_en = NULL WHERE id = $1`, [tareaId]);
    if (p.zonas_listas) await reabrirPedido(c, p.id);
  }
}
export async function reabrirZona(c, id, zonaId) {
  const p = await bloquear(c, id);
  if (!['preparacion', 'listo'].includes(p.estado)) throw new HttpError(409, 'El pedido ya salió de cocina');
  await c.query(`UPDATE pedido_tareas SET estado = 'preparando', listo_en = NULL WHERE pedido_id = $1 AND zona_id = $2`, [id, zonaId]);
  await reabrirPedido(c, id);
}
export async function armar(c, id) {
  const p = await bloquear(c, id);
  if (p.estado !== 'preparacion' || !p.zonas_listas) throw new HttpError(409, 'Todavía faltan zonas por terminar');
  await c.query(`UPDATE pedidos SET estado = 'listo', listo_en = now() WHERE id = $1`, [id]);
}
// Caja: entrega el pedido (el de domicilio pasa antes por "en camino")
export async function entregar(c, id) {
  const p = await bloquear(c, id);
  if (!p.confirmado || p.estado === 'cancelado') throw new HttpError(409, 'El pedido no se puede entregar');
  let next;
  if (p.estado === 'listo') next = p.tipo === 'domicilio' ? 'entregando' : 'entregado';
  else if (p.estado === 'entregando') next = 'entregado';
  else throw new HttpError(409, 'El pedido todavía no está listo en cocina');
  await c.query('UPDATE pedidos SET estado = $2 WHERE id = $1', [id, next]);
  return next;
}
// Reglas de edición: solo mientras ninguna zona haya empezado
export async function reemplazarItems(c, p, lines) {
  if (p.estado !== 'espera' || p.pagado) throw new HttpError(409, 'El pedido ya está en preparación: no se puede modificar. Crea un pedido complementario');
  const byId = await platosDisponibles(c, lines);
  await c.query('DELETE FROM pedido_items WHERE pedido_id = $1', [p.id]);
  const total = await insertarItems(c, p.id, lines, byId);
  await c.query('UPDATE pedidos SET total = $2, modificado_en = CASE WHEN confirmado THEN now() ELSE modificado_en END WHERE id = $1', [p.id, total + Number(p.costo_domicilio || 0)]);
  if (p.confirmado) await encolar(c, p.id, null);
  return total + Number(p.costo_domicilio || 0);
}
