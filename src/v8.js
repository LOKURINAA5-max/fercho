// Rutas de la v8: zonas y pantallas de cocina, ajustes, facturas, compras de inventario, promociones y anuncios.
import * as K from './cocina.js';
import { HttpError, bad } from './errores.js';
import { CARTA } from './menu-fercho.js';

const HOY = () => new Date().toLocaleDateString('sv', { timeZone: 'America/Bogota' });
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sumaDias = (f, d) => new Date(Date.parse(f) + d * 864e5).toISOString().slice(0, 10);
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function montarV8({ app, q, pool, tx, auth, notify, audit, upload, guardarFoto }) {
  /* ---------- Ajustes (interruptores del administrador) ---------- */
  const AJ = {
    despacho_activo: 'bool', pantalla_despacho: 'bool', anuncios_barra: 'bool', anuncios_carrusel: 'bool', diario_con_inversion: 'bool', alerta_espera_min: 'min',
    modo_cocina: 'cocina', dom_ubicacion: 'bool', nav_app: 'nav', dom_modo: 'modo', dom_fija: 'plata', dom_base: 'plata', dom_por_km: 'plata', dom_km_incluidos: 'km', dom_km_max: 'km', dom_factor_ruta: 'factor', local_lat: 'coord', local_lng: 'coord',
  };
  app.get('/api/ajustes', auth('admin'), async (req, res) => res.json(await K.ajustes(pool)));
  app.put('/api/ajustes', auth('admin'), async (req, res) => {
    const b = req.body || {}, claves = Object.keys(b);
    if (!claves.length) throw bad('Nada que guardar');
    await tx(async (c) => {
      for (const k of claves) {
        if (!AJ[k]) throw bad('Ajuste desconocido: ' + k);
        let v = b[k];
        if (AJ[k] === 'bool') {
          if (typeof v !== 'boolean') throw bad('Valor inválido');
          if (k === 'dom_ubicacion' && v === false && b.dom_modo === undefined && (await K.ajuste(c, 'dom_modo')) === 'km') throw bad('El cobro por kilómetro necesita la ubicación. Cambia primero a «Tarifa fija» o «Sin cobro»');
          v = String(v);
        }
        else if (AJ[k] === 'cocina') {
          if (!['pantallas', 'impresion'].includes(v)) throw bad('Forma de cocina inválida');
          const { rows: [x] } = await c.query("SELECT count(*)::int AS n FROM pedidos WHERE confirmado AND estado IN ('espera','preparacion')");
          if (x.n > 0 && (await K.ajuste(c, 'modo_cocina')) !== v) throw new HttpError(409, `Hay ${x.n} pedido(s) en cocina. Termínalos antes de cambiar la forma de trabajo`);
        }
        else if (AJ[k] === 'nav') { if (!['waze', 'google', 'ambas'].includes(v)) throw bad('App de navegación inválida'); }
        else if (AJ[k] === 'modo') {
          if (!['ninguno', 'fija', 'km'].includes(v)) throw bad('Modo de domicilio inválido');
          if (v === 'km' && (b.dom_ubicacion === false || (b.dom_ubicacion === undefined && (await K.ajuste(c, 'dom_ubicacion')) === 'false'))) throw bad('El cobro por kilómetro necesita la ubicación del cliente. Enciende primero «Pedir ubicación en el mapa»');
        }
        else if (AJ[k] === 'plata') { v = Number(v); if (!Number.isInteger(v) || v < 0 || v > 500000) throw bad('El valor debe ser entre $0 y $500.000'); v = String(v); }
        else if (AJ[k] === 'km') { v = Number(v); if (!(v >= 0 && v <= 200)) throw bad('Los kilómetros deben estar entre 0 y 200'); v = String(v); }
        else if (AJ[k] === 'factor') { v = Number(v); if (!(v >= 1 && v <= 3)) throw bad('El factor de ruta debe estar entre 1 y 3'); v = String(v); }
        else if (AJ[k] === 'coord') { if (v === '' || v === null) v = ''; else { v = Number(v); if (!Number.isFinite(v) || Math.abs(v) > 180) throw bad('Coordenada inválida'); v = String(Math.round(v * 1e6) / 1e6); } }
        else { v = Number(v); if (!Number.isInteger(v) || v < 1 || v > 60) throw bad('Debe ser un número de 1 a 60'); v = String(v); }
        await c.query('INSERT INTO ajustes (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = $2', [k, v]);
      }
      if (b.despacho_activo === false)   // sin paso de armado: lo que esperaba ser armado queda listo
        await c.query(`UPDATE pedidos SET estado = 'listo', listo_en = now() WHERE zonas_listas AND estado = 'preparacion'`);
    });
    notify();
    res.json(await K.ajustes(pool));
  });

  /* ---------- Zonas de cocina ---------- */
  app.get('/api/zonas', auth('cocina', 'caja', 'admin'), async (req, res) =>
    res.json((await q(`SELECT * FROM zonas ${req.user.rol === 'admin' ? '' : 'WHERE activa'} ORDER BY orden, id`)).rows));
  const datosZona = (b) => {
    const nombre = String(b?.nombre || '').trim().slice(0, 30), color = b?.color === undefined ? undefined : String(b.color);
    if (b?.nombre !== undefined && nombre.length < 2) throw bad('El nombre de la zona debe tener al menos 2 letras');
    if (color !== undefined && !COLOR.test(color)) throw bad('Color inválido');
    return { nombre: b?.nombre === undefined ? null : nombre, color: color ?? null, orden: Number.isInteger(b?.orden) ? b.orden : null };
  };
  app.post('/api/zonas', auth('admin'), async (req, res) => {
    const d = datosZona(req.body);
    if (!d.nombre) throw bad('Escribe el nombre de la zona');
    const { rows: [z] } = await q('INSERT INTO zonas (nombre, color, orden) VALUES ($1, coalesce($2, $4), coalesce($3, (SELECT coalesce(max(orden), 0) + 1 FROM zonas))) RETURNING *',
      [d.nombre, d.color, d.orden, '#ff7a00']);
    notify();
    res.status(201).json(z);
  });
  app.put('/api/zonas/:id', auth('admin'), async (req, res) => {
    const d = datosZona(req.body), activa = typeof req.body?.activa === 'boolean' ? req.body.activa : null;
    if (activa === false) {
      const { rows: [x] } = await q(`SELECT count(*)::int AS n FROM pedido_tareas t JOIN pedidos p ON p.id = t.pedido_id
        WHERE t.zona_id = $1 AND t.estado <> 'lista' AND p.estado IN ('espera','preparacion')`, [req.params.id]);
      if (x.n) throw new HttpError(409, `Esa zona tiene ${x.n} tarea(s) pendientes en cocina. Termínalas antes de desactivarla`);
    }
    const { rows: [z] } = await q('UPDATE zonas SET nombre = coalesce($2, nombre), color = coalesce($3, color), orden = coalesce($4, orden), activa = coalesce($5, activa) WHERE id = $1 RETURNING *',
      [req.params.id, d.nombre, d.color, d.orden, activa]);
    if (!z) throw new HttpError(404, 'Zona no encontrada');
    notify();
    res.json(z);
  });

  /* ---------- Pantallas de cocina (por zona) y despacho ---------- */
  async function asegurarTareas() {   // pedidos confirmados antes de actualizar el sistema: se les crean sus tareas
    const { rows } = await q(`SELECT id, estado FROM pedidos p WHERE confirmado AND estado IN ('espera','preparacion')
      AND NOT EXISTS (SELECT 1 FROM pedido_tareas t WHERE t.pedido_id = p.id) AND creado_en > now() - interval '48 hours' LIMIT 20`);
    for (const p of rows) await tx(async (c) => {
      await K.bloquear(c, p.id);
      if (await K.encolar(c, p.id, null) && p.estado === 'preparacion')
        await c.query(`UPDATE pedido_tareas SET estado = 'preparando', inicio_en = now() WHERE pedido_id = $1`, [p.id]);
    });
  }
  app.get('/api/cocina', auth('cocina', 'admin'), async (req, res) => {
    await asegurarTareas();
    const [zonas, pedidos, aj] = await Promise.all([
      q('SELECT id, nombre, color, orden FROM zonas WHERE activa ORDER BY orden, id'),
      q(`SELECT p.id, coalesce(p.numero_dia, p.numero) AS numero, p.tipo, p.mesa, p.estado, p.zonas_listas, p.zonas_listas_en,
                p.confirmado_en, p.creado_en, p.preparacion_en, p.modificado_en, p.complemento_de,
                (SELECT coalesce(x.numero_dia, x.numero) FROM pedidos x WHERE x.id = p.complemento_de) AS complemento_num,
                coalesce((SELECT json_agg(json_build_object('id', t.id, 'zona_id', t.zona_id, 'nombre', t.nombre, 'cantidad', t.cantidad,
                   'sin', t.sin, 'nota', t.nota, 'estado', t.estado, 'origen', t.origen, 'parte', t.parte, 'inicio_en', t.inicio_en, 'listo_en', t.listo_en) ORDER BY t.id)
                   FROM pedido_tareas t WHERE t.pedido_id = p.id), '[]') AS tareas,
                coalesce((SELECT json_agg(json_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'sin', i.sin, 'nota', i.nota) ORDER BY i.id)
                   FROM pedido_items i WHERE i.pedido_id = p.id), '[]') AS items
         FROM pedidos p
         WHERE p.confirmado AND p.estado IN ('espera','preparacion') AND p.creado_en > now() - interval '48 hours'
         ORDER BY coalesce(p.confirmado_en, p.creado_en)`),
      K.ajustes(pool),
    ]);
    res.json({ zonas: zonas.rows, pedidos: pedidos.rows, despacho_activo: aj.despacho_activo === 'true', pantalla_despacho: aj.pantalla_despacho === 'true',
      alerta_espera_min: Number(aj.alerta_espera_min || 3) });
  });
  const accion = (fn) => async (req, res) => { await tx((c) => fn(c, req)); notify(); res.json({ ok: true }); };
  app.patch('/api/cocina/:id/zonas/:zona/empezar', auth('cocina', 'admin'), accion((c, r) => K.empezarZona(c, r.params.id, Number(r.params.zona), r.user.id)));
  app.patch('/api/cocina/:id/zonas/:zona/listo', auth('cocina', 'admin'), accion((c, r) => K.zonaLista(c, r.params.id, Number(r.params.zona), r.user.id)));
  app.patch('/api/cocina/:id/zonas/:zona/reabrir', auth('cocina', 'admin'), accion((c, r) => K.reabrirZona(c, r.params.id, Number(r.params.zona))));
  app.patch('/api/cocina/tareas/:tarea', auth('cocina', 'admin'), accion((c, r) => K.tareaHecha(c, r.params.tarea, r.body?.hecho !== false, r.user.id)));
  app.patch('/api/cocina/:id/armar', auth('cocina', 'admin'), accion((c, r) => K.armar(c, r.params.id)));

  /* ---------- Menú: lista para el administrador, foto y carga de la carta ---------- */
  app.get('/api/platos/admin', auth('admin'), async (req, res) => res.json((await q(`
    SELECT p.*, coalesce((SELECT json_agg(json_build_object('zona_id', pz.zona_id, 'parte', pz.parte)) FROM plato_zonas pz WHERE pz.plato_id = p.id), '[]') AS zonas,
           coalesce((SELECT json_agg(json_build_object('plato_id', cb.plato_id, 'cantidad', cb.cantidad, 'nombre', x.nombre)) FROM plato_combo cb JOIN platos x ON x.id = cb.plato_id WHERE cb.promo_id = p.id), '[]') AS combo,
           (SELECT count(*)::int FROM recetas r WHERE r.plato_id = p.id) AS n_receta,
           coalesce((SELECT json_agg(json_build_object('id', g.id, 'nombre', g.nombre, 'obligatorio', g.obligatorio, 'multiple', g.multiple,
               'opciones', (SELECT coalesce(json_agg(json_build_object('id', o.id, 'nombre', o.nombre, 'precio_extra', o.precio_extra::bigint, 'zona_id', o.zona_id,
               'receta', (SELECT coalesce(json_agg(json_build_object('insumo_id', r.insumo_id, 'cantidad', r.cantidad)), '[]') FROM opcion_receta r WHERE r.opcion_id = o.id)) ORDER BY o.orden, o.id), '[]') FROM opciones o WHERE o.grupo_id = g.id)) ORDER BY g.orden, g.id)
             FROM opcion_grupos g WHERE g.plato_id = p.id), '[]') AS grupos
    FROM platos p WHERE p.activo ORDER BY p.es_promo DESC, p.orden, p.id`)).rows));
  // Opciones de un plato: se envía la lista completa de grupos; lo que no venga se elimina
  app.put('/api/platos/:id/opciones', auth('admin'), async (req, res) => {
    const grupos = req.body?.grupos;
    if (!Array.isArray(grupos) || grupos.length > 10) throw bad('Opciones inválidas');
    await tx(async (c) => {
      const { rows: [pl] } = await c.query('SELECT id, nombre FROM platos WHERE id = $1 AND activo FOR UPDATE', [req.params.id]);
      if (!pl) throw new HttpError(404, 'Plato no encontrado');
      const antes = new Map((await c.query('SELECT o.id, o.nombre, o.precio_extra FROM opciones o JOIN opcion_grupos g ON g.id = o.grupo_id WHERE g.plato_id = $1', [pl.id])).rows.map((o) => [o.id, o]));
      const gIds = [], oIds = [];
      let go = 0;
      for (const g of grupos) {
        const nombre = String(g?.nombre || '').trim().slice(0, 40);
        if (nombre.length < 2) throw bad('Cada grupo de opciones necesita un nombre (ej.: Guarnición)');
        if (!Array.isArray(g.opciones) || !g.opciones.length || g.opciones.length > 20) throw bad(`Agrega al menos una opción en «${nombre}»`);
        let gid = Number(g.id) || null;
        if (gid) { const r = await c.query('UPDATE opcion_grupos SET nombre=$3, obligatorio=$4, multiple=$5, orden=$6 WHERE id=$1 AND plato_id=$2', [gid, pl.id, nombre, g.obligatorio !== false, g.multiple === true, go]); if (!r.rowCount) gid = null; }
        if (!gid) gid = (await c.query('INSERT INTO opcion_grupos (plato_id, nombre, obligatorio, multiple, orden) VALUES ($1,$2,$3,$4,$5) RETURNING id', [pl.id, nombre, g.obligatorio !== false, g.multiple === true, go])).rows[0].id;
        gIds.push(gid); go++;
        let oo = 0;
        for (const o of g.opciones) {
          const on = String(o?.nombre || '').trim().slice(0, 60), extra = Number(o.precio_extra) || 0, zona = Number(o.zona_id) || null;
          if (on.length < 1) throw bad(`Hay una opción sin nombre en «${nombre}»`);
          if (!Number.isInteger(extra) || extra < 0 || extra > 1000000) throw bad(`Precio extra inválido en «${on}»`);
          let oid = Number(o.id) || null;
          if (oid && antes.has(oid)) await c.query('UPDATE opciones SET grupo_id=$2, nombre=$3, precio_extra=$4, zona_id=$5, orden=$6 WHERE id=$1', [oid, gid, on, extra, zona, oo]);
          else oid = (await c.query('INSERT INTO opciones (grupo_id, nombre, precio_extra, zona_id, orden) VALUES ($1,$2,$3,$4,$5) RETURNING id', [gid, on, extra, zona, oo])).rows[0].id;
          const prev = antes.get(Number(o.id));
          if (!prev || Number(prev.precio_extra) !== extra) await c.query(`INSERT INTO cambios_precio (tipo, ref_id, nombre, campo, antes, despues, usuario_id) VALUES ('plato',$1,$2,$3,$4,$5,$6)`,
            [pl.id, pl.nombre, ('opción ' + on).slice(0, 20), prev ? String(Number(prev.precio_extra)) : null, String(extra), req.user.id]);
          oIds.push(oid); oo++;
          await c.query('DELETE FROM opcion_receta WHERE opcion_id = $1', [oid]);
          for (const r of Array.isArray(o.receta) ? o.receta.slice(0, 30) : []) {
            const cant = Number(r.cantidad);
            if (cant > 0) await c.query('INSERT INTO opcion_receta (opcion_id, insumo_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT (opcion_id, insumo_id) DO UPDATE SET cantidad = EXCLUDED.cantidad', [oid, Number(r.insumo_id), cant]);
          }
        }
      }
      await c.query('DELETE FROM opciones o USING opcion_grupos g WHERE g.id = o.grupo_id AND g.plato_id = $1 AND NOT (o.id = ANY($2))', [pl.id, oIds]);
      await c.query('DELETE FROM opcion_grupos WHERE plato_id = $1 AND NOT (id = ANY($2))', [pl.id, gIds]);
    });
    notify();
    res.json({ ok: true });
  });
  app.post('/api/platos/:id/foto', auth('admin'), upload.single('foto'), async (req, res) => {
    const foto = await guardarFoto(req);
    if (!foto) throw bad('Elige una foto');
    const { rowCount } = await q('UPDATE platos SET foto = $2 WHERE id = $1 AND activo', [req.params.id, foto]);
    if (!rowCount) throw new HttpError(404, 'Plato no encontrado');
    notify();
    res.json({ foto });
  });
  app.post('/api/menu/cargar-fercho', auth('admin'), async (req, res) => {
    const out = await tx(async (c) => {
      if (req.body?.reemplazar === true) await c.query('UPDATE platos SET activo = FALSE');
      const zonas = new Map((await c.query('SELECT id, nombre FROM zonas')).rows.map((z) => [z.nombre, z.id]));
      const ids = new Map(); let creados = 0, existentes = 0, orden = 0;
      for (const cat of CARTA) for (const [nombre, precio, desc, zs, op = {}] of cat.items) {
        orden++;
        const { rows: [ex] } = await c.query('SELECT id FROM platos WHERE lower(nombre) = lower($1) AND activo', [nombre]);
        if (ex) { ids.set(nombre, ex.id); existentes++; continue; }
        const { rows: [p] } = await c.query(
          `INSERT INTO platos (nombre, descripcion, precio, emoji, categoria, orden, es_promo, dias) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [nombre, desc || null, precio, cat.emoji, cat.cat, orden, !!cat.promo, op.dias || null]);
        ids.set(nombre, p.id); creados++;
        for (const [zn, parte] of zs) if (zonas.has(zn)) await c.query('INSERT INTO plato_zonas (plato_id, zona_id, parte) VALUES ($1,$2,$3)', [p.id, zonas.get(zn), parte]);
        let go = 0;
        for (const g of op.grupos || []) {
          const { rows: [gr] } = await c.query('INSERT INTO opcion_grupos (plato_id, nombre, obligatorio, orden) VALUES ($1,$2,TRUE,$3) RETURNING id', [p.id, g.nombre, go++]);
          let oo = 0;
          for (const o of g.opciones) await c.query('INSERT INTO opciones (grupo_id, nombre, precio_extra, zona_id, orden) VALUES ($1,$2,$3,$4,$5)', [gr.id, o.nombre, o.extra, o.zona && zonas.has(o.zona) ? zonas.get(o.zona) : null, oo++]);
        }
      }
      for (const cat of CARTA) for (const [nombre, , , , op = {}] of cat.items) for (const [comp, cant] of op.combo || []) {
        if (ids.has(comp)) await c.query('INSERT INTO plato_combo (promo_id, plato_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ids.get(nombre), ids.get(comp), cant]);
      }
      return { creados, existentes };
    });
    notify();
    res.json(out);
  });

  /* ---------- Comandas impresas por zona ---------- */
  const ZONA_F = (v) => (v === undefined || v === '' || v === 'todas' ? null : Number.isInteger(Number(v)) ? Number(v) : (() => { throw bad('Zona inválida'); })());
  // Una estación (navegador o agente de impresión) toma las comandas pendientes de su zona. Si no confirma en 45 s, vuelven a la cola.
  app.post('/api/impresion/tomar', auth('cocina', 'caja', 'admin'), async (req, res) => {
    const zona = ZONA_F(req.body?.zona), estacion = String(req.body?.estacion || req.user.usuario || '').slice(0, 40);
    const { rows } = await q(`
      UPDATE impresiones SET estado = 'imprimiendo', estacion = $2, intentos = intentos + 1, tomado_en = now()
      WHERE id IN (SELECT id FROM impresiones
                   WHERE (estado = 'pendiente' OR (estado = 'imprimiendo' AND tomado_en < now() - interval '45 seconds'))
                     AND ($1::int IS NULL OR zona_id = $1) ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED)
      RETURNING id, zona_id, tipo, contenido, intentos, creado_en`, [zona, estacion]);
    res.json(rows.sort((a, b) => Number(a.id) - Number(b.id)));
  });
  app.post('/api/impresion/:id/hecha', auth('cocina', 'caja', 'admin'), async (req, res) => {
    await q(`UPDATE impresiones SET estado = 'impresa', impreso_en = now() WHERE id = $1 AND estado <> 'impresa'`, [req.params.id]);
    notify();
    res.json({ ok: true });
  });
  app.post('/api/impresion/:id/fallo', auth('cocina', 'caja', 'admin'), async (req, res) => {   // vuelve a la cola de inmediato
    await q(`UPDATE impresiones SET estado = 'pendiente' WHERE id = $1 AND estado = 'imprimiendo'`, [req.params.id]);
    res.json({ ok: true });
  });
  app.get('/api/impresion/recientes', auth('cocina', 'caja', 'admin'), async (req, res) => {
    const zona = ZONA_F(req.query.zona);
    res.json((await q(`SELECT i.id, i.zona_id, i.tipo, i.estado, i.contenido, i.intentos, i.estacion, i.creado_en, i.impreso_en
      FROM impresiones i WHERE ($1::int IS NULL OR i.zona_id = $1) AND i.creado_en > now() - interval '18 hours' ORDER BY i.id DESC LIMIT 30`, [zona])).rows);
  });
  app.post('/api/impresion/:id/reimprimir', auth('cocina', 'caja', 'admin'), async (req, res) => {
    const { rows: [i] } = await q('SELECT * FROM impresiones WHERE id = $1', [req.params.id]);
    if (!i) throw new HttpError(404, 'Comanda no encontrada');
    await q('INSERT INTO impresiones (pedido_id, zona_id, tipo, contenido) VALUES ($1,$2,$3,$4)', [i.pedido_id, i.zona_id, i.tipo === 'anulado' ? 'anulado' : 'copia', JSON.stringify(i.contenido)]);
    notify();
    res.status(201).json({ ok: true });
  });
  // Caja: comandas atrasadas (impresora apagada o sin papel) para avisar a tiempo
  app.get('/api/impresion/estado', auth('caja', 'admin'), async (req, res) => {
    res.json((await q(`SELECT z.id AS zona_id, z.nombre AS zona, count(*)::int AS pendientes, extract(epoch FROM now() - min(i.creado_en))::int AS espera_seg
      FROM impresiones i JOIN zonas z ON z.id = i.zona_id WHERE i.estado <> 'impresa' AND i.creado_en > now() - interval '18 hours' GROUP BY z.id, z.nombre ORDER BY z.orden`)).rows);
  });
  app.post('/api/pedidos/:id/comandas', auth('caja', 'admin'), async (req, res) => {   // reimprimir las comandas de un pedido
    const n = await tx(async (c) => {
      const p = await K.bloquear(c, req.params.id);
      if (!p.confirmado || p.estado === 'cancelado') throw new HttpError(409, 'El pedido no tiene comandas');
      return K.crearComandas(c, p.id, 'copia');
    });
    notify();
    res.json({ comandas: n });
  });
  app.patch('/api/pedidos/:id/listo', auth('caja', 'admin'), async (req, res) => {
    await tx(async (c) => {
      if (!(await K.modoImpresion(c))) throw new HttpError(409, 'Con pantallas en cocina, el pedido lo marca listo la cocina');
      await K.listoManual(c, req.params.id, req.user.id);
    });
    notify();
    res.json({ estado: 'listo' });
  });

  /* ---------- Facturas (comprobantes internos) ---------- */
  app.get('/api/facturas', auth('caja', 'admin'), async (req, res) => {
    const hoy = HOY();
    let desde = FECHA.test(req.query.desde || '') ? req.query.desde : sumaDias(hoy, -7), hasta = FECHA.test(req.query.hasta || '') ? req.query.hasta : hoy;
    if (req.user.rol === 'caja' && desde < sumaDias(hoy, -8)) desde = sumaDias(hoy, -8);   // la caja consulta solo la última semana
    if (desde > hasta) throw bad('Rango de fechas inválido');
    if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 > 400) throw bad('El rango máximo es de 400 días');
    const texto = String(req.query.q || '').trim().slice(0, 40) || null;
    const { rows } = await q(`
      SELECT id, numero, creada_en, cajero, numeros_pedido, tipo, mesa, cliente, telefono, total::bigint AS total, metodo_pago,
             to_char(creada_en, 'IYYY-"S"IW') AS semana
      FROM facturas
      WHERE creada_en::date BETWEEN $1 AND $2
        AND ($3::text IS NULL
             OR CASE WHEN $3::text ~ '^[0-9]{1,9}$' THEN ($3::text::int = numero OR $3::text::int = ANY(numeros_pedido) OR mesa = $3::text) ELSE FALSE END
             OR telefono ILIKE '%' || $3::text || '%' OR cliente ILIKE '%' || $3::text || '%' OR mesa ILIKE $3::text)
      ORDER BY creada_en DESC LIMIT 500`, [desde, hasta, texto]);
    res.json({ desde, hasta, facturas: rows });
  });
  app.get('/api/facturas/:id', auth('caja', 'admin'), async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) throw bad('Factura inválida');
    const { rows: [f] } = await q('SELECT * FROM facturas WHERE id = $1', [req.params.id]);
    if (!f) throw new HttpError(404, 'Factura no encontrada');
    if (req.user.rol === 'caja' && f.creada_en < new Date(Date.now() - 9 * 864e5)) throw new HttpError(403, 'Las facturas de más de una semana las consulta el administrador');
    res.json(f);
  });

  /* ---------- Inventario: presentaciones, compras (inversión) y diferencias de conteo ---------- */
  app.get('/api/presentaciones', auth('admin'), async (req, res) =>
    res.json((await q('SELECT id, insumo_id, nombre, cantidad_base FROM presentaciones WHERE activa ORDER BY nombre')).rows));
  app.post('/api/insumos/:id/presentaciones', auth('admin'), async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 40), cant = Number(req.body?.cantidad_base);
    if (nombre.length < 2 || !(cant > 0) || cant > 1e9) throw bad('Escribe el nombre y cuánto trae (en la unidad del producto)');
    const { rows: [p] } = await q(`INSERT INTO presentaciones (insumo_id, nombre, cantidad_base) VALUES ($1,$2,$3)
      ON CONFLICT (insumo_id, nombre) DO UPDATE SET cantidad_base = $3, activa = TRUE RETURNING *`, [req.params.id, nombre, cant]);
    res.status(201).json(p);
  });
  app.delete('/api/presentaciones/:id', auth('admin'), async (req, res) => { await q('UPDATE presentaciones SET activa = FALSE WHERE id = $1', [req.params.id]); res.status(204).end(); });

  app.get('/api/compras', auth('admin'), async (req, res) => {
    const hoy = HOY(), desde = FECHA.test(req.query.desde || '') ? req.query.desde : sumaDias(hoy, -30), hasta = FECHA.test(req.query.hasta || '') ? req.query.hasta : hoy;
    res.json((await q(`SELECT c.id, c.fecha::text AS fecha, i.nombre AS insumo, i.unidad, c.presentacion, c.cant_presentacion, c.cantidad_base, c.costo_total::bigint AS costo_total,
        c.proveedor, c.pagado_con, c.anulada, u.usuario
      FROM compras_inventario c JOIN insumos i ON i.id = c.insumo_id LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.fecha BETWEEN $1 AND $2 ORDER BY c.fecha DESC, c.id DESC LIMIT 500`, [desde, hasta])).rows);
  });
  app.post('/api/compras', auth('admin'), async (req, res) => {
    const b = req.body || {}, cantidad = Number(b.cantidad), costo = Number(b.costo_total), fecha = b.fecha ? String(b.fecha) : HOY();
    const pagado = b.pagado_con === 'caja' ? 'caja' : 'otro', proveedor = String(b.proveedor || '').trim().slice(0, 80) || null;
    if (!(cantidad > 0) || cantidad > 1e9) throw bad('Escribe la cantidad comprada');
    if (!Number.isInteger(costo) || costo < 1 || costo > 1e9) throw bad('Escribe el valor total pagado (en pesos, sin decimales)');
    if (!FECHA.test(fecha) || fecha > HOY()) throw bad('La fecha no puede ser futura');
    const out = await tx(async (c) => {
      const { rows: [i] } = await c.query('SELECT * FROM insumos WHERE id = $1 AND activo FOR UPDATE', [b.insumo_id]);
      if (!i) throw new HttpError(404, 'Producto no encontrado');
      let base = cantidad, pres = null;
      if (b.presentacion_id) {
        const { rows: [p] } = await c.query('SELECT * FROM presentaciones WHERE id = $1 AND insumo_id = $2 AND activa', [b.presentacion_id, i.id]);
        if (!p) throw bad('Presentación inválida');
        base = cantidad * Number(p.cantidad_base); pres = p.nombre;
      }
      const stock = Number(i.cantidad), nuevoCosto = Math.round(((stock * Number(i.costo_unitario) + costo) / (stock + base)) * 10000) / 10000;
      let turno = null;
      if (pagado === 'caja') {
        ({ rows: [turno] } = await c.query('SELECT id FROM turnos_caja WHERE cerrado_en IS NULL FOR UPDATE'));
        if (!turno) throw new HttpError(409, 'Para pagar con dinero de la caja debe haber una caja abierta');
      }
      const { rows: [k] } = await c.query(`INSERT INTO compras_inventario (fecha, insumo_id, presentacion, cant_presentacion, cantidad_base, costo_total, proveedor, pagado_con, usuario_id, turno_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [fecha, i.id, pres, pres ? cantidad : null, base, costo, proveedor, pagado, req.user.id, turno ? turno.id : null]);
      await c.query('UPDATE insumos SET cantidad = cantidad + $2, costo_unitario = $3 WHERE id = $1', [i.id, base, nuevoCosto]);
      await c.query(`INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, delta, motivo, usuario_id, compra_id) VALUES ($1,'entrada',$2,$2,$3,$4,$5)`,
        [i.id, base, 'Compra' + (proveedor ? ' a ' + proveedor : ''), req.user.id, k.id]);
      if (Number(i.costo_unitario) !== nuevoCosto)
        await c.query(`INSERT INTO cambios_precio (tipo, ref_id, nombre, campo, antes, despues, usuario_id) VALUES ('insumo',$1,$2,'costo',$3,$4,$5)`,
          [i.id, i.nombre, String(i.costo_unitario), String(nuevoCosto), req.user.id]);
      if (turno) {   // salió dinero del cajón: se anota para que el cierre cuadre (no es un gasto de la utilidad)
        const motivo = `Compra de inventario: ${i.nombre}`;
        await c.query(`INSERT INTO movimientos_caja (turno_id, tipo, monto, motivo, usuario_id) VALUES ($1,'retiro',$2,$3,$4)`, [turno.id, costo, motivo, req.user.id]);
        await audit(c, turno.id, 'retiro', { monto: costo, motivo }, req);
      }
      return { id: k.id, cantidad_base: base, costo_unitario: nuevoCosto, stock: stock + base };
    });
    notify();
    res.status(201).json(out);
  });
  app.patch('/api/compras/:id/anular', auth('admin'), async (req, res) => {
    await tx(async (c) => {
      const { rows: [k] } = await c.query('SELECT * FROM compras_inventario WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!k || k.anulada) throw new HttpError(404, 'Compra no encontrada o ya anulada');
      if (k.pagado_con === 'caja') throw new HttpError(409, 'Esta compra salió de la caja: no se puede anular. Registra un ingreso de caja si devolvieron el dinero');
      const { rows: [i] } = await c.query('SELECT cantidad FROM insumos WHERE id = $1 FOR UPDATE', [k.insumo_id]);
      const quitar = Math.min(Number(i.cantidad), Number(k.cantidad_base));
      await c.query('UPDATE compras_inventario SET anulada = TRUE WHERE id = $1', [k.id]);
      await c.query('UPDATE insumos SET cantidad = cantidad - $2 WHERE id = $1', [k.insumo_id, quitar]);
      await c.query(`INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, delta, motivo, usuario_id, compra_id) VALUES ($1,'ajuste',$2,$3,'Compra anulada',$4,$5)`,
        [k.insumo_id, quitar, -quitar, req.user.id, k.id]);
    });
    notify();
    res.json({ ok: true });
  });
  app.get('/api/inventario/diferencias', auth('admin'), async (req, res) => {
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    res.json((await q(`SELECT i.id, i.nombre, i.unidad, sum(m.delta)::numeric AS diferencia, round(sum(m.delta * i.costo_unitario))::bigint AS valor,
        count(*)::int AS conteos, max(m.creado_en) AS ultimo
      FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id
      WHERE m.tipo = 'ajuste' AND m.delta IS NOT NULL AND m.creado_en > now() - make_interval(days => $1)
      GROUP BY i.id ORDER BY abs(sum(m.delta * i.costo_unitario)) DESC`, [dias])).rows);
  });
  app.get('/api/cambios-precio', auth('admin'), async (req, res) =>
    res.json((await q(`SELECT c.id, c.tipo, c.nombre, c.campo, c.antes, c.despues, c.creado_en, u.usuario
      FROM cambios_precio c LEFT JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 100`)).rows));

  /* ---------- Caja: movimientos del turno ---------- */
  app.get('/api/turno/movimientos', auth('caja', 'admin'), async (req, res) =>
    res.json((await q(`SELECT m.id, m.tipo, m.monto::bigint AS monto, m.motivo, m.creado_en, u.usuario
      FROM movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.turno_id = (SELECT id FROM turnos_caja WHERE cerrado_en IS NULL) ORDER BY m.id DESC`)).rows));

  /* ---------- Anuncios (carrusel de promociones) ---------- */
  app.get('/api/anuncios', async (req, res) => {
    if ((await K.ajuste(pool, 'anuncios_carrusel')) !== 'true') return res.json([]);
    res.json((await q(`SELECT a.id, a.titulo, a.texto, a.foto, a.plato_id FROM anuncios a
      WHERE a.activo AND (a.desde IS NULL OR a.desde <= now()) AND (a.hasta IS NULL OR a.hasta >= now()) AND a.foto IS NOT NULL ORDER BY a.orden, a.id`)).rows);
  });
  app.get('/api/anuncios/admin', auth('admin'), async (req, res) => res.json((await q('SELECT * FROM anuncios ORDER BY orden, id')).rows));
  const fechaOpc = (v) => (v === undefined || v === '' || v === null ? null : Number.isNaN(Date.parse(v)) ? (() => { throw bad('Fecha inválida'); })() : new Date(v).toISOString());
  app.post('/api/anuncios', auth('admin'), upload.single('foto'), async (req, res) => {
    const titulo = String(req.body.titulo || '').trim().slice(0, 80);
    if (titulo.length < 2) throw bad('Escribe un título');
    const foto = await guardarFoto(req);
    if (!foto) throw bad('Sube la imagen de la promoción');
    const { rows: [a] } = await q(`INSERT INTO anuncios (titulo, texto, foto, plato_id, orden, desde, hasta) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [titulo, String(req.body.texto || '').slice(0, 160) || null, foto, Number(req.body.plato_id) || null, Number(req.body.orden) || 0, fechaOpc(req.body.desde), fechaOpc(req.body.hasta)]);
    notify();
    res.status(201).json(a);
  });
  app.put('/api/anuncios/:id', auth('admin'), upload.single('foto'), async (req, res) => {
    const b = req.body || {}, foto = await guardarFoto(req);
    const { rows: [a] } = await q(`UPDATE anuncios SET titulo = coalesce($2, titulo), texto = coalesce($3, texto), foto = coalesce($4, foto),
        activo = coalesce($5, activo), plato_id = CASE WHEN $6::boolean THEN $7::int ELSE plato_id END,
        desde = CASE WHEN $8::boolean THEN $9::timestamptz ELSE desde END, hasta = CASE WHEN $10::boolean THEN $11::timestamptz ELSE hasta END
      WHERE id = $1 RETURNING *`,
      [req.params.id, b.titulo ? String(b.titulo).slice(0, 80) : null, b.texto !== undefined ? String(b.texto).slice(0, 160) : null, foto,
       b.activo === undefined ? null : b.activo === true || b.activo === 'true', b.plato_id !== undefined, Number(b.plato_id) || null,
       b.desde !== undefined, fechaOpc(b.desde), b.hasta !== undefined, fechaOpc(b.hasta)]);
    if (!a) throw new HttpError(404, 'Anuncio no encontrado');
    notify();
    res.json(a);
  });
  app.delete('/api/anuncios/:id', auth('admin'), async (req, res) => { await q('DELETE FROM anuncios WHERE id = $1', [req.params.id]); notify(); res.status(204).end(); });
}
