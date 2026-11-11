// Carta de "Hamburguesas y Pinchos Fercho" (tomada de la carta impresa). Se carga desde el panel: Menú → "Cargar la carta de Fercho".
// Zonas sugeridas: el administrador las ajusta después. Los platos sin zona (bebidas, adicionales) no pasan por cocina.
const PL = [['Plancha', null]], AS = [['Asador', null]], NO = [];
const PICADA = [['Plancha', 'Carnes, pollo y papas'], ['Asador', 'Chorizo, mazorca y rellena']];
const FIN = [6, 0];   // sábado y domingo

// [nombre, precio, descripción, zonas]
const CARTA_BASE = [
  { cat: 'Promociones', emoji: '🔥', promo: true, items: [
    ['Promo 3 hamburguesas clásicas', 63000, 'Tres hamburguesas clásicas en promoción', NO, { combo: [['Clásica de carne o de pollo', 3]] }],
    ['Promo 4 pinchos con papa al vapor', 34000, 'Cuatro pinchos con papa al vapor', AS],
  ] },
  { cat: 'Hamburguesas', emoji: '🍔', items: [
    ['Sencilla de carne · sin papa', 15000, '150 g de carne, cebolla grillé, tomate, lechuga, queso doble crema', PL],
    ['Sencilla de carne · con papa', 19000, '150 g de carne, cebolla grillé, tomate, lechuga, queso doble crema y papas', PL],
    ['Sencilla de pollo · sin papa', 15000, 'Pollo, cebolla grillé, tomate, lechuga, queso doble crema', PL],
    ['Sencilla de pollo · con papa', 19000, 'Pollo, cebolla grillé, tomate, lechuga, queso doble crema y papas', PL],
    ['Clásica de carne o de pollo', 22000, '150 g de carne, tocineta, huevos de codorniz, cebolla grillé, tomate, lechuga, queso doble crema, 120 g de papas a la francesa con queso rallado', PL],
    ['Mixta', 26000, 'Carne y pollo en filete o desmechado, tocineta, huevos de codorniz, cebolla, tomate, lechuga, queso doble crema y papas a la francesa con queso rallado', PL],
    ['Doble carne', 26000, 'Carne, tocineta, huevos de codorniz, cebolla grillé o cruda, tomate, lechuga, queso doble crema, papas a la francesa con queso rallado', PL],
    ['De patacón', 27000, 'Carne y pollo, queso gratinado, papas a la francesa con queso rallado', PL],
    ['Especial', 32000, 'Doble carne, filete de pollo, tocineta, huevos de codorniz, cebolla, tomate, lechuga, queso doble crema y papas a la francesa con queso rallado', PL],
    ['La hamburguesa de Fercho', 32000, 'Carne de hamburguesa, pollo en filete, carne en filete, tocineta, huevos de codorniz, queso doble crema, lechuga, tomate, cebolla grillé, salsas, papa a la francesa con queso rallado', PL],
    ['La Leona', 35000, 'Carne de hamburguesa, pollo desmechado, pollo y carne en filete, tocineta, huevos de codorniz, queso doble crema, lechuga, tomate, cebolla grillé, salsas, papa a la francesa con queso rallado', PL],
  ] },
  { cat: 'Perros calientes', emoji: '🌭', items: [
    ['Perro de siempre · sin papa', 10000, 'Salchicha Zenú normal, papa ripio, cebolla cruda o grillé, queso rallado, salsas', PL],
    ['Perro de siempre · con papa', 15000, 'Salchicha Zenú normal, papa ripio, cebolla cruda o grillé, queso rallado, salsas y papas', PL],
    ['Perro clásico · sin papa', 13000, 'Salchicha americana, papa ripio, huevos de codorniz, cebolla, queso rallado o gratinado y salsas', PL],
    ['Perro clásico · con papa', 18000, 'Salchicha americana, papa ripio, huevos de codorniz, cebolla, queso rallado o gratinado, salsas y papas', PL],
    ['Perro mixto · sin papa', 22000, 'Extralargo: 2 salchichas americanas, pollo desmechado, papa ripio, huevos de codorniz, queso, cebolla', PL],
    ['Perro mixto · con papa', 26000, 'Extralargo: 2 salchichas americanas, pollo desmechado, papa ripio, huevos de codorniz, queso, cebolla y 120 g de papas a la francesa', PL],
    ['Perro loco · sin papa', 25000, '2 salchichas americanas, papa ripio, carne y pollo en trozos, huevos de codorniz, queso, cebolla grillé', PL],
    ['Perro loco · con papa', 29000, '2 salchichas americanas, papa ripio, carne y pollo en trozos, huevos de codorniz, queso, cebolla grillé y 120 g de papas a la francesa', PL],
    ['Perro especial · sin papa', 31000, 'Salchicha y chorizo en trozos, carne y pollo en trozos, pollo desmechado, maíz, tocineta, huevos de codorniz, cebolla grillé', PL],
    ['Perro especial · con papa', 34000, 'Salchicha y chorizo en trozos, carne y pollo en trozos, pollo desmechado, maíz, tocineta, huevos de codorniz, cebolla grillé y papas a la francesa', PL],
    ['Pepito', 37000, 'Carne, pollo, cebolla, aguacate, tomate, pimentón, chorizo', PL],
  ] },
  { cat: 'Desgranados', emoji: '🌽', items: [
    ['Desgranado normal · sin papa', 21000, 'Pollo desmechado, maíz, queso y salsas', PL],
    ['Desgranado normal · con papa', 25000, 'Pollo desmechado, maíz, queso y salsas, con papas', PL],
    ['Desgranado mixto · sin papa', 25000, 'Pollo y carne en trozos, pollo desmechado, maíz, chorizo, salsas y queso', PL],
    ['Desgranado mixto · con papa', 29000, 'Pollo y carne en trozos, pollo desmechado, maíz, chorizo, salsas y queso, con papas', PL],
  ] },
  { cat: 'Papas locas y salchipapas', emoji: '🍟', items: [
    ['Papas locas personal', 30000, 'Pollo y carne en trozos, pollo desmechado, chorizo, papa ripio, salchichas, tocineta, huevos de codorniz, maíz, queso y salsas', PL],
    ['Papas locas grande', 51000, 'Pollo y carne en trozos, pollo desmechado, salchicha, chorizo, tocineta, maíz, huevos de codorniz, papa ripio, papas a la francesa', PL],
    ['Papas locas con todo', 70000, 'Pollo y carne en trozos, pollo desmechado, salchicha, chorizo, tocineta, maíz, huevos de codorniz, papa ripio, aguacate, tomate, cebolla, lechuga, papas a la francesa', PL],
    ['Salchipapa sencillo', 21000, 'Huevos de codorniz, queso y salsas', PL],
    ['Choripapa', 21000, 'Huevos de codorniz, queso y salsas', PL],
    ['Salchipollo', 25000, 'Papa ripio, pollo desmechado, huevos de codorniz, queso, salsas y papas a la francesa', PL],
    ['Choripollo', 25000, 'Papa ripio, pollo desmechado, huevos de codorniz, queso, salsas y papas a la francesa', PL],
  ] },
  { cat: 'Pinchos', emoji: '🍢', items: [
    ['Pincho con ensalada', 14000, 'Con ensalada de cebolla, tomate, aguacate y lechuga', AS],
    ['Pincho solo pollo · papas al vapor', 9000, '', AS], ['Pincho solo pollo · papas a la francesa', 14000, '', AS],
    ['Pincho solo carne · papas al vapor', 9000, '', AS], ['Pincho solo carne · papas a la francesa', 14000, '', AS],
    ['Pincho mixto · papas al vapor', 9000, '', AS], ['Pincho mixto · papas a la francesa', 14000, '', AS],
    ['Pincho de rellena · papas al vapor', 9000, '', AS], ['Pincho de rellena · papas a la francesa', 14000, '', AS],
    ['Pincho de mazorca · con queso', 9000, 'Con queso gratinado o rallado', AS], ['Pincho de mazorca · papas a la francesa', 14000, '', AS],
    ['Pincho de chorizo · papas al vapor', 9000, '', AS], ['Pincho de chorizo · papas a la francesa', 14000, '', AS],
    ['Pincho de ubre · papas al vapor', 9000, '', AS], ['Pincho de ubre · papas a la francesa', 14000, '', AS],
    ['Pincho con papas a la francesa para llevar', 15000, '', AS],
  ] },
  { cat: 'Porciones y adicionales', emoji: '🥗', items: [
    ['Porción de papas a la francesa', 9000, '', PL],
    ['Porción de papas a la francesa con queso rallado', 11000, '', PL],
    ['Porción de queso rallado', 4000, '', NO],
    ['Ensalada de cebolla, tomate, aguacate y lechuga', 9000, '', NO],
  ] },
  { cat: 'Picadas', emoji: '🥘', items: [
    ['Picada personal', 25000, '300 g entre carne y pollo + chorizo, 150 g de papas a la francesa, huevos de codorniz, cebolla grillé', PICADA],
    ['Picada mediana', 35000, '400 g entre carne y pollo + chorizo mixto, mazorca, huevos de codorniz, 250 g de papa a la francesa, queso rallado y cebolla grillé', PICADA],
    ['Picada para 2 personas (500 g)', 42000, '500 g entre carne y pollo + chorizo mixto, mazorca, rellena, huevos de codorniz, 350 g de papa a la francesa, queso rallado y cebolla grillé', PICADA],
    ['Picada para 2 personas (600 g)', 46000, '600 g entre carne y pollo + chorizo mixto, huevos de codorniz, 350 g de papa a la francesa, queso rallado y cebolla grillé', PICADA],
    ['Picada para 3 personas', 55000, '600 g entre carne y pollo + chorizo, rellena, mazorca, huevos de codorniz, 450 g de papa a la francesa, queso rallado y cebolla grillé', PICADA],
    ['Picada grande', 70000, '800 g entre carne y pollo + chorizo mixto, mazorca, huevos de codorniz, aguacate, papa al vapor, queso rallado y cebolla grillé', PICADA],
    ['Picada familiar', 120000, '1.500 g entre carne y pollo + chorizo mixto, mazorca, chorizo casero, huevos de codorniz, 600 g de papas a la francesa, queso rallado y cebolla grillé', PICADA],
  ] },
  { cat: 'A la plancha', emoji: '🥩', items: [
    ['Pierna-pernil con papas al vapor', 15000, '', PL], ['Pierna-pernil con papas a la francesa', 20000, '', PL],
    ['Carne a la plancha con papas a la francesa', 23000, '', PL],
    ['Pechuga a la plancha con papas a la francesa', 23000, '', PL],
    ['Chuleta de cerdo con papas a la francesa', 23000, '', PL],
    ['Pechuga o carne con queso gratinado, maíz y tocineta', 35000, 'Con papas a la francesa y ensalada', PL],
  ] },
  { cat: 'Almuerzos de fin de semana', emoji: '🍲', items: [
    ['Sancocho de gallina (sábado)', 18000, 'Arroz, papa, yuca y guacamole', NO, { dias: [6] }],
    ['Sancocho con dos presas (sábado)', 25000, 'Arroz, papa, yuca y guacamole', NO, { dias: [6] }],
    ['Sancocho sin seco (sábado)', 13000, 'Solo el sancocho', NO, { dias: [6] }],
    ['Mute completo (domingo)', 18000, 'De la casa con arroz, yuca y guacamole', NO, { dias: [0] }],
    ['Mute grande sin seco (domingo)', 14000, 'Solo el mute', NO, { dias: [0] }],
    ['Mute pequeño (domingo)', 14000, 'Arroz, papa, yuca y guacamole', NO, { dias: [0] }],
    ['Almuerzo · Pierna-pernil', 18000, 'Arroz, papas al vapor, yuca, guacamole', PL, { dias: FIN }],
    ['Almuerzo · Pechuga', 22000, 'Arroz, papas al vapor, yuca, guacamole', PL, { dias: FIN }],
    ['Almuerzo · Chuletas de cerdo', 24000, 'Arroz, papas al vapor, yuca, guacamole', PL, { dias: FIN }],
    ['Almuerzo · Chatas', 26000, 'Arroz, papa, yuca al vapor, guacamole', PL, { dias: FIN }],
    ['Almuerzo · Sobrebarriga', 26000, 'Arroz, papas al vapor, yuca, guacamole', PL, { dias: FIN }],
    ['Almuerzo · Costillitas de cerdo', 25000, 'Arroz, papas al vapor, yuca, guacamole', PL, { dias: FIN }],
    ['Almuerzo · Chorizos', 9000, '', AS, { dias: FIN }],
    ['Almuerzo · Rellenas', 9000, '', AS, { dias: FIN }],
    ['Almuerzo · Mazorca', 9000, '', AS, { dias: FIN }],
    ['Porción de yuca', 5000, '', NO, { dias: FIN }],
    ['Porción de guacamole', 5000, '', NO, { dias: FIN }],
    ['Porción de arroz', 5000, '', NO, { dias: FIN }],
  ] },
  { cat: 'Bebidas', emoji: '🥤', items: [
    ['Coca-Cola personal', 4000, '', NO], ['Coca-Cola 1 L', 6000, '', NO], ['Coca-Cola 1,5 L', 9000, '', NO], ['Coca-Cola 2 L', 9000, '', NO],
    ['Hipinto personal', 3500, '', NO], ['Hipinto 1 L', 5000, '', NO], ['Pony Malta personal', 4000, '', NO], ['Gaseosa mini', 2500, '', NO],
    ['Postobón 1,5 L', 7000, '', NO], ['Postobón 2 L', 9000, '', NO],
  ] },
  { cat: 'Cervezas', emoji: '🍺', items: [
    ['Heineken', 4000, '', NO], ['Poker', 4000, '', NO], ['Águila', 4000, '', NO], ['Águila light', 4000, '', NO], ['Budweiser', 4000, '', NO],
    ['Cola y Pola', 4000, '', NO], ['Coronita', 4500, '', NO], ['Club Colombia', 4500, '', NO], ['Poker litrón', 9000, '', NO],
  ] },
  { cat: 'Jugos', emoji: '🧃', items: [
    ['Vaso de naranjada', 3000, 'Precio 1 de la carta ($3.000 / $4.000): ajusta si hay dos tamaños', NO],
    ['Vaso de naranjada (grande)', 4000, '', NO],
    ['Jarra de naranjada', 9000, 'Precio 1 de la carta ($9.000 / $18.000)', NO],
    ['Jarra de naranjada (grande)', 18000, '', NO],
    ['Hit personal', 3000, 'Precio 1 de la carta ($3.000 / $3.500)', NO], ['Hit personal (opción 2)', 3500, '', NO],
    ['Hit botella 500 ml', 3500, '', NO], ['Hit botella 1,25 L', 5000, '', NO], ['Hit plástico 1,5 L', 7000, '', NO],
  ] },
  { cat: 'Otras bebidas', emoji: '💧', items: [
    ['Botella de agua sin gas', 3500, '', NO], ['Botella de agua con gas', 4000, '', NO], ['Botella de agua H2O', 4000, '', NO],
    ['Soda', 4000, '', NO], ['Gatorade', 4500, '', NO], ['Speed Max', 3000, '', NO],
  ] },
];

// Las variantes con distinto precio (con/sin papa, guarnición del pincho, presentación del jugo) se unen en UN plato con opciones.
const VAR = [
  [/^(.*) · (sin papa)$/i, 'Papas', 'Sin papa', null], [/^(.*) · (con papa)$/i, 'Papas', 'Con papa', null],
  [/^(.*) · (papas al vapor)$/i, 'Guarnición', 'Papas al vapor', null], [/^(.*) · (papas a la francesa)$/i, 'Guarnición', 'Papas a la francesa', 'Plancha'],
  [/^(.*) \((grande)\)$/i, 'Tamaño', 'Grande', null], [/^(.*) \((opción 2)\)$/i, 'Tamaño', 'Grande', null],
];
function unir(items) {
  const out = [], porBase = new Map();
  for (const it of items) {
    const [nombre, precio, desc, zs, op = {}] = it;
    const v = VAR.find(([re]) => re.test(nombre));
    const base = v ? nombre.match(v[0])[1] : nombre;
    const previo = porBase.get(base);
    if (!v) { const fila = [nombre, precio, /^Precio 1 de la carta/.test(desc) ? '' : desc, zs, { ...op }]; porBase.set(base, fila); out.push(fila); continue; }
    if (!previo) { const fila = [base, precio, desc, zs, { ...op, grupos: [{ nombre: v[1], opciones: [{ nombre: v[2], extra: 0, zona: v[3] }] }] }]; porBase.set(base, fila); out.push(fila); continue; }
    if (!previo[4].grupos) previo[4].grupos = [{ nombre: v[1], opciones: [{ nombre: 'Normal', extra: 0, zona: null }] }];   // jugos: la primera fila es el tamaño base
    previo[4].grupos[0].opciones.push({ nombre: v[2], extra: Math.max(0, precio - previo[1]), zona: v[3] });
  }
  return out;
}
export const CARTA = CARTA_BASE.map((c) => ({ ...c, items: unir(c.items) }));
