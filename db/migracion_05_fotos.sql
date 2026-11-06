-- Migración 05: las fotos se guardan en la base de datos (así no se pierden en servidores sin disco persistente, como Render gratis).
CREATE TABLE IF NOT EXISTS fotos (
  id        SERIAL PRIMARY KEY,
  tipo      VARCHAR(20) NOT NULL CHECK (tipo IN ('image/png','image/jpeg','image/webp')),
  datos     BYTEA NOT NULL CHECK (octet_length(datos) <= 307200),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
