-- Migración 10: cocina con comandas impresas por zona (alternativa a las pantallas). Idempotente.
INSERT INTO ajustes (clave, valor) VALUES ('modo_cocina', 'pantallas')   -- 'pantallas' (tablets por zona) | 'impresion' (comandas en papel por zona)
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS impresiones (        -- cola de comandas por imprimir, una por pedido y zona
  id        BIGSERIAL PRIMARY KEY,
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  zona_id   INT  NOT NULL REFERENCES zonas(id),
  tipo      VARCHAR(12) NOT NULL DEFAULT 'comanda' CHECK (tipo IN ('comanda','anulado','copia')),
  contenido JSONB NOT NULL,                     -- lo que se imprime (copia fiel del momento)
  estado    VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','imprimiendo','impresa')),
  intentos  INT NOT NULL DEFAULT 0,
  estacion  VARCHAR(40),                        -- equipo o impresora que la tomó
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  tomado_en TIMESTAMPTZ,
  impreso_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_impresiones_cola ON impresiones (estado, zona_id, id);
CREATE INDEX IF NOT EXISTS idx_impresiones_pedido ON impresiones (pedido_id);
