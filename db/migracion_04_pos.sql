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
