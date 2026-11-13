# Sonido

Pedrafonte **no lleva ningún archivo de audio**. El sistema de sonido (`juego/src/sonido/sonido.ts`) está
listo y suena ya, pero todo lo que se oye se genera al vuelo en el navegador (Web Audio): ruido filtrado
para el viento, el río y la lluvia; tonos cortos para pájaros, grillos, campana y efectos de la interfaz.
Sirve para que el valle no esté mudo, no para emocionar a nadie.

El navegador no deja sonar nada hasta que se pulsa algo: el sonido empieza apagado y se enciende con el
botón **Sonido** de la botonera.

## Cómo está montado

Tres canales con su volumen: `ambiente`, `musica` y `efectos`.

| Canal | Qué suena hoy (generado) | Cuándo |
|---|---|---|
| ambiente | viento, río | siempre |
| ambiente | lluvia | con lluvia o tormenta |
| ambiente | truenos | con tormenta, de vez en cuando |
| ambiente | pájaros | de día, sin lluvia ni nieve |
| ambiente | grillos | de noche |
| efectos | obra, derribo, sello, monedas, campana, pergamino, «no», voz | al construir, derribar, decidir en el consejo, comerciar, adelantar el día, abrir el pergamino, cuando el motor dice que no, y con cada bocadillo |
| musica | **nada** | hace falta una grabación |

El juego le cuenta al sistema cómo está el valle (`sonido.ambientar({clima, noche, vecinos})`) y este ajusta
las capas solo.

## Cómo poner sonido de verdad

1. Deja los archivos en `juego/public/audio/` (OGG o MP3; mejor OGG).
2. Crea `juego/public/audio/manifiesto.json` diciendo qué archivo corresponde a cada nombre:
   ```json
   {
     "musica.tema": "tema-aldea.ogg",
     "efecto.campana": "campana.ogg",
     "efecto.obra": "martillazos.ogg"
   }
   ```
3. Recarga el juego. Cada nombre que aparezca en el manifiesto **sustituye** a su versión generada; lo que
   no aparezca sigue generándose. No hay que tocar código.

Hoy el manifiesto admite `musica.<pista>` (en bucle; el juego pide `tema`) y `efecto.<nombre>`. Las capas
de ambiente (viento, río, lluvia…) todavía son siempre generadas: sustituirlas por grabaciones en bucle es
el siguiente paso natural y está apuntado abajo.

## Lo que haría falta

Todo libre de derechos o con licencia que permita usarlo en el juego. Yo no he descargado nada.

### Música (suave, en bucle, sin protagonismo)
| Nombre | Qué es | Duración |
|---|---|---|
| `musica.tema` | Tema de la aldea de día: laúd o arpa, flauta dulce, algo de zanfona. Tranquilo, con aire gallego | 2–3 min en bucle limpio |
| `musica.noche` | Variante nocturna: más lenta, solo arpa o laúd | 2 min |
| `musica.invierno` | Variante de invierno, más desnuda | 2 min |
| `musica.fiesta` | Para los días de fiesta: gaita, pandereta y tamboril | 1–2 min |
| `musica.tension` | Para revuelta o amenaza: tambor grave y bordón | 1 min |

### Ambiente (bucles de 30–60 s sin costura)
| Nombre | Qué es |
|---|---|
| `ambiente.rio` | Río manso sobre piedras |
| `ambiente.viento` | Viento en árboles (una versión suave y otra de temporal) |
| `ambiente.lluvia` | Lluvia sobre paja y hojas (fina y fuerte) |
| `ambiente.pajaros` | Pájaros de mañana: mirlo, petirrojo, gorriones |
| `ambiente.noche` | Grillos, alguna lechuza, un perro lejos |
| `ambiente.aldea` | Murmullo de aldea: gallinas, martillo lejano, voces sin palabras (más fuerte cuantos más vecinos) |
| `ambiente.hoguera` | Crepitar de la lumbre |
| `ambiente.molino` | Rueda de molino y agua |
| `ambiente.taberna` | Jarras, risas y murmullo (al anochecer, si hay taberna) |

### Efectos (cortos, menos de 2 s)
| Nombre | Qué es |
|---|---|
| `efecto.obra` | Tres martillazos sobre madera |
| `efecto.derribo` | Maderas que caen |
| `efecto.sello` | Sello de lacre sobre pergamino |
| `efecto.monedas` | Bolsa de monedas |
| `efecto.campana` | Campana de aldea (al cerrar el día) |
| `efecto.pergamino` | Pergamino que se desenrolla |
| `efecto.no` | Negativa discreta (un golpe sordo de madera) |
| `efecto.voz` | Murmullo breve, sin palabras (varias variantes, hombre y mujer) |
| `efecto.gallo` | Gallo, al amanecer |
| `efecto.lobo` | Aullido lejano, con el aviso de lobos |
| `efecto.trueno` | Trueno |
| `efecto.oveja`, `efecto.gallina`, `efecto.perro` | Animales, de vez en cuando cerca de sus corrales |

## Pendiente en el código
- Que las capas de ambiente puedan sustituirse por grabaciones del manifiesto (hoy solo música y efectos).
- Sonido con posición: que el río suene más al acercar la cámara al río, y la taberna junto a la taberna.
- Deslizadores de volumen por canal en la interfaz (el código ya tiene `sonido.volumen(canal, valor)`).
- Elegir la pista de música según hora, estación, fiesta o revuelta.
