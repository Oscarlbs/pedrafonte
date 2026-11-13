# API del mundo

El servidor del mundo (`mundo/`, FastAPI) escucha en `http://127.0.0.1:8765`. El juego le habla por `/api`
(REST, JSON) y `/ws/{aldea_id}` (WebSocket). En desarrollo, Vite hace de puente (`/api` y `/ws`).

Errores: `409` con `{"detail": "motivo en castellano"}` cuando el motor dice que no se puede (falta madera,
hay río, la petición ya está resuelta…); `404` si la aldea o el vecino no existen; `422` si el cuerpo no vale.

## General

| Método y ruta | Qué hace |
|---|---|
| `GET /api/salud` | `{ok, motor_ia}` |
| `GET /api/config` | Catálogo de edificios, paisajes, dificultades, tonos, leyes, impuestos, ubicación |
| `GET /api/clima` | Clima de ahora en la ubicación del señor (real de Open-Meteo, o simulado) |

## Aldeas

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `GET /api/aldeas` | — | Lista de aldeas |
| `POST /api/aldeas` | `{nombre, paisaje, tono, dificultad}` | Funda una aldea nueva |
| `DELETE /api/aldeas/{id}` | — | Abandona una aldea (no deja borrar la última) |
| `GET /api/aldeas/{id}` | — | **Estado completo** (ver abajo). Antes pone la aldea al día |
| `POST /api/aldeas/{id}/adelantar` | — | Adelanta un día: `{resumen: {horas, dias}, estado}` |
| `POST /api/aldeas/{id}/reiniciar` | — | Empieza de cero en el mismo sitio (mismo id, nombre, paisaje, tono y dificultad): `{estado}` |

### Estado completo
```
aldea      {id, nombre, paisaje, tono, dificultad, dia, perdida}
tiempo     {dia, hora, instante, fecha, fecha_texto, estacion, estacion_texto, franja, desfase_dias, fiesta}
clima      {tipo, temperatura, origen: real|simulado, descripcion}
recursos   {grano, madera, piedra, oro, harina, pan}
poblacion  {vecinos, plazas, sin_techo, animo, animo_texto, opinion, opinion_texto, dias_comida}
gobierno   {impuestos, impuestos_nombre, leyes[], tension, revuelta, defensa, amenaza, peste, alianzas[],
            promesas[], perdida, motivo_perdida}
edificios  [{id, clave, cx, cz, rot, dia}]
aldeanos   [{id, clave, nombre, apodo, oficio, oficio_nombre, genero, color, animo, opinion, salud, hambre,
             dinero, casa_id, trabajo_id, sitio: {cx, cz, actividad, actividad_texto, lugar, edificio_id}}]
balance    último cierre de día: producido, gastado, comido, hambrientos, oro, llegan, se_van, neto…
consejo    peticiones abiertas: [{id, titulo, texto, peticionario_id, opciones: [{clave, texto, pista, coste, disponible}]}]
mensajes   cartas de vecinos sin contestar (misma forma de opciones)
visitantes [{id, tipo, nombre, descripcion, noticia, ofertas: [{clave, texto, coste, quedan}], cx, cz, color}]
vecinos    [{clave, nombre, senor, caracter, relacion, relacion_texto}]
escenas    últimas escenas: [{id, dia, hora, lugar, cx, cz, tema, participantes[], dialogo: [{quien, texto}]}]
pergamino  {pendiente, dia}
```

## Construir

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `POST …/construir` | `{clave, cx, cz, rot}` o `{clave, celdas: [[cx, cz]…], rot}` | Construye (o una fila, al arrastrar). `{construidos, fallos, recursos}` |
| `POST …/comprobar` | `{clave, cx, cz, rot}` | Vista previa: `{valido, motivo}` |
| `POST …/derribar` | `{id}` | Derriba y devuelve media madera y piedra |
| `POST …/girar` | `{id}` | Gira un cuarto de vuelta si cabe |

## Vecinos

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `GET …/aldeanos/{id}` | — | Ficha: carácter, objetivo, ánimo, relaciones, recuerdos recientes (el secreto, solo si lo confesó) |
| `POST …/aldeanos/{id}/charla` | `{texto}` | Hablar con él: `{respuesta, revelado, ficha}` |
| `GET …/escenas` | — | Últimas escenas |
| `GET …/sucesos` | — | Bitácora |

## Gobierno

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `POST …/consejo/{peticion_id}` | `{opcion}` | Decide una petición: `{peticion, estado}` |
| `POST …/impuestos` | `{nivel: 0–4}` | Fija los tributos |
| `POST …/leyes` | `{clave, activa}` | Promulga o deroga una ley |
| `GET …/pergamino` | — | Crónica del último día: `{cronica: {dia, fecha, texto, opiniones[]}, leido}` |
| `POST …/pergamino/leido` | — | Marca el pergamino como leído |
| `GET …/cronicas` | — | Crónicas anteriores |
| `POST …/perdon` | — | Si os han echado: pedir perdón y volver (con el arca vacía) |

## Mundo exterior

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `POST …/mensajes/{id}` | `{opcion}` | Contesta la carta de un señor vecino |
| `POST …/visitantes/{id}/comerciar` | `{oferta}` | Cierra un trato con un mercader o viajero |

## Tutorial

El estado completo trae `tutorial`. Si hay lección en curso:

```
tutorial   {activo: true, oculto, paso, total, clave, capitulo, capitulo_n, capitulos, titulo, texto, como,
            manual, boton, premio}
```

`manual: true` es una lección de leer, que se cumple con «Entendido»; las demás las da por cumplidas el
motor cuando se cumple su condición (al pedir el estado). `boton` dice qué botón conviene señalar:
`construir`, `consejo`, `vecinos`, `leyes`, `mapa`, `tropas`, `adelantar`. `premio` son recursos.
Si no hay lección: `{activo: false, terminado, total}` (y `final`, la despedida, si se acabó).

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `POST /api/aldeas/{id}/tutorial` | `{orden}` | `entendido`, `ocultar`, `mostrar`, `saltar` o `empezar` (de nuevo, desde la primera): `{estado}` |

Al cumplirse una lección sale por el WebSocket un evento `tutorial` con `{clave, titulo, premio}`.

## La comarca: mapa, hueste y guerra

El estado completo trae `guerra`: `{titulo, dominios, tropas, fuerza, campana: {nombre, fase, dias} | null,
asedio, vasallo_de}` y, en `gobierno`, `defensa_partes: {torres, muros, leyes, alianzas, extra, tropas}` y
`amenaza: {clave, nombre, dias, fuerza}` (`clave` puede ser, además de bandidos, lobos y peste, `mesnada`
—la que manda un vecino al que se le niega un pago—, `hueste` o `asedio`).

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `GET /api/aldeas/{id}/mundo` | — | El mapa (ver abajo). Con `?mapa=1` cuenta para el tutorial como «abrir el mapa»; el panel de la hueste lo pide sin él |
| `POST /api/aldeas/{id}/tropas` | `{unidad, cantidad}` | Alista: `milicia`, `lanceros`, `arqueros` o `jinetes` |
| `POST /api/aldeas/{id}/tropas/licenciar` | `{unidad, cantidad}` | Manda a casa |
| `POST /api/aldeas/{id}/mundo/{clave}` | `{accion}` | Embajada: `regalo` (10 de oro), `alianza`, `exigir` (tributo sin batalla), `liberar`, `rescate` |
| `POST /api/aldeas/{id}/campana` | `{vecino, objetivo, tropas: {lanceros: 8, …}}` | Sale la hueste a `saquear`, `someter` o `conquistar` |

Las cuatro de escribir devuelven `{mundo, estado}` (la embajada, además, `texto` con lo que pasó).

```
mundo.aldea        {nombre, pos: [x, y], titulo, dominios, vasallo_de, defensa, defensa_partes}
mundo.territorios  [{clave, nombre, senor, caracter, tipo, pos: [x, y], relacion, relacion_texto,
                     estado: libre | vasallo | conquistado, aliado, hostil,
                     fuerza, fuerza_exacta, defensa, riqueza, dias, tributo, tributo_posible, refuerzos,
                     acciones: [...]}]
mundo.caminos      [[clave, clave], …]   («aldea» es la del señor)
mundo.tropas       {milicia, lanceros, arqueros, jinetes}   (las que están en casa)
mundo.fuerza       fuerza de esas tropas en campo abierto
mundo.cupos        {sueldo, sueldo_usado, milicia, milicia_usada}
mundo.unidades     [{clave, nombre, plural, descripcion, coste, sueldo, fuerza, en_muro, requiere, disponible, falta}]
mundo.objetivos    {saquear | someter | conquistar: {nombre, descripcion, umbral, muros}}
mundo.campana      {vecino, nombre, objetivo, tropas, fase: ida | vuelta, dias, refuerzos, victoria, texto, botin} | null
mundo.amenaza      {vecino, nombre, fuerza, dias} | null      (una hueste que viene)
mundo.asedio       {vecino, fuerza, dias} | null
mundo.partes       [{dia, vecino, nombre, objetivo, victoria, texto, bajas, botin}]   (los últimos, el más reciente primero)
mundo.paz_hasta    días que faltan para que puedan venir huestes y cartas de amenaza (0 si ya pueden)
mundo.moral        con qué ánimo pelea la hueste (0,8–1,15): multiplica su fuerza en batalla
mundo.precios      {regalo, relacion_alianza, rescate}
```

- `pos` va de 0 a 100 en los dos ejes (x hacia el este, y hacia el sur). `tipo`: `aldea`, `torre`, `abadia`,
  `villa`, `puerto`, `castillo`, `burgo`.
- `fuerza` de un territorio libre es lo que cuentan los pastores (de cinco en cinco y por lo alto); la de
  vasallos y aliados es exacta (`fuerza_exacta`). `refuerzos` es lo que vasallos y aliados mandarían a una
  campaña contra ese territorio.
- En batalla pesa `(fuerza enviada + refuerzos) × moral`, con un ±15 % de suerte, contra
  `(fuerza + defensa × objetivos[o].muros)` del territorio, con un ±10 %; se gana si la razón llega a `umbral`.
- La batalla se da al llegar (`dias` de marcha) y el botín y los supervivientes entran al volver. Mientras
  tanto, lo enviado no defiende la aldea.
- Eventos por el WebSocket: `guerra` (`accion`: `recluta`, `sale`, `batalla`, `vuelve`, `rebelion`) y
  `amenaza` (`clave`: `hueste` o `asedio`).

## En directo: `/ws/{aldea_id}`

El servidor manda `{"eventos": [...]}` cada vez que pasa algo. Cada evento lleva `tipo`:

| tipo | Campos | Cuándo |
|---|---|---|
| `hora` | `dia, hora` | Cada hora de juego |
| `escena` | `id, lugar, cx, cz, tema, participantes[], dialogo[]` | Dos a cuatro vecinos coinciden y hablan |
| `suceso` | `clase, texto, dia, hora` | Cualquier anotación de la bitácora |
| `edificio` | `accion: construido|derribado|girado, edificio|id` | Obras |
| `aldeano` | `accion: llega|se_va, id` | Llegadas y marchas |
| `consejo` | `peticiones` | Hay peticiones nuevas |
| `mensaje` | `id, clase, remitente` | Carta de un vecino |
| `visitante` | `accion, id, nombre` | Llega o se va un visitante |
| `cierre` | `dia, balance` | Se cierra el día |
| `cronica` | `dia` | El escriba ha terminado el pergamino |
| `amenaza` | `clave, aviso` | Aviso o golpe de bandidos, lobos o peste |
| `revuelta` / `perdida` | `activa` / `motivo` | Revuelta y derrota |

El cliente puede mandar cualquier texto como latido; el servidor no espera nada.
