-- OPCIONAL (solo demostración): simula 14 días de consumo para probar el recomendador.
INSERT INTO movimientos_inventario (insumo_id,tipo,cantidad,motivo,creado_en)
SELECT i.id,'salida',(random()*6+2)::numeric(12,2),'Datos de demostración', now() - (d || ' days')::interval
FROM insumos i, generate_series(1,14) d;
