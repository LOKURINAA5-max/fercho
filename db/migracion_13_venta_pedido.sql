-- Migración 13: la regla «un pedido genera como máximo UNA venta (factura)» también queda asegurada en la base de datos.
-- La clave foránea pedidos.factura_id → facturas.id ya permite como máximo una factura por pedido (es una sola columna).
-- Aquí se agrega: (1) solo un pedido pagado puede tener factura, (2) una vez asignada, la factura de un pedido no cambia. Idempotente.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_factura_solo_si_pagado') THEN
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_factura_solo_si_pagado CHECK (factura_id IS NULL OR pagado) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE pedidos VALIDATE CONSTRAINT pedidos_factura_solo_si_pagado;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Hay pedidos antiguos que no cumplen la regla; se aplica solo a los nuevos';
  END;
END $$;

CREATE OR REPLACE FUNCTION pedido_factura_fija() RETURNS trigger AS $$
BEGIN
  IF OLD.factura_id IS NOT NULL AND NEW.factura_id IS DISTINCT FROM OLD.factura_id THEN
    RAISE EXCEPTION 'El pedido ya tiene su factura (venta) y no se puede cambiar';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_pedido_factura_fija ON pedidos;
CREATE TRIGGER trg_pedido_factura_fija BEFORE UPDATE OF factura_id ON pedidos
  FOR EACH ROW EXECUTE FUNCTION pedido_factura_fija();
