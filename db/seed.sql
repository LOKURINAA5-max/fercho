-- Catálogo inicial. Ejecutar UNA vez sobre una base recién creada (los ids dependen del orden).
INSERT INTO insumos (codigo,nombre,cantidad,unidad) VALUES
 ('PAN-01','Pan de hamburguesa',120,'u'),('CAR-01','Carne de res',110,'u'),('QUE-01','Queso',150,'u'),
 ('POL-01','Pollo para pincho',90,'u'),('CER-01','Cerdo para pincho',90,'u'),('TOM-01','Tomate',100,'porc'),
 ('LEC-01','Lechuga',100,'porc'),('PAP-01','Papas',160,'porc'),('GAS-01','Gaseosa',70,'u');
INSERT INTO platos (nombre,precio,emoji) VALUES
 ('Hamburguesa clásica',18000,'🍔'),('Hamburguesa doble',24000,'🍔'),('Pincho de pollo',14000,'🍢'),
 ('Pincho de cerdo',15000,'🍢'),('Papas',7000,'🍟'),('Gaseosa',4000,'🥤');
INSERT INTO recetas (plato_id,insumo_id,cantidad) VALUES
 (1,1,1),(1,2,1),(1,3,1),(1,6,1),(1,7,1),
 (2,1,1),(2,2,2),(2,3,2),(2,6,1),(2,7,1),
 (3,4,1),(3,8,1),(4,5,1),(4,8,1),(5,8,1),(6,9,1);

-- Categorías y costos de ejemplo (ajústalos a tu negocio desde el panel de administrador)
UPDATE platos SET categoria = 'Hamburguesas',     orden = 1 WHERE nombre LIKE 'Hamburguesa%';
UPDATE platos SET categoria = 'Pinchos',          orden = 2 WHERE nombre LIKE 'Pincho%';
UPDATE platos SET categoria = 'Acompañamientos',  orden = 3 WHERE nombre = 'Papas';
UPDATE platos SET categoria = 'Bebidas',          orden = 4 WHERE nombre = 'Gaseosa';
UPDATE insumos SET costo_unitario = CASE codigo
  WHEN 'PAN-01' THEN 900 WHEN 'CAR-01' THEN 3500 WHEN 'QUE-01' THEN 1200 WHEN 'POL-01' THEN 3000
  WHEN 'CER-01' THEN 3200 WHEN 'TOM-01' THEN 300 WHEN 'LEC-01' THEN 300 WHEN 'PAP-01' THEN 1000
  WHEN 'GAS-01' THEN 1800 ELSE 0 END;

-- Zonas de cocina del menú de ejemplo: los pinchos van al Asador y el resto (menos bebidas) a la Plancha
INSERT INTO plato_zonas (plato_id, zona_id)
SELECT p.id, (SELECT id FROM zonas WHERE nombre = CASE WHEN p.nombre ~* 'pincho' THEN 'Asador' ELSE 'Plancha' END)
FROM platos p
WHERE p.categoria !~* '(bebida|cerveza|jugo|gaseosa|otras)' AND NOT EXISTS (SELECT 1 FROM plato_zonas z WHERE z.plato_id = p.id)
ON CONFLICT DO NOTHING;
