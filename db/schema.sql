-- Fercho · esquema PostgreSQL (requiere PostgreSQL 13+)
CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  usuario       VARCHAR(40) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol           VARCHAR(10) NOT NULL CHECK (rol IN ('admin','caja','cocina')),
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta   TIMESTAMPTZ,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE insumos (            -- materias primas / productos de inventario
  id       SERIAL PRIMARY KEY,
  codigo   VARCHAR(30) UNIQUE NOT NULL,
  nombre   VARCHAR(80) NOT NULL,
  cantidad NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  unidad   VARCHAR(15) NOT NULL DEFAULT 'u',
  foto     TEXT,
  activo   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE platos (             -- productos del menú
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(80) NOT NULL,
  descripcion TEXT,
  precio      NUMERIC(12,0) NOT NULL CHECK (precio >= 0),
  foto        TEXT,
  emoji       VARCHAR(8),
  agotado     BOOLEAN NOT NULL DEFAULT FALSE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE recetas (            -- cuánto insumo consume cada plato
  plato_id  INT NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
  insumo_id INT NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
  cantidad  NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (plato_id, insumo_id)
);

CREATE TABLE pedidos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero    INT GENERATED ALWAYS AS IDENTITY,
  tipo      VARCHAR(10) NOT NULL CHECK (tipo IN ('mesa','domicilio','mostrador')),
  mesa      VARCHAR(10),
  cliente   VARCHAR(80),
  telefono  VARCHAR(20),
  direccion TEXT,
  estado    VARCHAR(12) NOT NULL DEFAULT 'espera'
            CHECK (estado IN ('espera','preparacion','listo','entregando','entregado','cancelado')),
  total     NUMERIC(12,0) NOT NULL CHECK (total >= 0),
  metodo_pago VARCHAR(10) NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo','nequi')),
  referencia_pago  VARCHAR(30),   -- referencia del pago Nequi que escribe el cliente
  cancelado_motivo TEXT,
  pagado    BOOLEAN NOT NULL DEFAULT FALSE,
  inventario_descontado BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagado_en TIMESTAMPTZ,
  CHECK (tipo <> 'mesa' OR mesa IS NOT NULL),
  CHECK (tipo <> 'domicilio' OR (cliente IS NOT NULL AND telefono IS NOT NULL AND direccion IS NOT NULL))
);
CREATE INDEX idx_pedidos_estado ON pedidos (estado, creado_en);
CREATE INDEX idx_pedidos_pagado_en ON pedidos (pagado_en);

CREATE TABLE pedido_items (
  id          SERIAL PRIMARY KEY,
  pedido_id   UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  plato_id    INT NOT NULL REFERENCES platos(id),
  nombre      VARCHAR(80) NOT NULL,          -- copia del nombre al momento del pedido
  precio_unit NUMERIC(12,0) NOT NULL,        -- copia del precio al momento del pedido
  cantidad    INT NOT NULL CHECK (cantidad > 0),
  sin         TEXT[] NOT NULL DEFAULT '{}',  -- ingredientes que el cliente no quiere
  nota        TEXT                           -- preparación pedida por el cliente
);
CREATE INDEX idx_items_pedido ON pedido_items (pedido_id);

CREATE TABLE movimientos_inventario (        -- historial de entradas y salidas
  id         BIGSERIAL PRIMARY KEY,
  insumo_id  INT NOT NULL REFERENCES insumos(id),
  tipo       VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad   NUMERIC(12,2) NOT NULL,
  motivo     TEXT,
  pedido_id  UUID REFERENCES pedidos(id),
  usuario_id INT REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_insumo_fecha ON movimientos_inventario (insumo_id, creado_en);

-- ===== Contabilidad: ventas = pedidos pagados =====
CREATE VIEW ventas_diarias AS
  SELECT to_char(pagado_en,'YYYY-MM-DD') AS periodo, count(*) AS pedidos, sum(total) AS total,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'), 0) AS efectivo,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'), 0) AS nequi
  FROM pedidos WHERE pagado GROUP BY 1;
CREATE VIEW ventas_mensuales AS
  SELECT to_char(pagado_en,'YYYY-MM') AS periodo, count(*) AS pedidos, sum(total) AS total,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'), 0) AS efectivo,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'), 0) AS nequi
  FROM pedidos WHERE pagado GROUP BY 1;
CREATE VIEW ventas_anuales AS
  SELECT to_char(pagado_en,'YYYY') AS periodo, count(*) AS pedidos, sum(total) AS total,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'), 0) AS efectivo,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'), 0) AS nequi
  FROM pedidos WHERE pagado GROUP BY 1;

-- ===== Reportes (últimos 30 días) =====
CREATE VIEW platos_mas_vendidos AS
  SELECT i.nombre, sum(i.cantidad) AS unidades, sum(i.cantidad * i.precio_unit) AS ingresos
  FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
  WHERE p.pagado AND p.pagado_en >= now() - interval '30 days'
  GROUP BY i.nombre ORDER BY unidades DESC;

CREATE VIEW consumo_insumos AS
  SELECT s.nombre, s.unidad, sum(m.cantidad) AS consumido
  FROM movimientos_inventario m JOIN insumos s ON s.id = m.insumo_id
  WHERE m.tipo = 'salida' AND m.creado_en >= now() - interval '30 days'
  GROUP BY s.nombre, s.unidad ORDER BY consumido DESC;

-- ===== Recomendador anti-desperdicio =====
-- Sugerido diario = promedio de salidas de 14 días + 15 % de margen.
CREATE VIEW recomendacion_stock AS
WITH uso AS (
  SELECT insumo_id, sum(cantidad) / 14.0 AS prom_diario
  FROM movimientos_inventario
  WHERE tipo = 'salida' AND creado_en >= now() - interval '14 days'
  GROUP BY insumo_id
)
SELECT i.id, i.codigo, i.nombre, i.unidad, i.cantidad AS stock,
       round(coalesce(u.prom_diario, 0), 2)            AS prom_diario,
       ceil(coalesce(u.prom_diario, 0) * 1.15)         AS sugerido_diario,
       CASE WHEN coalesce(u.prom_diario,0) = 0 THEN NULL
            ELSE round(i.cantidad / u.prom_diario, 1) END AS dias_cobertura,
       CASE WHEN coalesce(u.prom_diario,0) = 0 THEN 'sin_datos'
            WHEN i.cantidad / u.prom_diario < 2  THEN 'reponer'
            WHEN i.cantidad / u.prom_diario > 10 THEN 'exceso'
            ELSE 'ok' END AS estado
FROM insumos i LEFT JOIN uso u ON u.insumo_id = i.id
WHERE i.activo;

-- ===== Turnos de caja (migración 02, incluida para instalaciones nuevas) =====
-- Migración 02: turnos de caja (apertura/cierre), movimientos de efectivo y auditoría.
-- Es idempotente: se puede ejecutar más de una vez sin dañar nada.
CREATE TABLE IF NOT EXISTS turnos_caja (
  id                  SERIAL PRIMARY KEY,
  abierto_por         INT NOT NULL REFERENCES usuarios(id),
  monto_apertura      NUMERIC(12,0) NOT NULL CHECK (monto_apertura >= 0),
  abierto_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  abierto_ip          TEXT,
  abierto_dispositivo TEXT,
  cerrado_por         INT REFERENCES usuarios(id),
  cerrado_en          TIMESTAMPTZ,
  efectivo_contado    NUMERIC(12,0) CHECK (efectivo_contado >= 0),
  -- cifras congeladas al cerrar
  ventas_efectivo     NUMERIC(12,0),
  ventas_nequi        NUMERIC(12,0),
  n_pedidos           INT,
  n_cancelados        INT,
  retiros             NUMERIC(12,0),
  ingresos            NUMERIC(12,0),
  efectivo_esperado   NUMERIC(12,0),
  diferencia          NUMERIC(12,0),
  notas_cierre        TEXT,
  alerta              BOOLEAN NOT NULL DEFAULT FALSE
);
-- Solo puede haber UN turno abierto a la vez (lo garantiza la base de datos).
CREATE UNIQUE INDEX IF NOT EXISTS un_turno_abierto ON turnos_caja ((cerrado_en IS NULL)) WHERE cerrado_en IS NULL;

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id         BIGSERIAL PRIMARY KEY,
  turno_id   INT NOT NULL REFERENCES turnos_caja(id),
  tipo       VARCHAR(10) NOT NULL CHECK (tipo IN ('retiro','ingreso')),
  monto      NUMERIC(12,0) NOT NULL CHECK (monto > 0),
  motivo     TEXT NOT NULL,
  usuario_id INT REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria_caja (   -- bitácora que nadie puede editar ni borrar
  id         BIGSERIAL PRIMARY KEY,
  turno_id   INT REFERENCES turnos_caja(id),
  evento     VARCHAR(30) NOT NULL,
  detalle    JSONB NOT NULL DEFAULT '{}',
  usuario_id INT REFERENCES usuarios(id),
  ip         TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS turno_id INT REFERENCES turnos_caja(id);
CREATE INDEX IF NOT EXISTS idx_pedidos_turno ON pedidos (turno_id);

-- Un turno cerrado no se puede modificar ni borrar; la auditoría tampoco.
CREATE OR REPLACE FUNCTION proteger_turno_cerrado() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Un turno de caja cerrado no se puede modificar ni borrar';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_turno_cerrado ON turnos_caja;
CREATE TRIGGER trg_turno_cerrado BEFORE UPDATE OR DELETE ON turnos_caja
  FOR EACH ROW EXECUTE FUNCTION proteger_turno_cerrado();

CREATE OR REPLACE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'La auditoría de caja no se puede modificar ni borrar'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON auditoria_caja;
CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria_caja
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

-- ===== Seguridad (migración 03, incluida para instalaciones nuevas) =====
-- Migración 03: verificación en dos pasos (2FA), registro de accesos y confirmación de pedidos.
-- Idempotente: se puede ejecutar más de una vez.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secreto       TEXT;                       -- cifrado (AES-256-GCM)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_activo        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_ultimo_paso   BIGINT  NOT NULL DEFAULT 0;  -- evita reutilizar un código
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_recuperacion  TEXT[]  NOT NULL DEFAULT '{}'; -- solo guarda hashes

CREATE TABLE IF NOT EXISTS accesos (            -- historial de inicios de sesión (exitosos y fallidos)
  id                BIGSERIAL PRIMARY KEY,
  usuario_id        INT REFERENCES usuarios(id),
  usuario_intentado VARCHAR(40),
  exito             BOOLEAN NOT NULL,
  motivo            VARCHAR(20),
  ip                TEXT,
  dispositivo       TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accesos_usuario ON accesos (usuario_id, creado_en);

-- Los pedidos que llegan por QR/domicilio pueden requerir confirmación de caja antes de pasar a cocina.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS confirmado BOOLEAN NOT NULL DEFAULT TRUE;

-- ===== POS: categorías, vueltos, jornadas y gastos (migración 04, incluida para instalaciones nuevas) =====
-- Migración 04: categorías de menú, costos, numeración por jornada, vueltos, tiempos de cocina y gastos.
-- Idempotente: se puede ejecutar más de una vez.
ALTER TABLE platos  ADD COLUMN IF NOT EXISTS categoria VARCHAR(40) NOT NULL DEFAULT 'General';
ALTER TABLE platos  ADD COLUMN IF NOT EXISTS orden     INT         NOT NULL DEFAULT 0;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0);

-- El número que ven clientes y cocina (#1, #2...) reinicia en cada turno de caja; "numero" global se conserva para auditoría.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_dia      INT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS turno_creacion  INT REFERENCES turnos_caja(id);
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_numero_turno ON pedidos (turno_creacion, numero_dia) WHERE turno_creacion IS NOT NULL;

-- Cobro en efectivo: lo que entregó el cliente y los vueltos devueltos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS efectivo_recibido NUMERIC(12,0);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS vueltos           NUMERIC(12,0);

-- Tiempos para el cronómetro de cocina y los reportes de velocidad
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS confirmado_en  TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS preparacion_en TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS listo_en       TIMESTAMPTZ;
UPDATE pedidos SET confirmado_en = creado_en WHERE confirmado AND confirmado_en IS NULL;

-- Cocina marca cada plato como terminado
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS listo BOOLEAN NOT NULL DEFAULT FALSE;

-- Gastos del negocio (compras, nómina, servicios...). No se borran: se anulan.
CREATE TABLE IF NOT EXISTS gastos (
  id          SERIAL PRIMARY KEY,
  fecha       DATE NOT NULL DEFAULT current_date,
  categoria   VARCHAR(40) NOT NULL,
  descripcion TEXT NOT NULL,
  monto       NUMERIC(12,0) NOT NULL CHECK (monto > 0),
  usuario_id  INT REFERENCES usuarios(id),
  turno_id    INT REFERENCES turnos_caja(id),     -- si salió de la caja durante un turno
  anulado     BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos (fecha);
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS gasto_id INT REFERENCES gastos(id);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fercho_app') THEN
    REVOKE DELETE ON gastos FROM fercho_app;    -- la aplicación nunca borra gastos
  END IF;
END $$;

-- Migración 05: las fotos se guardan en la base de datos (así no se pierden en servidores sin disco persistente, como Render gratis).
CREATE TABLE IF NOT EXISTS fotos (
  id        SERIAL PRIMARY KEY,
  tipo      VARCHAR(20) NOT NULL CHECK (tipo IN ('image/png','image/jpeg','image/webp')),
  datos     BYTEA NOT NULL CHECK (octet_length(datos) <= 307200),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
