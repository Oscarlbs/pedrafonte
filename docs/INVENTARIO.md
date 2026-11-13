# Inventario de modelos y texturas

Hecho el 12 de noviembre de 2026 sobre los packs descargados.

## Qué había y qué no

| Pack pedido | Archivo encontrado | Dónde quedó | Estado |
|---|---|---|---|
| Medieval Stylized Assets (alefranart) | `MedievalAssets GLTF with textures free.rar` (358 MB) | `assets/medieval-stylized/` (443 MB) | ✅ 33 modelos |
| EmaceArt · `Texture.zip` | `Texture.zip` (1,9 MB) | `assets/emaceart-texture/Texture/` | ✅ 4 texturas |
| EmaceArt · `glb.zip` | `glb.zip` (4,4 MB), llegó el 13 nov | `assets/emaceart-glb/` (15 MB) | ✅ 225 piezas; el juego usa 26 |
| (extra) manual del shader de hierba | `EmacEArt_StylizedGrass_Manual.pdf` | copia en `assets/_origen/` | solo lectura |

Los originales comprimidos están en `assets/_origen/`. Nada de `assets/` va a git.

## Medieval Stylized Assets · 33 modelos glTF

Todos son una sola malla, de pocos triángulos (60–3.000) y con texturas grandes incrustadas
(color + normal, de ahí los 443 MB). `herramientas/optimizar-modelos.mjs` los deja en **4,5 MB** en total
(GLB con texturas WebP de 512 px) dentro de `juego/public/modelos/`. Medidas en metros (ancho × alto × fondo).

| Modelo | GLB | Medidas (m) | Triáng. | Uso en el juego |
|---|---|---|---|---|
| Stylized Hut01 | `stylized_hut01` | 7,6 × 7,0 × 6,5 | 1.234 | Choza inicial y cabañas |
| Market03 | `market03` | 5,8 × 4,1 × 5,9 | 1.078 | Puesto del mercado |
| Bridge01 / Bridge02 | `bridge01`, `bridge02` | 3,6 × 3,5 × 9,5 | 784 | Puente de piedra sobre el río |
| Bridge_Wood01 | `bridge_wood01` | 2,0 × 1,5 × 5,7 | 3.072 | Pasarela de madera |
| Wall_Stone01/02/03 | `wall_stone01`… | 5,1/3,2/3,0 de largo × 2 de alto | ~130 | Muros y muritos |
| FenceWood_H01, FenceWoodDoor_H02/H03/H04, FenceWoodDoor_gate, Wooden_Fence | `fencewood_h01`… | ~2,1 × 1,3 × 0,4 | 68–284 | Vallas y portillas |
| Railing02 / Railing03 | `railing02`, `railing03` | 2,2 y 4,5 de largo | 166–280 | Barandillas, tendedero |
| Foundation_Wood_01/02/03 | `foundation_wood_0N` | 3,9×2,7 · 2,7×2,7 · 5,2×6,4 | 320–692 | Tarimas, embarcadero, andamios |
| Streetlamp01 | `streetlamp01` | 1,5 × 4,0 × 2,2 | 950 | Farolillos (material emisivo) |
| Brazier | `brazier` | 1,2 × 0,6 × 1,0 | 642 | Hoguera / brasero |
| Barrel03 | `barrel03` | 0,8 × 1,0 × 0,8 | 302 | Barriles |
| Box01 / Box02 | `box01`, `box02` | ~0,8 | 160–396 | Cajas |
| Bench01 | `bench01` | 2,4 × 0,4 × 0,6 | 124 | Bancos |
| Sign01 | `sign01` | 0,8 × 1,4 × 0,2 | 224 | Letreros de oficio |
| Ladder | `ladder` | 1,1 × 3,7 × 0,2 | 304 | Escaleras de mano |
| Trunk01 | `trunk01` | 5,7 × 1,7 × 4,8 | 500 | Montón de troncos (leñador, aserradero) |
| Wheel_L / Wheel_R | `wheel_l`, `wheel_r` | ø 1,8 | 432 | Ruedas de carro y rueda del molino |
| Rock02 / Rock03 | `rock02`, `rock03` | 2,1 y 0,8 | 92–236 | Rocas |
| Graveyard03 | `graveyard03` | 1,0 × 1,8 × 0,8 | 204 | Lápida (camposanto) |

## EmaceArt · Texture.zip

| Archivo | Tamaño | Qué es | Uso |
|---|---|---|---|
| `Flower_Grass.png` | 1024² | Hierba con flores (color) | Suelo del valle |
| `Flower_Grass_NM.png` | 1024² | Su mapa de normales | Relieve del suelo |
| `Grass_Texture.png` (+ `.psd`) | 480² con alfa | Mata de hierba recortada | Matas de hierba instanciadas |
| `EA02_LPNP-Slavika_Colorsheet_v1.png` | 32² | Paleta de colores del pack Slavika | Referencia de paleta |

Los `.meta` son de Unity y no se usan.

## EmaceArt · glb.zip · 225 piezas GLB

Un solo material para todo, con una paleta de 32 × 32 px (colores planos, sin texturas de detalle), y entre
12 y 17.000 triángulos por pieza. Vienen marcadas como metálicas, así que sin retocar salen casi negras: el
optimizador las deja mates y `modelos.ts` calienta un poco la paleta para que case con la de la aldea.
Solo se convierten las 26 que usa el juego (3,2 MB), con el prefijo `ea_`:

| Pieza del pack | GLB | Uso en el juego |
|---|---|---|
| Village_Hut_Wall_Front_04b / 04e / 04h, Village_Hut_Roof_Cut_01c, Village_Hut_Roof_01c | `ea_muro_ventanas`, `ea_muro_puerta`, `ea_muro_liso`, `ea_tejado_paja`, `ea_tejado_paja_largo` | Muros de entramado y tejados de paja sueltos: con ellos se monta una de cada tres casas y una de cada tres casas grandes (de dos alturas) |
| Village_OutBuilding_Cubby_01d | `ea_cabana` | Cabaña del leñador (siempre) y otra de cada tres casas |
| Town_Building_Administrative_01a | `ea_casona` | Otra de cada tres casas grandes (casa larga de troncos pintados) |
| Village_Tover_01a | `ea_torre` | Una de cada tres torres de guardia (de troncos) |
| Prop_Village_Whell_01d | `ea_pozo` | Uno de cada tres pozos (brocal de tablas, tejadillo de paja) |
| Village_OutBuilding_Shed_01a | `ea_pajar` | Uno de cada tres graneros (pajar de tablas) |
| Village_OutBuilding_WoodRoof_01b, Items_House_Firewood_01a | `ea_cobertizo`, `ea_lenera` | Una de cada tres leñeras |
| Village_AnimalBreeding_Hovel_01a | `ea_conejera` | Caseta de dos de cada tres gallineros |
| Prop_Forester_wooden_01d, Prop_Brushwood_03a | `ea_lenos`, `ea_haz` | Leños y haces junto a cabañas y casas de troncos |
| Prop_Container_* (saco, bala, barril, tinaja, cestos, cubo, cuba, cajones), Prop_Vegetable_Basket_02 | `ea_saco`, `ea_bala`, `ea_barril`… | «Barriles y cajas», género del mercado, enseres de casas y pajar |
| Prop_Sign_Chapel_01 | `ea_peto` | Peto de ánimas del camposanto |

## Lo que falta y cómo se suple

Ninguno de los dos packs trae casas de entramado, molino, iglesia, personas ni animales. Las casas de
EmaceArt vienen **por piezas** (cimiento, muros, tejados) y solo hay unos pocos edificios enteros, todos de
troncos; sus árboles son espigados y oscuros y no cambian con la estación. Lo que no hay se hace con
geometría propia en el código, siguiendo la descripción del diseño:

| Falta | Solución provisional |
|---|---|
| Casas de entramado y paja, casa del señor, taberna, panadería, herrería, iglesia, granero… | Constructores procedurales en `juego/src/escena/edificios.ts` (dos de cada tres casas y casas grandes, y uno de cada tres graneros, pozos y torres, salen del pack de EmaceArt) |
| Molino de agua | Procedural, con la rueda `wheel_l` del pack girando |
| Árboles, arbustos, trigo | Formas básicas instanciadas (cambian con la estación; los del pack, no) |
| Aldeanos y señor | Figuritas de formas básicas (cuerpo, cabeza, sombrero según oficio) |
| Gallinas, ovejas, perros | Formas básicas |
| Pozo, ropa tendida | Formas básicas + piezas del pack |

Quedan sin usar, por si apetece más adelante: los muros de troncos y el cimiento de piedra (para montar
casas largas de troncos), el embarcadero, el retrete, vallas de varas y de tablas, sauces, rocas, muebles y vajilla.
`node herramientas/galeria-modelos.mjs assets/emaceart-glb <carpeta>` saca hojas con todas las miniaturas.
