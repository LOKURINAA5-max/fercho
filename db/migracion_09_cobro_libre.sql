-- Migración 09: cobros adicionales que no están en la carta (bolsa, portacomidas, envase…). Solo los agrega la caja. Idempotente.
ALTER TABLE pedido_items ALTER COLUMN plato_id DROP NOT NULL;
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS libre BOOLEAN NOT NULL DEFAULT FALSE;   -- TRUE = cobro adicional escrito por la caja
