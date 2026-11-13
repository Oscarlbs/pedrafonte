// Paleta de cuento: colores cálidos para edificios y los tonos de cada estación.
import * as THREE from 'three';

export type Estacion = 'primavera' | 'verano' | 'otono' | 'invierno';

export const ESTACIONES: Estacion[] = ['primavera', 'verano', 'otono', 'invierno'];

export const NOMBRE_ESTACION: Record<Estacion, string> = {
  primavera: 'Primavera',
  verano: 'Verano',
  otono: 'Otoño',
  invierno: 'Invierno',
};

/** Colores de las piezas procedurales (se hornean en los vértices). */
export const C = {
  cal: 0xf1e4c8,
  calSombra: 0xe2d0ac,
  calRosa: 0xedd3b8,
  calOcre: 0xe8cf9a,
  viga: 0x4b3323,
  vigaClara: 0x6b4a30,
  madera: 0x8a6240,
  maderaClara: 0xb08a5c,
  maderaVieja: 0x73593f,
  tabla: 0x9a7248,
  paja: 0xd2aa55,
  pajaSombra: 0xb48c40,
  pajaVieja: 0xa98f58,
  pajaOscura: 0x8f7038,
  teja: 0xb85c3c,
  tejaOscura: 0x9a4a32,
  pizarra: 0x5d6b7c,
  piedra: 0xa39c8f,
  piedraClara: 0xbdb6a6,
  piedraOscura: 0x7d776d,
  musgo: 0x7b8a4a,
  puerta: 0x6a4428,
  puertaVerde: 0x4f6b4a,
  puertaAzul: 0x486a80,
  puertaRoja: 0x8c3f32,
  hierro: 0x3c3a3d,
  cristal: 0x394656,
  tierra: 0x7b5a3c,
  tierraOscura: 0x5a4028,
  tela: 0xe9e1d0,
  rojo: 0xb5483a,
  azul: 0x4d7a9c,
  verde: 0x6f8f4c,
  amarillo: 0xe2b94a,
  blanco: 0xf3efe6,
  negro: 0x2b2826,
  piel: 0xe9bf9a,
  brasa: 0xff8a2a,
  col: 0x8fb56a,
  trigo: 0xd9b24a,
  agua: 0x4f8f9a,
} as const;

/** Colores para contraventanas, puertas y telas: dan variedad sin salirse de la paleta. */
export const ACENTOS = [0x4f7f86, 0x8c3f32, 0x4f6b4a, 0x486a80, 0xb07a2e, 0x7a4a6a];

export interface PaletaEstacion {
  hierbaA: THREE.Color;
  hierbaB: THREE.Color;
  /** Tonos de las copas de hoja caduca. */
  copas: number[];
  /** Tonos de los pinos. */
  pinos: number[];
  /** Tamaño relativo de la copa caduca (en invierno queda rala). */
  copaEscala: number;
  /** 0–1: flores en la hierba. */
  flores: number;
  /** Colores de las flores sueltas. */
  floresColores: number[];
  mata: THREE.Color;
  /** Altura relativa del trigo (0 = barbecho) y su color. */
  trigoAltura: number;
  trigo: number;
  /** Cuánto verdea el huerto. */
  huerto: number;
}

export const PALETAS: Record<Estacion, PaletaEstacion> = {
  primavera: {
    hierbaA: new THREE.Color(0x7fae4e),
    hierbaB: new THREE.Color(0x9cc45c),
    copas: [0x7fb24f, 0x94c25a, 0x6ea548, 0xf2c6d2, 0xf7e6ea, 0x86b851],
    pinos: [0x3f7248, 0x4a7d4f, 0x386843],
    copaEscala: 0.95,
    flores: 1,
    floresColores: [0xf6e9a0, 0xf4b6c4, 0xffffff, 0xc7a6e6, 0xf2d04a],
    mata: new THREE.Color(0x86b653),
    trigoAltura: 0.35,
    trigo: 0x8fb858,
    huerto: 0.6,
  },
  verano: {
    hierbaA: new THREE.Color(0x7a9a48),
    hierbaB: new THREE.Color(0x9aab56),
    copas: [0x5a8a42, 0x6b964a, 0x4f7d3e, 0x7a9e4e, 0x86a252, 0x5f8a50],
    pinos: [0x35663f, 0x3f7046, 0x2f5c3a],
    copaEscala: 1,
    flores: 0.7,
    floresColores: [0xf2d04a, 0xffffff, 0xe8774a, 0xc7a6e6, 0xe85a6a],
    mata: new THREE.Color(0x7ea64c),
    trigoAltura: 1,
    trigo: 0xe0b84a,
    huerto: 1,
  },
  otono: {
    hierbaA: new THREE.Color(0x869443),
    hierbaB: new THREE.Color(0xa99f4c),
    copas: [0xd98a2b, 0xc9632b, 0xe0a83a, 0xb5482c, 0xcf9a32, 0x9c8a3a, 0xe2b94a, 0xa85a2a],
    pinos: [0x3a6642, 0x446c45, 0x33593b],
    copaEscala: 0.96,
    flores: 0.18,
    floresColores: [0xe0a83a, 0xc9632b, 0xf2e2b0],
    mata: new THREE.Color(0xa8a04e),
    trigoAltura: 0.12,
    trigo: 0xb99a55,
    huerto: 0.8,
  },
  invierno: {
    hierbaA: new THREE.Color(0x7d8a52),
    hierbaB: new THREE.Color(0x9a9a66),
    copas: [0x8a7458, 0x7a6850, 0x94806a, 0x6f6048],
    pinos: [0x35604a, 0x3e6950, 0x2e5544],
    copaEscala: 0.72,
    flores: 0,
    floresColores: [0xffffff],
    mata: new THREE.Color(0x9a9a62),
    trigoAltura: 0.05,
    trigo: 0x8c7a55,
    huerto: 0.15,
  },
};

const _c = new THREE.Color();

/** Color lineal [r, g, b] a partir de un hexadecimal sRGB, con una variación opcional de claridad. */
export function rgb(hex: number, claridad = 1): [number, number, number] {
  _c.setHex(hex);
  return [_c.r * claridad, _c.g * claridad, _c.b * claridad];
}
