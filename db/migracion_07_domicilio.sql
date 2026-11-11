-- Migración 07: domicilios con ubicación, tarifa fija o por kilómetro, y costo del domicilio en el pedido y la factura.
-- Idempotente.
INSERT INTO ajustes (clave, valor) VALUES
  ('dom_modo',         'fija'),    -- 'ninguno' (sin cobro) | 'fija' (un solo valor) | 'km' (base + valor por kilómetro)
  ('dom_fija',         '4000'),    -- tarifa fija
  ('dom_base',         '3000'),    -- modo km: valor mínimo (cubre los kilómetros incluidos)
  ('dom_km_incluidos', '1'),       -- modo km: kilómetros que ya cubre la base
  ('dom_por_km',       '1000'),    -- modo km: valor de cada kilómetro adicional
  ('dom_km_max',       '0'),       -- distancia máxima de cobertura en km (0 = sin límite)
  ('dom_factor_ruta',  '1.3'),     -- las calles no son línea recta: la distancia en línea recta se multiplica por este factor
  ('local_lat',        ''),        -- ubicación del local (la marca el administrador)
  ('local_lng',        '')
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS distancia_km NUMERIC(6,1);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS referencia VARCHAR(200);                                  -- barrio, torre, apto, punto de referencia
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS costo_domicilio NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (costo_domicilio >= 0);
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS domicilio NUMERIC(12,0) NOT NULL DEFAULT 0;
