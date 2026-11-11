-- Migración 08: opciones dentro de un plato (presentaciones, tamaños, guarniciones, adicionales) con precio extra,
-- zona de cocina e insumos propios. Idempotente.
CREATE TABLE IF NOT EXISTS opcion_grupos (
  id          SERIAL PRIMARY KEY,
  plato_id    INT NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
  nombre      VARCHAR(40) NOT NULL,                 -- ej.: "Guarnición", "Preparación"
  obligatorio BOOLEAN NOT NULL DEFAULT TRUE,        -- el cliente debe elegir al menos una
  multiple    BOOLEAN NOT NULL DEFAULT FALSE,       -- se pueden elegir varias (adicionales)
  orden       INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_opcion_grupos_plato ON opcion_grupos (plato_id);
CREATE TABLE IF NOT EXISTS opciones (
  id           SERIAL PRIMARY KEY,
  grupo_id     INT NOT NULL REFERENCES opcion_grupos(id) ON DELETE CASCADE,
  nombre       VARCHAR(60) NOT NULL,                -- ej.: "Papas a la francesa"
  precio_extra NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (precio_extra >= 0),
  zona_id      INT REFERENCES zonas(id) ON DELETE SET NULL,   -- zona que prepara esta opción (opcional)
  orden        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_opciones_grupo ON opciones (grupo_id);
CREATE TABLE IF NOT EXISTS opcion_receta (             -- lo que gasta la opción del inventario (por unidad)
  opcion_id INT NOT NULL REFERENCES opciones(id) ON DELETE CASCADE,
  insumo_id INT NOT NULL REFERENCES insumos(id),
  cantidad  NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (opcion_id, insumo_id)
);
-- Lo que eligió el cliente queda copiado en el ítem: [{"id":1,"grupo":"Guarnición","nombre":"Papas a la francesa","extra":5000}]
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS opciones JSONB NOT NULL DEFAULT '[]';
