-- Migración 11: índice para que la lista de pedidos abiertos (caja y cocina) siga siendo rápida aunque el historial crezca. Idempotente.
CREATE INDEX IF NOT EXISTS idx_pedidos_abiertos ON pedidos (creado_en)
  WHERE estado <> 'cancelado' AND NOT (estado = 'entregado' AND pagado);
