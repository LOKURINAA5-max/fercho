-- Migración 06 (v8): zonas de cocina, tareas por zona, facturas, compras de inventario (inversión),
-- presentaciones y merma, promociones, anuncios, ajustes y bitácora de cambios de precio.
-- Idempotente: se puede ejecutar más de una vez.

-- ---------- Ajustes que decide el administrador (interruptores) ----------
CREATE TABLE IF NOT EXISTS ajustes (
  clave VARCHAR(40) PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT INTO ajustes (clave, valor) VALUES
  ('despacho_activo',      'true'),    -- paso final de "armar" el pedido antes de entregarlo
  ('pantalla_despacho',    'true'),    -- mostrar la pantalla de despacho al personal de cocina
  ('anuncios_barra',       'true'),    -- barra de texto con promociones que se desplaza
  ('anuncios_carrusel',    'true'),    -- carrusel de imágenes de promociones
  ('diario_con_inversion', 'false'),   -- el resumen del día incluye las compras de inventario (flujo de caja)
  ('alerta_espera_min',    '3')        -- minutos que una zona lista espera a otra antes de resaltarse
ON CONFLICT (clave) DO NOTHING;

-- ---------- Zonas de cocina ----------
CREATE TABLE IF NOT EXISTS zonas (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(30) UNIQUE NOT NULL,
  color  VARCHAR(7) NOT NULL DEFAULT '#ff7a00' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  orden  INT NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO zonas (nombre, color, orden) VALUES ('Plancha', '#ff7a00', 1), ('Asador', '#e0261b', 2)
ON CONFLICT (nombre) DO NOTHING;

-- Qué zona(s) prepara cada plato y qué parte (puede haber varias zonas por plato)
CREATE TABLE IF NOT EXISTS plato_zonas (
  plato_id INT NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
  zona_id  INT NOT NULL REFERENCES zonas(id)  ON DELETE CASCADE,
  parte    VARCHAR(60),                     -- ej.: "Carnes y pollo"
  PRIMARY KEY (plato_id, zona_id)
);

-- Promociones: un plato "especial" que puede estar formado por otros platos
ALTER TABLE platos ADD COLUMN IF NOT EXISTS es_promo    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platos ADD COLUMN IF NOT EXISTS promo_desde TIMESTAMPTZ;
ALTER TABLE platos ADD COLUMN IF NOT EXISTS promo_hasta TIMESTAMPTZ;
ALTER TABLE platos ADD COLUMN IF NOT EXISTS dias        SMALLINT[];   -- días en que se ofrece (0 = domingo ... 6 = sábado); vacío = todos
CREATE TABLE IF NOT EXISTS plato_combo (
  promo_id INT NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
  plato_id INT NOT NULL REFERENCES platos(id),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (promo_id, plato_id)
);

-- Los platos que ya existían (menos bebidas y adicionales) se asignan a la Plancha para que sigan pasando por cocina
INSERT INTO plato_zonas (plato_id, zona_id)
SELECT p.id, (SELECT id FROM zonas WHERE nombre = 'Plancha')
FROM platos p
WHERE p.categoria !~* '(bebida|cerveza|jugo|gaseosa|adicional|otras)'
  AND NOT EXISTS (SELECT 1 FROM plato_zonas)
ON CONFLICT DO NOTHING;

-- ---------- Pedidos: tareas por zona, edición, complementos ----------
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS zonas_listas    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS zonas_listas_en TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS modificado_en   TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS complemento_de  UUID REFERENCES pedidos(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS desperdicio     BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_pedidos_complemento ON pedidos (complemento_de);

CREATE TABLE IF NOT EXISTS pedido_tareas (
  id        BIGSERIAL PRIMARY KEY,
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  item_id   INT  REFERENCES pedido_items(id) ON DELETE CASCADE,
  zona_id   INT  NOT NULL REFERENCES zonas(id),
  nombre    VARCHAR(80) NOT NULL,
  origen    VARCHAR(80),                     -- si viene de una promoción: su nombre
  cantidad  INT NOT NULL CHECK (cantidad > 0),
  sin       TEXT[] NOT NULL DEFAULT '{}',
  nota      TEXT,
  parte     VARCHAR(60),
  estado    VARCHAR(10) NOT NULL DEFAULT 'espera' CHECK (estado IN ('espera','preparando','lista')),
  inicio_en TIMESTAMPTZ,
  listo_en  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tareas_pedido ON pedido_tareas (pedido_id);
CREATE INDEX IF NOT EXISTS idx_tareas_zona   ON pedido_tareas (zona_id, estado);

-- ---------- Facturas (comprobantes internos, no se pueden modificar ni borrar) ----------
CREATE TABLE IF NOT EXISTS facturas (
  id             SERIAL PRIMARY KEY,
  numero         INT UNIQUE NOT NULL,
  creada_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  turno_id       INT REFERENCES turnos_caja(id),
  cajero_id      INT REFERENCES usuarios(id),
  cajero         VARCHAR(40),
  pedido_ids     UUID[] NOT NULL,
  numeros_pedido INT[]  NOT NULL,
  tipo           VARCHAR(10),
  mesa           VARCHAR(10),
  cliente        VARCHAR(80),
  telefono       VARCHAR(20),
  direccion      TEXT,
  items          JSONB NOT NULL,
  total          NUMERIC(12,0) NOT NULL,
  metodo_pago    VARCHAR(10) NOT NULL,
  referencia_pago VARCHAR(30),
  recibido       NUMERIC(12,0),
  vueltos        NUMERIC(12,0)
);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha    ON facturas (creada_en);
CREATE INDEX IF NOT EXISTS idx_facturas_telefono ON facturas (telefono) WHERE telefono IS NOT NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS factura_id INT REFERENCES facturas(id);

CREATE OR REPLACE FUNCTION facturas_inmutables() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Las facturas no se pueden modificar ni borrar'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_facturas_inmutables ON facturas;
CREATE TRIGGER trg_facturas_inmutables BEFORE UPDATE OR DELETE ON facturas
  FOR EACH ROW EXECUTE FUNCTION facturas_inmutables();

-- ---------- Inventario: unidad base, merma, presentaciones de compra y compras (inversión) ----------
ALTER TABLE insumos ALTER COLUMN costo_unitario TYPE NUMERIC(14,4);   -- costos por gramo/ml necesitan decimales
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS merma_pct   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (merma_pct >= 0 AND merma_pct < 90);
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS peso_unidad NUMERIC(12,2) CHECK (peso_unidad > 0);   -- peso o volumen promedio de UNA unidad (ej.: un tomate = 150 g)

CREATE TABLE IF NOT EXISTS presentaciones (
  id          SERIAL PRIMARY KEY,
  insumo_id   INT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  nombre      VARCHAR(40) NOT NULL,               -- ej.: "Canastilla", "Bulto 50 kg"
  cantidad_base NUMERIC(12,2) NOT NULL CHECK (cantidad_base > 0),   -- cuánto trae, en la unidad base del insumo
  activa      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (insumo_id, nombre)
);

CREATE TABLE IF NOT EXISTS compras_inventario (   -- gasto de INVERSIÓN: no afecta la utilidad ni la caja del día
  id               SERIAL PRIMARY KEY,
  fecha            DATE NOT NULL DEFAULT current_date,
  insumo_id        INT NOT NULL REFERENCES insumos(id),
  presentacion     VARCHAR(40),
  cant_presentacion NUMERIC(12,2),
  cantidad_base    NUMERIC(12,2) NOT NULL CHECK (cantidad_base > 0),
  costo_total      NUMERIC(12,0) NOT NULL CHECK (costo_total > 0),
  proveedor        VARCHAR(80),
  pagado_con       VARCHAR(10) NOT NULL DEFAULT 'otro' CHECK (pagado_con IN ('otro','caja')),
  usuario_id       INT REFERENCES usuarios(id),
  turno_id         INT REFERENCES turnos_caja(id),
  anulada          BOOLEAN NOT NULL DEFAULT FALSE,
  creada_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras_inventario (fecha);
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS delta     NUMERIC(12,2);   -- con signo: lo que realmente subió o bajó el stock
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS compra_id INT REFERENCES compras_inventario(id);

-- ---------- Bitácora de cambios de precio y costo ----------
CREATE TABLE IF NOT EXISTS cambios_precio (
  id         BIGSERIAL PRIMARY KEY,
  tipo       VARCHAR(10) NOT NULL CHECK (tipo IN ('plato','insumo')),
  ref_id     INT NOT NULL,
  nombre     VARCHAR(80),
  campo      VARCHAR(20) NOT NULL,
  antes      TEXT,
  despues    TEXT,
  usuario_id INT REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cambios_fecha ON cambios_precio (creado_en);

-- ---------- Anuncios (carrusel de promociones en la página) ----------
CREATE TABLE IF NOT EXISTS anuncios (
  id        SERIAL PRIMARY KEY,
  titulo    VARCHAR(80) NOT NULL,
  texto     VARCHAR(160),
  foto      TEXT,
  plato_id  INT REFERENCES platos(id) ON DELETE SET NULL,   -- promoción a la que apunta (opcional)
  activo    BOOLEAN NOT NULL DEFAULT TRUE,
  orden     INT NOT NULL DEFAULT 0,
  desde     TIMESTAMPTZ,
  hasta     TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fercho_app') THEN
    REVOKE DELETE ON facturas, compras_inventario FROM fercho_app;
  END IF;
END $$;
