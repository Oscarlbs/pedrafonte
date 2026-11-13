// Vista «Escaparate»: una aldea de muestra con TODOS los edificios del catálogo, a los dos lados
// del río, con su plaza, su pozo y el molino en la orilla. Está pensada para el paisaje «valle»
// (sus coordenadas son celdas de ese mapa) y hecha solo con la fachada `Mundo`.
import { CATALOGO } from '../datos';
import type { Mundo } from '../mundo';
import type { Vista } from './vista';
import { colocador } from './vista';

/** [clave, cx, cz, rot]. rot: la fachada mira al sur (0), oeste (1), norte (2) o este (3). */
type Sitio = [string, number, number, number?];

const EDIFICIOS: Sitio[] = [
  // Plaza y su entorno, en la orilla oeste.
  ['pozo', 23, 25],
  ['mercado', 19, 23],
  ['hoguera', 26, 26],
  ['iglesia', 22, 17],
  ['camposanto', 26, 16],
  ['taberna', 15, 24, 3],
  ['escribania', 18, 19],
  ['casa_senor', 12, 16],
  ['panaderia', 28, 25],
  ['botica', 8, 23, 3],
  // Hilera al sur del camino real.
  ['granero', 11, 32, 2],
  ['casa', 15, 32, 2],
  ['casa_grande', 19, 32, 2],
  ['casa', 24, 32, 2],
  ['herreria', 28, 32, 2],
  ['huerto', 15, 36],
  ['gallinero', 19, 36],
  ['tendedero', 22, 36],
  ['campo', 2, 32],
  ['campo', 6, 32],
  ['choza', 6, 26, 3],
  // Orilla este.
  ['casa', 39, 23],
  ['cabana_lenador', 42, 22],
  ['lenera', 45, 25],
  ['redil', 39, 31],
  ['cantera', 42, 35, 2],
  ['torre_guardia', 47, 25],
  ['casa', 41, 26, 2],
];

/** Tramos rectos de piezas de arrastre: [clave, cx0, cz0, cx1, cz1]. */
const TRAMOS: [string, number, number, number, number][] = [
  // La plaza y las callejas son camino.
  ['camino', 19, 26, 22, 28],
  ['camino', 22, 23, 27, 24],
  ['camino', 25, 25, 27, 25],
  ['camino', 23, 27, 25, 28],
  ['camino', 26, 28, 28, 28],
  ['camino', 18, 22, 27, 22],
  ['camino', 12, 21, 17, 21],
  ['camino', 17, 22, 17, 23],
  ['camino', 18, 23, 18, 28],
  ['camino', 11, 21, 11, 24],
  ['camino', 28, 24, 33, 24],
  ['camino', 14, 31, 30, 31],
  ['camino', 38, 28, 38, 28],
  ['camino', 40, 29, 40, 30],
  ['camino', 43, 25, 43, 27],
  // Muritos del atrio de la iglesia.
  ['murete', 21, 16, 21, 21],
  ['murete', 22, 16, 25, 16],
  // Vallas de los campos.
  ['valla', 2, 36, 9, 36],
  ['valla', 10, 32, 10, 36],
  ['valla', 5, 31, 9, 31],
  // Defensas del lado del bosque: muralla junto a la torre y empalizada más allá.
  ['muralla', 47, 22, 47, 24],
  ['muralla', 47, 29, 47, 31],
  ['empalizada', 47, 18, 47, 21],
  ['empalizada', 47, 32, 47, 34],
  ['empalizada', 44, 34, 46, 34],
];

const ADORNOS: Sitio[] = [
  ['farol', 28, 23, 1],
  ['farol', 21, 22],
  ['farol', 31, 30, 2],
  ['farol', 37, 28],
  ['farol', 13, 29, 2],
  ['farol', 44, 27],
  ['banco', 22, 27],
  ['banco', 25, 27, 2],
  ['barriles', 22, 25],
  ['barriles', 14, 28],
  ['barriles', 31, 28],
  ['letrero', 10, 29],
  ['letrero', 37, 30],
  ['arbol', 25, 23],
  ['arbol', 17, 28],
  ['arbol', 12, 30],
  ['arbol', 29, 18],
  ['arbol', 9, 20],
  ['arbol', 41, 20],
  ['arbol', 44, 30],
];

const VECINOS: { id: string; nombre: string; oficio: string; celda: [number, number]; mira: [number, number] }[] = [
  { id: 'senor', nombre: 'El señor', oficio: 'senor', celda: [14, 21], mira: [20, 26] },
  { id: 'molinero', nombre: 'Roi o Muiñeiro', oficio: 'molinero', celda: [31, 24], mira: [28, 27] },
  { id: 'panadera', nombre: 'Sabela', oficio: 'panadera', celda: [29, 28], mira: [26, 28] },
  { id: 'herrero', nombre: 'Mestre Fiz', oficio: 'herrero', celda: [29, 31], mira: [26, 29] },
  { id: 'tabernero', nombre: 'Xoán da Pipa', oficio: 'tabernero', celda: [18, 25], mira: [23, 26] },
  { id: 'cura', nombre: 'Don Rosendo', oficio: 'cura', celda: [23, 22], mira: [23, 26] },
  { id: 'escriba', nombre: 'Frei Lopo', oficio: 'escriba', celda: [19, 22], mira: [23, 26] },
  { id: 'curandera', nombre: 'A Meiga Uxía', oficio: 'curandera', celda: [11, 24], mira: [18, 25] },
  { id: 'pastor', nombre: 'Brais o Pastor', oficio: 'pastor', celda: [40, 30], mira: [41, 32] },
  { id: 'lenador', nombre: 'Xan do Machado', oficio: 'lenador', celda: [43, 26], mira: [46, 26] },
  { id: 'viuda', nombre: 'Dona Aldara', oficio: 'viuda', celda: [21, 27], mira: [24, 26] },
  { id: 'mozo', nombre: 'Paio', oficio: 'mozo', celda: [25, 28], mira: [26, 26] },
  { id: 'forastero', nombre: 'O Forasteiro', oficio: 'forastero', celda: [36, 29], mira: [30, 29] },
  { id: 'guardia', nombre: 'Nuno', oficio: 'guardia', celda: [46, 27], mira: [50, 28] },
  { id: 'labradora', nombre: 'Mariña', oficio: 'labradora', celda: [10, 31], mira: [6, 33] },
  { id: 'cantero', nombre: 'Lois', oficio: 'cantero', celda: [43, 34], mira: [44, 36] },
];

/** Paseos de ida y vuelta para que el escaparate tenga vida: [id, celda A, celda B]. */
const PASEOS: [string, [number, number], [number, number]][] = [
  ['mozo', [25, 28], [38, 28]],
  ['pastor', [40, 30], [30, 28]],
  ['viuda', [21, 27], [23, 22]],
  ['curandera', [11, 24], [20, 28]],
  ['labradora', [10, 31], [17, 31]],
  ['forastero', [36, 29], [19, 28]],
];

const FRASES: [string, string][] = [
  ['tabernero', 'Vino nuevo, verdades viejas.'],
  ['panadera', '¡Hogazas recién hechas!'],
  ['molinero', 'La rueda gira y yo cobro mi maquila.'],
  ['cura', 'El tejado de la iglesia pide limosna…'],
  ['herrero', 'Sin hierro no hay arado, señor.'],
  ['viuda', 'Ese forastero no me da buena espina.'],
  ['escriba', 'Lo que aquí se apunta, apuntado queda.'],
];

function montarEscaparate(mundo: Mundo): () => void {
  mundo.vaciar();
  const poner = colocador(mundo, 'esc');
  for (const [clave, cx0, cz0, cx1, cz1] of TRAMOS) {
    for (let cz = Math.min(cz0, cz1); cz <= Math.max(cz0, cz1); cz++) {
      for (let cx = Math.min(cx0, cx1); cx <= Math.max(cx0, cx1); cx++) {
        if (clave === 'camino' && mundo.ocupante(cx, cz)) continue;
        poner(clave, cx, cz);
      }
    }
  }
  for (const [clave, cx, cz, rot] of EDIFICIOS) poner(clave, cx, cz, rot ?? 0);
  // El molino va en el solar que señala el paisaje, arrimado al río y con la rueda hacia el agua.
  const sitio = mundo.sitioMolino();
  poner('molino', sitio.cx, sitio.cz, sitio.rot);
  for (const [clave, cx, cz, rot] of ADORNOS) poner(clave, cx, cz, rot ?? 0);

  if (import.meta.env.DEV) {
    const puestos = new Set(mundo.edificios().map((e) => e.clave));
    const faltan = CATALOGO.filter((e) => !puestos.has(e.clave)).map((e) => e.clave);
    if (faltan.length) console.warn('[escaparate] faltan edificios del catálogo:', faltan.join(', '));
  }

  for (const v of VECINOS) {
    mundo.ponerFigura({ id: v.id, nombre: v.nombre, oficio: v.oficio, esSenor: v.id === 'senor' });
    mundo.colocarFigura(v.id, v.celda[0], v.celda[1]);
    mundo.mirarFigura(v.id, v.mira[0], v.mira[1]);
  }
  mundo.ponerAnimales('gallina', 19, 37, 5, 1.3);
  mundo.ponerAnimales('gallina', 13, 30, 3, 2);
  mundo.ponerAnimales('oveja', 41, 32, 6, 2.2);
  mundo.ponerAnimales('oveja', 37, 34, 3, 3);
  mundo.ponerAnimales('perro', 24, 28, 1, 4);
  mundo.ponerAnimales('perro', 41, 29, 1, 3);

  // Vida: paseos de ida y vuelta y alguna frase suelta.
  const ida = new Map<string, boolean>();
  let turno = 0;
  const pasear = () => {
    const [id, a, b] = PASEOS[turno % PASEOS.length];
    const vuelve = ida.get(id) ?? false;
    const destino = vuelve ? a : b;
    mundo.moverFigura(id, destino[0], destino[1]);
    ida.set(id, !vuelve);
    const [quien, frase] = FRASES[turno % FRASES.length];
    mundo.decir(quien, frase, 5);
    turno++;
  };
  const primero = window.setTimeout(pasear, 6000);
  const reloj = window.setInterval(pasear, 7000);
  return () => {
    window.clearTimeout(primero);
    window.clearInterval(reloj);
  };
}

export const vistaEscaparate: Vista = {
  clave: 'escaparate',
  nombre: 'Escaparate',
  montar(mundo) {
    if (mundo.paisaje() !== 'valle') mundo.cargarPaisaje('valle');
    return montarEscaparate(mundo);
  },
  camara(mundo) {
    const { x, z } = mundo.celdaAMundo(27, 27);
    return { x, z, azimut: 28, elevacion: 33, distancia: 96 };
  },
};
