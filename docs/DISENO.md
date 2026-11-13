# Pedrafonte · Documento de diseño

Este documento tiene dos partes: **el juego**, con lo que incluye cada fase, y **el diseño técnico**.

---

## Parte I · El juego

Un juego medieval de cuento en 3D llamado Pedrafonte, con aldeanos de IA.

### Tecnología
- Juego: Vite + TypeScript + Three.js, en el navegador del Mac. Objetivo: 60 fps en un MacBook Air M5.
- Mundo: Python, FastAPI, SQLAlchemy + Alembic y WebSocket para lo que pasa en directo. PostgreSQL con
  Docker; si Docker no está arrancado, SQLite en local y PostgreSQL para el despliegue.
- Desde el primer día, todas las tablas llevan identificador de aldea, porque habrá varias.
- IA con dos motores intercambiables por variable de entorno: `simulado` (plantillas y azar, sin coste) y `claude` (API real, con modelo configurable y tope de gasto diario en el código). El juego
  entero debe funcionar con el simulado.

### Principio central
**El motor decide y la IA interpreta.** La IA nunca cambia el estado: propone cambios en JSON, y el motor
los valida y los aplica. Lo que no valide se rechaza y se registra.

### Comprobaciones
- Tests automáticos para el validador, la economía, los rumores y el consejo. En verde antes de cerrar cada fase.
- Al cerrar cada fase: arrancar el juego, sacar capturas automáticas y guardarlas en `docs/capturas/`.

### El juego
- Lugar: un valle con río, puente y molino, visto como una maqueta sobre una base flotante. Cámara en
  diagonal desde arriba con giro, zoom y desplazamiento, con límites para no salir del valle.
- Estilo: de cuento, con casas rechonchas de entramado y tejado de paja, muritos, pozo, vallas y mucho
  detalle. Si existe `assets/referencia.png`, se usa como guía; si no, esta descripción.
- Luz, estación y clima reales según la ubicación (archivo de configuración; ahora Vigo, España): niebla al
  amanecer, mediodía luminoso, atardecer dorado y noche con ventanas encendidas, farolillos y luna. Clima
  desde una API gratuita y sin clave; si no hay ninguna fiable, clima simulado.
- Ritmo: a hora real, con un botón para adelantar días.
- Inicio: desde cero, con un claro vacío, una choza, una hoguera y cuatro colonos.
- El jugador es el señor, con casa y figura propias.
- Riesgo moderado: hambre o revueltas si gobierna mal, pero cuesta perder.
- Tono de la primera aldea: cuento amable con retranca, en castellano con algún giro antiguo. Todo ficticio,
  sin personas reales y sin contenido explícito.

### Fase 1 · Escena
- Modelos: `glb.zip` y `Texture.zip` de EmaceArt y el pack "Medieval Stylized
  Assets". Moverlos a `assets/`, descomprimir cada pack en su carpeta e inventario en `docs/INVENTARIO.md`.
- Leer las licencias y resumirlas en `docs/LICENCIAS.md`.
- Si los modelos pesan mucho, fuera de git y explicar cómo recuperarlos.
- Dos vistas con botón: "Inicio" (claro, choza, hoguera y colonos) y "Escaparate" (aldea de muestra con todos
  los edificios disponibles, plaza con pozo, vallas, muros, barriles y árboles).
- Humo en las chimeneas, agua en movimiento, sombras suaves, oclusión ambiental y desenfoque ligero del fondo.
- Deslizador de hora y selector de clima para previsualizar.
- Si falta algún tipo de modelo (aldeanos, animales), figuras sencillas con formas básicas.

### Fase 2 · Construir y economía
- Colocar, girar y derribar edificios, caminos, muros y campos sobre una cuadrícula invisible, con vista
  previa antes de soltar.
- Recursos: grano, madera, piedra y oro. Catálogo de edificios en YAML con coste, efecto y requisitos.
- Cadenas de producción (campo, molino, panadería), vivienda, población y cosechas según la estación.
- Barra superior con recursos, población y fecha. Guardado del estado en el servidor del mundo.

### Fase 3 · Aldeanos con IA
- Ficha de cada aldeano: oficio, carácter, objetivo, secreto y dinero. Relaciones numéricas entre pares,
  recuerdos con importancia y rumores que se deforman al pasar de uno a otro.
- Rutinas diarias andando por los caminos. Cuando coinciden de 2 a 4, hay escena: una sola llamada a la IA
  por escena.
- De noche, reflexión por aldeano agrupando varios por llamada.
- Director de drama: si la tensión lleva dos días baja, saca un suceso de una tabla editable en YAML.
- En pantalla: figuritas andando, bocadillos con lo que se dicen, ficha al pinchar (quién es, ánimo,
  relaciones y recuerdos recientes), y animales y detalles: gallinas, ovejas, perros, ropa tendida.
- Hablar con cualquier aldeano escribiendo; contesta en su papel con lo que sabe y lo que calla.
- Doce aldeanos de partida en un YAML editable: molinero, panadera, herrero, tabernero, cura, escriba,
  curandera, pastor, leñador, viuda con tierras, mozo huérfano y un forastero. Conflicto garantizado: cada
  secreto afecta a otro, dos rivalidades, una deuda vieja y un amor escondido.

### Fase 4 · Gobierno
- Consejo diario: dos o tres peticiones nacidas del estado real de la aldea, con opciones y consecuencias que
  aplica el motor.
- Impuestos y leyes. Opinión de cada aldeano sobre el señor. Hambre y revueltas con riesgo moderado.
- Al abrir el juego, un pergamino del escriba con la crónica del último día y sus opiniones sobre el gobierno.

### Fase 5 · Mundo exterior
- Dos o tres aldeas vecinas con señores de IA: comercio, bodas, alianzas y amenazas, por mensajes.
- Mercaderes y viajeros que llegan por el camino con mercancías, noticias y líos.
- Fiestas en sus fechas reales, en una lista editable en YAML.
- Bandidos, lobos y peste, con murallas y guardia para defenderse.

### Fase 7 · Tutorial, mapa de la comarca y guerra

Un tutorial integrado en la partida, un mapa de la comarca, empezar desde cero e ir creciendo hasta un
pequeño señorío: conquistar territorios, defenderse, levantar murallas y sufrir ataques de tropas. Detalle en
el apartado 12 de la Parte II.

### Fase 6 · Varias aldeas y despliegue preparado
- Pantalla para crear aldeas eligiendo nombre, paisaje, tono (cuento, crudo, fantasía o comedia) y dificultad.
- Sistema de sonido listo para ambiente y música suave, sin archivos; lista en `docs/AUDIO.md` de lo que haría falta.
- Despliegue con Docker: contenedores sin root, solo lectura, sin capacidades y sin puertos publicados, y
  copia de la base de datos.

---

## Parte II · Diseño técnico

### 1. Estructura del repo

```
aldea/
├─ README.md
├─ arrancar.sh              # levanta PostgreSQL, el mundo y el juego en local
├─ docker-compose.local.yml # solo PostgreSQL local (127.0.0.1:5433)
├─ .env  (fuera de git)  .env.ejemplo
├─ config/ubicacion.yaml    # dónde vive el señor: latitud, longitud, huso (Vigo)
├─ docs/                    # DISENO, INVENTARIO, LICENCIAS, API, AUDIO, capturas/
├─ assets/                  # packs originales y descomprimidos (fuera de git)
├─ herramientas/            # optimizar-modelos.mjs, capturas.mjs
├─ juego/                   # Vite + TypeScript + Three.js
│  ├─ public/modelos/       # GLB optimizados (fuera de git; se regeneran)
│  └─ src/  escena/ juego/ ui/ red/ sonido/
├─ mundo/                   # FastAPI + SQLAlchemy + Alembic
│  ├─ aldea/                # paquete Python: motor/, ia/, api/, modelos.py…
│  ├─ datos/                # YAML editables: edificios, paisajes, aldeanos, sucesos, peticiones,
│  │                        # leyes, fiestas, vecinos, mercaderes, amenazas, tonos
│  ├─ alembic/  tests/
```

### 2. Mapa y coordenadas (contrato compartido entre juego y mundo)

- Cuadrícula invisible de **56 × 56 celdas**; cada celda mide **2 m**. La celda `(cx, cz)` va de 0 a 55.
  Centro del mundo en el centro de la cuadrícula: `x = (cx − 28 + 0,5) · 2`, `z = (cz − 28 + 0,5) · 2`.
  Norte = `z` negativo. La unidad de Three.js es el metro (los modelos del pack vienen en metros).
- El paisaje se define en `mundo/datos/paisajes.yaml`: polilínea del río (en celdas), anchura, celda del puente,
  solar del molino, claro inicial, entrada del camino, manchas de bosque y de roca. **Las dos partes leen el
  mismo archivo**: el mundo calcula con él qué celdas son agua/orilla/bosque (para validar), y el juego dibuja
  el terreno. Regla común: una celda es **agua** si su centro dista del eje del río menos de `anchura/2`;
  **orilla** si dista menos de `anchura/2 + 2` celdas.
- Un edificio ocupa `ancho × fondo` celdas desde su esquina mínima `(cx, cz)`, con giro `rot ∈ {0,1,2,3}`
  (cuartos de vuelta; con rot impar se intercambian ancho y fondo).
  Con `rot = 0` la fachada mira al sur (z creciente); 1, al oeste; 2, al norte; 3, al este.
- Precisiones acordadas al juntar las dos partes: los puntos del río y del camino son **centros de celda** y
  las distancias se miden en celdas; el puente manda sobre el agua y el camino sobre la orilla; las celdas de
  camino de una polilínea se sacan avanzando un solo eje cada vez (sin saltos en diagonal). El mismo
  algoritmo está en `mundo/aldea/motor/mapa.py` y en `juego/src/juego/cuadricula.ts`: si se toca uno, hay
  que tocar el otro.
- Catálogo único en `mundo/datos/edificios.yaml`. Cada entrada: `clave, nombre, categoria, tam [ancho, fondo],
  coste, requisitos, efecto, modelo, descripcion`. El juego elige el constructor 3D por `modelo`.

### 3. Tiempo

- El juego va **a hora real** del huso de `config/ubicacion.yaml`. La fecha del juego es la fecha real más un
  **desfase en días** (lo que se haya adelantado con el botón). Estación, fiestas y luz salen de esa fecha.
- El motor trabaja por **horas** (rutinas, encuentros, escenas) y por **cierre de día** (producción, consumo,
  impuestos, llegadas, reflexión nocturna, director de drama, crónica). Un bucle del servidor comprueba cada
  poco si hay horas pendientes; al arrancar, se pone al día (como mucho 3 días completos; el resto, resumido).
- «Adelantar día» ejecuta de golpe las horas que faltan y el cierre, y suma 1 al desfase.

### 4. Principio central en el código

```
motor (decide)  ──contexto──▶  IA (interpreta)  ──propuesta JSON──▶  validador ──▶ aplicar / rechazar+registrar
```

- `mundo/aldea/ia/base.py` define el contrato `MotorIA`: `escena`, `reflexion`, `charla`, `deformar_rumor`,
  `cronica`, `mensaje_vecino`. Devuelven **solo diccionarios** (texto + lista `cambios`).
- `ia/simulado.py`: plantillas + azar con semilla. `ia/claude.py`: API real con salida estructurada, modelo y
  tope diario de gasto en `mundo/datos/ia.yaml`; si se supera el tope o falla, cae al simulado.
  Se elige con la variable de entorno `ALDEA_MOTOR_IA` (`simulado` por defecto: funciona sin clave ni coste).
- `motor/validador.py`: valida cada `cambio` contra un esquema cerrado y contra el estado. Tipos admitidos:

| tipo | campos | límites |
|---|---|---|
| `relacion` | `a, b, delta` | a≠b, vivos, presentes en el contexto; `|delta| ≤ 15` |
| `recuerdo` | `aldeano, texto, importancia` | presente; texto 3–300 caracteres; importancia 1–10 |
| `rumor` | `origen, sobre, texto` | origen presente; `sobre` existe; texto 8–240 |
| `animo` | `aldeano, delta` | presente; `|delta| ≤ 10` |
| `opinion_senor` | `aldeano, delta` | presente; `|delta| ≤ 10` |
| `dinero` | `de, a, cantidad` | presentes; `1 ≤ cantidad ≤ 20` y ≤ dinero de `de` |
| `tension` | `delta` | `−5 ≤ delta ≤ 10` |

  Cualquier otra cosa (recursos, edificios, muertes, leyes, campos desconocidos, valores fuera de rango,
  aldeanos ausentes) **se rechaza** y se guarda en la tabla `rechazos`. No se recorta: se rechaza.
- Todo lo material (recursos, construcción, población, consejo, impuestos, amenazas) lo calcula solo el motor.

### 5. Modelo de datos (todas las tablas con `aldea_id`)

`aldeas` (id, nombre, paisaje, tono, dificultad, semilla, estado JSON) · `edificios` · `aldeanos` ·
`relaciones` · `recuerdos` · `rumores` + `rumor_copias` (versión que conoce cada aldeano y su grado de
deformación) · `escenas` · `cronicas` · `sucesos` (bitácora) · `peticiones` · `rechazos` · `vecinos` ·
`mensajes` · `visitantes` · `gasto_ia`.

`aldeas.estado` guarda lo escalar: recursos, desfase de días, última hora procesada, impuestos, leyes
activas, tensión e historial, hambre, banderas.

### 6. Economía

- Recursos principales: **grano, madera, piedra, oro**. Despensa derivada: **harina** y **pan**.
- Cadena: campo → grano (según estación y clima) → molino → harina → panadería → pan. Cada aldeano come al
  día 1 pan; si no hay, 1,5 de grano; si tampoco, pasa hambre.
- Los edificios productivos necesitan trabajadores. El motor asigna cada mañana: primero el del oficio
  (rinde al 100 %), luego cualquiera libre (60 %).
- Vivienda: cada casa da plazas. Los doce aldeanos del reparto llegan por orden cuando hay plaza y comida;
  después llegan inmigrantes genéricos.
- Estaciones (según hemisferio de la ubicación): primavera siembra (campo ×0,4), verano cosecha (×1,6),
  otoño (×1,0), invierno (×0,1). El invierno pide leña para la hoguera.
- Riesgo moderado: el hambre baja el ánimo y la opinión; tras varios días alguien enferma o se marcha.
  La revuelta necesita opinión media muy baja y tensión alta sostenidas; perder exige una revuelta larga.

### 7. Aldeanos, escenas, rumores y drama

- Reparto en `mundo/datos/aldeanos.yaml` (doce, con secretos cruzados, dos rivalidades, una deuda y un amor
  escondido). Colonos iniciales: leñador, viuda con tierras, pastor y escriba.
- Rutina por horas según oficio (casa → trabajo → plaza/taberna → casa). El motor calcula el lugar de cada
  uno a cada hora; si coinciden de 2 a 4 en un lugar, puede haber **escena** (una sola llamada a la IA).
  El motor elige el tema (rivalidad, deuda, rumor, hambre, fiesta, tiempo…) y la IA escribe las frases y
  propone cambios pequeños.
- **Rumores**: nacen de secretos y sucesos. Cada aldeano guarda su versión. Al pasar de uno a otro el motor
  decide si pasa (afinidad, carácter) y la IA lo deforma; el validador comprueba que sigue hablando de la
  misma persona. Cada salto sube el grado de deformación.
- **Reflexión nocturna**: por lotes de 4 aldeanos por llamada; resume el día en un recuerdo y ajusta ánimo.
- **Director de drama**: tensión 0–100 calculada cada día. Si lleva dos días por debajo del umbral, saca un
  suceso de `sucesos.yaml` (con condiciones y efectos que aplica el motor).
- **Charla con el señor**: texto libre; el aldeano contesta según carácter, opinión, lo que sabe y su secreto
  (que calla salvo confianza muy alta).

### 8. Gobierno

- **Consejo diario**: 2–3 peticiones generadas por el motor desde `peticiones.yaml`, cada una con condición
  sobre el estado real, peticionario, opciones y efectos. Las no resueltas caducan con su opción por defecto.
- **Impuestos** (0–4) y **leyes** (`leyes.yaml`): modifican oro, producción, ánimo y opinión por oficio.
- **Opinión sobre el señor** por aldeano (−100…100). Hambre y revueltas según lo dicho en economía.
- **Pergamino**: al abrir, crónica del último día escrita por el escriba, con sus opiniones.

### 9. Mundo exterior

- `vecinos.yaml`: tres aldeas con señor y carácter. Mensajes de comercio, boda, alianza y amenaza; el jugador
  responde eligiendo postura. `mercaderes.yaml`: visitantes con mercancía, noticias y líos.
- `fiestas.yaml`: fechas reales (MM-DD) con efectos. `amenazas.yaml`: bandidos, lobos y peste; la defensa
  sale de murallas, torres y guardia.

### 10. El juego (cliente)

- `escena/`: terreno-maqueta, río con shader, cielo y sol/luna reales, clima, modelos del pack, edificios
  procedurales de cuento, vegetación instanciada, humo, posprocesado (oclusión ambiental + desenfoque).
- `juego/`: cuadrícula y construcción, aldeanos (figuras básicas), animales, bocadillos.
- `ui/`: barra superior, menú de construcción, ficha, consejo, pergamino, charla, mensajes, crear aldea.
- `red/`: REST (`/api/...`) y WebSocket (`/ws/{aldea_id}`). `sonido/`: gestor de audio sin archivos.

### 12. Tutorial, comarca y guerra (fase 7)

- **Tutorial** (`motor/tutorial.py`, `datos/tutorial.yaml`): diecinueve lecciones en cuatro capítulos
  (asentarse, crecer, defenderse, el mundo). Cada una tiene una condición sobre las mismas variables que el
  resto de YAML; el motor mira solo la que está en curso y, al cumplirse, da su premio y pasa a la
  siguiente. Lo que no deja huella en el estado (hablar, abrir el mapa) se cuenta en `estado["hechos"]`.
  Solo lo tienen las aldeas nuevas o reiniciadas; se puede ocultar, saltar o empezar de nuevo.
- **Comarca** (`datos/vecinos.yaml`): ocho territorios con señor, sitio en el mapa (0–100), mesnada
  (`fuerza`), muros (`defensa`) y `riqueza`, de menos a más. Lo que cambia (mesnada tras las batallas,
  libre / vasallo / conquistado) va en `Vecino.datos`; no hay tablas nuevas.
- **Guerra** (`motor/guerra.py`, `datos/guerra.yaml`), siempre decidida por el motor:
  - Tropas: milicia (vecinos, uno por cada dos), lanceros, arqueros y jinetes (de sueldo, con cama en un
    cuartel). Cuestan al alistar y cobran cada noche; si no cobran, desertan. La que está en casa suma a la
    defensa, y más tras un muro.
  - Campañas: saquear, someter o conquistar. La batalla se da al llegar (días de marcha según el mapa) y el
    botín y los supervivientes entran al volver; mientras, la aldea se queda sin esa tropa. Vasallos y
    aliados mandan refuerzos.
  - Vasallos: pagan tributo cada noche y se rebelan si dejan de temeros. Una plaza conquistada rinde más y no
    se rebela, pero pide guarnición. Los dominios dan el título: de Señor a Rey de la comarca.
  - Huestes enemigas: desde el día 15, de quien os tiene ojeriza, con aviso de días. Si la defensa aguanta,
    se van y pagan rescate; si hay muros y pan, asedio (se desgastan ellos y se come grano dentro); si no,
    saqueo, y vasallaje si os doblan.
  - Embajadas desde el mapa: presente, alianza, exigir tributo, liberar y comprar la libertad.
- **Reiniciar** (`fundacion.reiniciar`): borra lo de la aldea y la funda otra vez con el mismo identificador.

### 11. Despliegue

Un contenedor para el mundo (sirve también el juego compilado) y otro para PostgreSQL, con
sin root, `read_only`, `cap_drop: [ALL]`, límites de memoria y sin `ports:`.
