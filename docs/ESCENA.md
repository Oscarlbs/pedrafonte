# La escena 3D de Pedrafonte (Fase 1)

Cliente del juego: `juego/` (Vite + TypeScript + Three.js). Dibuja el valle como una maqueta flotante, con
luz, estación y clima reales, y ofrece una fachada (`Mundo`) sobre la que se montan las fases siguientes.

```
cd juego && npm install
npm run dev          # http://127.0.0.1:5173  (proxy de /api y /ws → 127.0.0.1:8765)
npm run build        # comprobación de tipos + compilación a juego/dist
node ../herramientas/capturas.mjs   # capturas en docs/capturas/
```

En Fase 1 el juego no necesita el servidor del mundo. Lee los mismos YAML que él
(`mundo/datos/edificios.yaml`, `mundo/datos/paisajes.yaml`, `config/ubicacion.yaml`) con `?raw`, así que
hay una sola fuente de verdad.

## Carpetas

| Carpeta | Qué hay |
|---|---|
| `src/mundo.ts` | La fachada: `crearMundo(lienzo)` → `Mundo`. Lo único que deben importar las fases siguientes. |
| `src/datos.ts` | Catálogo, paisajes y ubicación (tipos y lectura de los YAML). |
| `src/escena/` | `terreno` (relieve, suelo pintado, base flotante, cascada), `rio` (agua), `cielo` (cúpula, sol, luna, estrellas, nubes y luces), `astros` (sol, luna, estación, husos), `clima` (Open-Meteo, simulado, lluvia y nieve), `modelos` (GLB del pack y mapa modelo → GLB), `lotes` (dibujo por lotes), `taller` (piezas procedurales), `edificios` (un constructor por `modelo`), `poblado` (colocar, quitar, enlazar, vista previa), `vegetacion`, `efectos` (humo, fuego, halos, posprocesado), `camara`, `paleta`. |
| `src/juego/` | `cuadricula` (contrato de mapa), `figuras` (aldeanos, señor, bocadillos, rutas), `animales`. |
| `src/ui/` | `estilo.css` (variables y clases base de la estética de pergamino) y `panel.ts` (controles de la Fase 1). |
| `src/vistas/` | «Inicio» y «Escaparate»: listas de colocaciones hechas solo con la fachada. |

## Parámetros de la URL

`?vista=inicio|escaparate` · `&hora=18.5` o un momento del día real (`amanecer`, `dia`, `mediodia`,
`atardecer`, `noche`, `luna`) · `&clima=real|despejado|nubes|lluvia|niebla|tormenta|nieve` ·
`&estacion=primavera|verano|otono|invierno` · `&fecha=2026-06-21` · `&paisaje=valle|ribera|montana|bosque` ·
`&cam=azimut,elevacion,distancia[,cx,cz]` · `&mira=luna|sol` · `&ui=0` (sin interfaz) · `&captura=1` (sin
relámpagos, espera más fotogramas) · `&pixeles=1.5` (relación de píxeles fija).

`window.__aldea` expone `{ listo, error, mundo, vista, info(), irA(clave) }`. `listo` pasa a `true` cuando la
vista está montada y dibujada; es lo que espera el script de capturas.

## Contrato de mapa, tal como lo aplica el cliente

- Cuadrícula de `celdas × celdas` (56) de 2 m. `x = (cx − 28 + 0,5) · 2`, `z = (cz − 28 + 0,5) · 2`. Norte = `z`
  negativo, este = `x` positivo.
- Los puntos de `paisajes.yaml` (río, caminos) se toman como **centros de celda**: la distancia del contrato
  («el centro de la celda dista del eje…») se mide entre `(cx, cz)` y la polilínea, en celdas.
- `tipoCelda`: `puente` si cae en el rectángulo del puente; si no, `agua` si dista del eje menos de
  `anchura/2`; si no, `camino` si es camino; si no, `orilla` si dista menos de `anchura/2 + 2`; si no, `tierra`.
- Las celdas de camino del paisaje salen de rasterizar cada polilínea avanzando un eje cada vez (fila unida por
  los lados, sin saltos en diagonal): `celdasDePolilinea` en `juego/cuadricula.ts`.
- `rot` = cuartos de vuelta: la fachada mira al **sur (0), oeste (1), norte (2) o este (3)**. Con `rot` impar se
  intercambian ancho y fondo. `(cx, cz)` es siempre la esquina mínima de la huella ya girada.
- La orilla que se ve cae justo por dentro de `anchura/2`: ninguna celda que el contrato da por `orilla` o
  `tierra` aparece mojada (salvo la del caz del molino, ver abajo).
- El molino tiene la rueda en su costado **este** con `rot = 0`. `sitioMolino()` devuelve el solar del paisaje
  arrimado al río (sin pisar agua) y el `rot` que deja la rueda mirando a la corriente; el terreno abre ahí un
  caz corto para que la rueda toque agua de verdad.

## API pública

```ts
import { crearMundo, type Mundo } from './mundo';

const mundo: Mundo = await crearMundo(document.querySelector('canvas')!, { paisaje: 'valle' });
```

`crearMundo(lienzo: HTMLCanvasElement, opciones?: OpcionesMundo): Promise<Mundo>` carga los GLB y las texturas
y arranca el bucle de dibujo. `OpcionesMundo = { capa?: HTMLElement; pixeles?: number; paisaje?: string; quieto?: boolean }`.

### Paisaje y cuadrícula

```ts
cargarPaisaje(clave: string): void                 // 'valle' | 'ribera' | 'montana' | 'bosque' (vacía lo colocado)
paisaje(): string
datosPaisaje(): Paisaje                            // la entrada de paisajes.yaml
celdaAMundo(cx: number, cz: number): { x: number; z: number }   // centro de la celda, en metros
mundoACelda(x: number, z: number): { cx: number; cz: number }
alturaEn(x: number, z: number): number             // suelo o, sobre el puente, su tablero
tipoCelda(cx: number, cz: number): 'tierra' | 'agua' | 'orilla' | 'puente' | 'camino'
ocupante(cx: number, cz: number): string | undefined   // id del edificio que ocupa la celda (los caminos no ocupan)
caminoEn(cx: number, cz: number): string | undefined    // id de la celda de camino puesta ahí
sitioMolino(): { cx: number; cz: number; rot: number }
```

### Edificios

```ts
ponerEdificio(d: { id: string; clave: string; cx: number; cz: number; rot?: number }): boolean
quitarEdificio(id: string): boolean
vaciarEdificios(): void
edificios(): Required<DatosEdificio>[]
vistaPrevia(v: { clave: string; cx: number; cz: number; rot?: number; valido: boolean } | null): void
celdaPuerta(id: string): [number, number] | null
celdaBajoPuntero(evento: { clientX: number; clientY: number }): { cx: number; cz: number } | null
objetoBajoPuntero(evento: { clientX: number; clientY: number }): { tipo: 'edificio' | 'figura'; id: string } | null
```

- `clave` es la del catálogo (`edificios.yaml`); el constructor 3D se elige por su `modelo`.
- La escena **no valida** (ni coste, ni solapes, ni agua): eso es cosa del motor. Solo dibuja lo que se le pide.
- Las piezas de arrastre (`muralla`, `empalizada`, `murete`, `valla`) se enlazan solas con las vecinas de su
  misma clave al ponerlas y al quitarlas; una pieza suelta se dibuja como un tramo corto (de este a oeste, o de
  norte a sur con `rot` impar). `camino` no tiene bulto: lo pinta el terreno, enlazado con los caminos vecinos
  y con el camino real del paisaje. `arbol` planta un árbol en la vegetación instanciada.
- Al colocar un edificio se despeja la vegetación de su huella (y vuelve al quitarlo), se pinta el suelo
  pisado o labrado y se encienden su humo y sus luces.
- `vistaPrevia` dibuja el fantasma verde (`valido: true`) o rojo sobre la huella; `null` lo quita. Para las
  piezas de arrastre el fantasma ya sale enlazado con lo que haya alrededor.
- `objetoBajoPuntero` devuelve lo primero que toca el puntero: figura, edificio o, si no hay bulto (caminos,
  campos), el edificio de esa celda.

```ts
// Fase 2: colocar con vista previa
lienzo.addEventListener('pointermove', (e) => {
  const c = mundo.celdaBajoPuntero(e);
  mundo.vistaPrevia(c ? { clave: 'casa', cx: c.cx, cz: c.cz, rot, valido: mundo.tipoCelda(c.cx, c.cz) !== 'agua' } : null);
});
lienzo.addEventListener('pointerup', (e) => {
  if (mundo.camara.huboArrastre()) return;          // fue un arrastre de cámara, no un clic
  const c = mundo.celdaBajoPuntero(e);
  if (c) mundo.ponerEdificio({ id: crypto.randomUUID(), clave: 'casa', cx: c.cx, cz: c.cz, rot });
});
```

### Figuras y animales

```ts
ponerFigura(d: { id: string; nombre: string; oficio: string; esSenor?: boolean }): void
colocarFigura(id: string, cx: number, cz: number): void      // sin andar
moverFigura(id: string, cx: number, cz: number): boolean     // anda hasta allí; avisa con el evento 'llegada'
mirarFigura(id: string, cx: number, cz: number): void
posicionFigura(id: string): { x; y; z; cx; cz; andando } | null
decir(id: string, texto: string, segundos?: number): void    // bocadillo HTML sobre la figura (5 s por defecto)
quitarFigura(id: string): void
vaciarFiguras(): void
ponerAnimales(tipo: 'gallina' | 'oveja' | 'perro', cx: number, cz: number, n: number, radio?: number): void
vaciarAnimales(): void
vaciar(): void                                               // edificios, figuras y animales
```

- Oficios con atuendo propio: `molinero, panadera, herrero, tabernero, cura, escriba, curandera, pastor,
  lenador, viuda, mozo, forastero, guardia, cantero, labrador, labradora, mercader`. Cualquier otro recibe ropa
  de aldeano estable según su `id`. `esSenor: true` da capa, corona y cetro.
- `moverFigura` busca ruta por la cuadrícula (A*): el camino y el puente cuestan 1; el campo, 2,6; la orilla, 3;
  el agua y las celdas ocupadas no se pisan (salvo la de destino). Si no hay ruta, va en línea recta.
- Los animales deambulan a `radio` metros (2,6 por defecto) de su celda y no entran en el agua.
- Los bocadillos usan la clase `.bocadillo` de `ui/estilo.css` y cuelgan de `#capa-mundo`.

```ts
mundo.ponerFigura({ id: 'roi', nombre: 'Roi o Muiñeiro', oficio: 'molinero' });
mundo.colocarFigura('roi', 30, 24);
mundo.moverFigura('roi', 23, 27);
mundo.alCambiar('llegada', ({ id }) => id === 'roi' && mundo.decir('roi', '¡Buenos días nos dé Dios!', 4));
```

### Hora, clima y estación

```ts
fijarHora(hora: number | null): void          // hora decimal local (0–24); null = la real
fijarClima(tipo: TipoClima | null): void      // 'despejado' | 'nubes' | 'lluvia' | 'niebla' | 'tormenta' | 'nieve'; null = real
fijarFecha(fecha: Date | null): void          // para la estación y la altura del sol; null = hoy
fijarEstacion(estacion: Estacion | null): void // 'primavera' | 'verano' | 'otono' | 'invierno'; null = la de la fecha
hora(): number
fecha(): Date
estacion(): Estacion
clima(): { tipo; origen: 'real' | 'simulado' | 'fijado'; temperatura: number | null; fijado: TipoClima | null }
astros(): { solAltura; solRumbo; lunaAltura; lunaRumbo; lunaFase }   // grados; rumbo 0 = norte, 90 = este
```

Para «adelantar días» (Fase 2) basta con `fijarFecha(new Date(Date.now() + desfase * 86400000))`.

### Avisos, medidas y cámara

```ts
alCambiar(evento, fn): () => void     // devuelve la función para dejar de escuchar
// 'hora'     → { hora: number; fecha: Date }      (una vez por minuto de reloj)
// 'clima'    → { tipo; origen }
// 'estacion' → { estacion }
// 'paisaje'  → { clave }
// 'llegada'  → { id }                              (una figura llegó a su destino)
info(): { fps; llamadas; triangulos; geometrias; texturas; pixeles; edificios; solAltura }
camara.fijar(pose: Partial<{ x; z; azimut; elevacion; distancia }>, yaMismo?: boolean): void
camara.pose(): PoseCamara
camara.huboArrastre(): boolean
asentar(fotogramas?: number): Promise<void>
destruir(): void
```

Cámara: arrastrar para desplazarse; botón derecho, central o Mayús + arrastrar para girar e inclinar; rueda,
dos dedos en vertical o pellizco para acercar; dos dedos en horizontal para girar; flechas/WASD, Q/E y +/−.
Elevación entre 8° y 80°, distancia entre 12 y 175 m; el objetivo no sale del valle y la cámara no baja del suelo.

## Cómo añadir un constructor de edificio

1. Añade la entrada al catálogo (`mundo/datos/edificios.yaml`) con su `modelo`.
2. En `src/escena/edificios.ts`, escribe el constructor y regístralo en `CONSTRUCTORES` con ese `modelo`:

```ts
const palomar: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);          // c.ancho y c.fondo: huella en metros con rot = 0
  o.cil(1.2, 1.3, 3.2, 0, -0.3, 0, C.piedra, { mat: 'piedra', lados: 10 });   // torre de piedra del pack
  o.tejadoRedondo(1.7, 1.6, 0, 2.9, 0, { abomba: 0.4 });                       // tejado de paja
  o.con(0, 0, 1.25, 0, () => o.puerta(0, 0.8, 1.6, { arco: true }));           // fachada: plano local z = 0
  o.marca('humo', 0, 4.6, 0, 0.5);               // de aquí saldrá humo ('fuego' y 'luz' igual)
  return o.grupo();                              // centrado en la huella, apoyado en y = 0, fachada al sur (+z)
};
export const CONSTRUCTORES = { /* … */ palomar };
```

El taller (`src/escena/taller.ts`) da las piezas: `caja`, `cil`, `cono`, `bola`, `viga` (entre dos puntos),
`tejado` (paja abombada o pizarra, con hastiales y caballete), `tejadoRedondo`, `entramado`, `ventana`,
`puerta`, `chimenea`, `glb` (un modelo del pack), `marca`, `vivo` (objeto que se mueve y no se hornea) y
`con(x, y, z, ry, fn)` para trabajar en el plano de una fachada. El color va por vértice (material «pintura»);
con `mat: 'piedra' | 'pizarra' | 'ladrillo' | 'madera' | 'tabla' | 'roca'` la pieza usa esa textura del pack.
`luz: 1` hace que una pieza brille de noche (ventanas, faroles) y `luz: 2`, siempre (brasas).
`casa(o, {...})` levanta un cuerpo de entramado completo (zócalo, vigas, ventanas, puerta, tejado).

Lo que devuelve el constructor se **hornea**: sus mallas se reparten en lotes por material
(`THREE.BatchedMesh`) y se reutilizan como plantilla (tres variantes por `modelo`, según el `id`). Solo quedan
como objetos sueltos los marcados con `o.vivo(...)`; si llevan `userData.giro = { eje, vel }` giran solos
(la rueda del molino) y si son un `InstancedMesh` con `userData.pegarAlSuelo`, cada instancia se asienta en el
terreno (las espigas). Los constructores reciben la estación (`c.estacion`, `c.paleta`): al cambiar, se rehacen.

## Cómo enchufar un GLB

1. Deja el pack en `assets/` y ejecuta `node herramientas/optimizar-modelos.mjs`: escribe
   `juego/public/modelos/<nombre>.glb` (texturas WebP de 512 px) y lo apunta en `manifiesto.json`. El juego
   carga al arrancar todo lo que haya en el manifiesto.
2. Para **sustituir un constructor entero**, añade el `modelo` a `GLB_POR_MODELO` en `src/escena/modelos.ts`:

```ts
export const GLB_POR_MODELO: Record<string, AjusteGLB> = {
  choza: { glb: 'stylized_hut01', relleno: 0.98, marcas: [{ tipo: 'humo', pos: [1.13, 7.05, -0.59], valor: 0.8 }] },
  casa: { glb: 'house_a', cuartos: 1, relleno: 0.9 },      // ← así se enchufaría una casa de un pack nuevo
};
```

   `cuartos` gira el modelo para que su fachada mire al sur; `relleno` es la fracción de la huella que ocupa
   (se escala solo); `escala` fija la escala a mano; `desplaza` lo mueve tras centrarlo; `marcas` (en las
   coordenadas originales del modelo) dice de dónde sale humo o dónde hay luz. Si el GLB falta, se usa el
   constructor procedural de `CONSTRUCTORES`, que sigue ahí.
3. Para usar un GLB **como pieza** dentro de un constructor: `o.glb('barrel03', x, y, z, { ry, esc })`, o
   `pieza(o, 'ea_cabana', x, z, { ancho, ry })`, que lo centra por su caja, lo escala a un ancho y devuelve
   sus medidas.

### Piezas de EmaceArt (`ea_*`)

El segundo pack trae pocos edificios enteros, todos de troncos, así que no sustituye a los constructores:
se mezcla con ellos. Cada `modelo` tiene tres plantillas (`c.variante` = 0, 1 o 2, según el `id` del
edificio) y `conPack(c, 'ea_…')` dice si a esta le toca la del pack (la 2, y solo si el GLB está cargado):
uno de cada tres graneros, pozos, torres y leñeras sale de EmaceArt; la cabaña del leñador, siempre. Si
falta el pack, todo vuelve a ser geometría propia sin tocar nada.

Las casas y las casas grandes tienen **dos** plantillas del pack de cada tres. La 2 es un edificio entero
(cabaña de troncos, casa larga). La 1 (`conPiezas(c)`) se monta con `casaDePiezas(o, x, z, {...})` a partir
de los muros de entramado y los tejados de paja sueltos: se le dice qué muro va en cada lado (`sur`, `norte`,
`oeste`, `este`), cuántos `pisos` y qué `tejado`, y ella estira los muros para cerrar la planta, pone el
zócalo de piedra y mete dentro un cajón oscuro que de noche da luz por puertas y ventanas.

El **cuartel** (`modelo: cuartel`, huella de 4 × 3 celdas) sigue la misma idea: una casa larga al fondo y,
delante, el patio de armas cercado de estacas con su entrada, el astillero de lanzas, el estafermo, la diana,
el pendón en el hastial, un farol de pared y el brasero de la guardia (`o.marca('fuego', …)`). La plantilla 0
es de piedra con tejado de pizarra, la 2 de piedra con paja y la 1 (`conPiezas`) monta la casa con los muros
y el tejado largo de EmaceArt; el barril, el cajón y el saco son `ea_*` si están cargados y procedurales si no.

- La lista de piezas que se convierten está en `EMACEART`, dentro de `herramientas/optimizar-modelos.mjs`
  (nombre `ea_…` → archivo del pack). Solo van las que el juego usa: todo lo del manifiesto se carga al arrancar.
- Comparten un material, «EA_Paleta» (paleta de 32 px, sin suavizar ni mipmaps), que `TINTES` calienta un poco.
- Los edificios enteros no traen ventanas que se enciendan: de noche se les pone un farol (`farolPared`) y
  humo (`o.marca('humo', …)`). Las casas montadas por piezas sí dan luz por sus huecos.
- `node herramientas/galeria-modelos.mjs assets/emaceart-glb <salida> [regex]` dibuja hojas de miniaturas con
  nombre y medidas; `node herramientas/inspeccionar-glb.mjs <carpeta>` lista medidas, triángulos y materiales.
- La vista previa al construir enseña siempre la plantilla 0; lo construido puede salir en la del pack.

Los materiales del pack se unifican por nombre (todas las piezas «WoodPlank03» comparten material y lote), se
les quita lo metálico (no hay mapa de entorno) y algunos se entonan con `TINTES` para casar con la paleta.
El material `Emission_Yellow` (ventanas de la choza) se enciende de noche.

## Luz, estación y clima

- `astros.ts` usa `suncalc` con la latitud, longitud y huso de `config/ubicacion.yaml`: altura y rumbo reales
  del sol y la luna y fase lunar. La estación sale de la fecha y del hemisferio.
- `cielo.ts` deriva de la altura del sol los colores del cielo, la niebla, la luz ambiente y **una sola luz
  con sombras** (el sol de día; de noche, la luna o el claror del cielo). También la bruma del amanecer, la
  hora dorada y cuánto se encienden ventanas y faroles (`GLOBALES.uLuces`).
- `clima.ts` pide el tiempo a Open-Meteo cada veinte minutos (`current=weather_code,temperature_2m`); si no
  responde, o si `ubicacion.yaml` dice `clima: simulado`, tira de una tabla por estación que cambia cada tres
  horas. Cada tipo de clima fija nubes, lluvia, nieve, niebla, tormenta y viento, y la escena transita suave.
- La estación cambia la paleta del suelo, las copas (ocres en otoño, ralas en invierno, flor en primavera),
  las matas, las flores, el trigo y el huerto. La nieve cuaja sobre todo lo que mira al cielo.

## Rendimiento

Todo lo sólido de la aldea (edificios, enseres, figuras, animales) va en un `BatchedMesh` por material: una
aldea entera cuesta una llamada por material y otra en el paso de sombras. Vegetación, lluvia, nieve, humo,
fuego y halos son instancias o partículas animadas en la gráfica. Posprocesado: oclusión ambiental (n8ao a
media resolución), resplandor, desenfoque de maqueta (tilt-shift), viñeta, mapeo de tonos y SMAA.

Medido en un MacBook con Apple M5 (Chrome sin cabeza, Metal), lienzo de 2560 × 1664:

| Vista | Llamadas de dibujo | Triángulos | fps sin límite |
|---|---|---|---|
| Inicio | 82 | 260 mil | 96 |
| Escaparate (186 colocaciones, 16 figuras, 19 animales) | 104–110 | 439 mil | 101 |
| Escaparate con tormenta / nieve | 105–106 | 434–439 mil | 96 |

(Las cifras incluyen el paso de sombras y los del posprocesado.) Si la gráfica no llega a unos 50 fps, la
relación de píxeles baja sola por escalones (`info().pixeles`).

## Interfaz

`ui/estilo.css` define la estética: variables `--pergamino*`, `--tinta*`, `--lacre`, `--oro`, `--verde`,
`--azul`, `--sombra`, `--radio`, `--fuente` y `--fuente-titulo` (serifas del sistema), y las clases base
`.pergamino` (panel), `.pergamino-titulo`, `.subtitulo`, `.etiqueta`, `.nota`, `.fila`, `.columna`,
`.separador`, `.boton` (+ `.activo`, `.boton-lacre`), `.campo`, `.deslizador`, `.reloj`, `.bocadillo` y
`.aviso`. `#interfaz` no atiende al ratón salvo en sus hijos; `#capa-mundo` es para lo que va pegado al mundo.

## Capturas

`node herramientas/capturas.mjs [--prefijo fase2] [--solo a,b] [--toma "nombre=consulta"] [--tomas lista.json]
[--con-ui] [--sin-base] [--consola] [--ancho 1920 --alto 1080 --pixeles 1.5] [--url http://127.0.0.1:5173]`

Usa `puppeteer-core` con el Chrome del Mac (WebGL por Metal; si no, SwiftShader). Si el juego no está servido,
arranca Vite y lo apaga al acabar. Imprime por cada toma fps, llamadas, triángulos y altura del sol.

## Lo que queda pendiente o se puede mejorar

- Personas y animales son formas básicas (no hay modelos en los packs): un cuerpo y dos pies por figura, con
  balanceo al andar; no tienen brazos articulados ni entran en los edificios.
- Los árboles, las casas y casi todos los edificios son geometría propia; del pack se usan la choza, el
  armazón del puesto del mercado, puentes, farol, barriles, cajas, banco, letrero, troncos, escalera, ruedas,
  lápidas, rocas y las texturas de piedra, pizarra, ladrillo y madera.
- La escena no valida la colocación; el fantasma se pinta de verde o rojo según le diga quien la llama.
- Los relámpagos, el viento y las transiciones de clima no se sincronizan con el servidor: son solo visuales.
