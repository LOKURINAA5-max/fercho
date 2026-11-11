-- Migración 12: la ubicación en el mapa se puede apagar (solo dirección escrita) y se elige la app de navegación del domiciliario. Idempotente.
INSERT INTO ajustes (clave, valor) VALUES
  ('dom_ubicacion', 'true'),    -- pedir/permitir que el cliente marque su ubicación (GPS o mapa)
  ('nav_app',       'waze')     -- app para llevar al domiciliario: 'waze' | 'google' | 'ambas'
ON CONFLICT (clave) DO NOTHING;
