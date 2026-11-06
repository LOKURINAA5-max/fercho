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
