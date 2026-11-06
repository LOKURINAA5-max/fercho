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
