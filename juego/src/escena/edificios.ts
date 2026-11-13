// Constructores de edificios: uno por cada valor de `modelo` de mundo/datos/edificios.yaml.
//
// Cada constructor recibe la huella en metros (con rot = 0) y devuelve un THREE.Group centrado en
// la huella, apoyado en y = 0 y con la fachada mirando al sur (z positivo). Casi todo es geometría
// propia hecha con el taller; lo que trae el pack (barriles, cajas, bancos, letreros, troncos,
// lápidas…) se coloca como modelo. Para cambiar un constructor por un GLB, véase GLB_POR_MODELO.
import * as THREE from 'three';
import { entre } from '../util/azar';
import { type AjusteGLB, type Biblioteca, GLB_POR_MODELO } from './modelos';
import { C, type Estacion, type PaletaEstacion } from './paleta';
import { type Marca, Obra, type ClaveMaterial, type OpcTejado } from './taller';

export interface ContextoObra {
  bib: Biblioteca;
  /** Huella en metros con rot = 0: ancho (x) y fondo (z). */
  ancho: number;
  fondo: number;
  semilla: number;
  /** Cuál de las tres plantillas del modelo es esta (0, 1 o 2). */
  variante: number;
  estacion: Estacion;
  paleta: PaletaEstacion;
  /** Para piezas de arrastre: con qué vecinos enlaza (bits: 1 norte, 2 este, 4 sur, 8 oeste). */
  enlaces?: number;
}

export type Constructor = (c: ContextoObra) => THREE.Group;

const PI = Math.PI;
const CALES = [C.cal, C.cal, C.calRosa, C.calOcre, C.calSombra];
const PAJAS = [C.paja, C.paja, C.pajaVieja, 0xc79f52];

// ───────────────────────── piezas comunes ─────────────────────────

/**
 * Coloca un GLB centrado en (x, z) según su caja, con la base en `y`. `ancho` lo escala para que mida
 * eso de lado a lado una vez girado; si no, vale `esc`. Devuelve sus medidas finales, o null si no está.
 */
function pieza(
  o: Obra,
  nombre: string,
  x: number,
  z: number,
  p: { esc?: number; ancho?: number; ry?: number; y?: number } = {},
): { w: number; h: number; d: number } | null {
  const m = o.bib.modelos.get(nombre);
  if (!m) return null;
  const ry = p.ry ?? 0;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const w0 = Math.abs(cos) * m.tam.x + Math.abs(sin) * m.tam.z;
  const d0 = Math.abs(sin) * m.tam.x + Math.abs(cos) * m.tam.z;
  const esc = p.ancho ? p.ancho / w0 : (p.esc ?? 1);
  const cx = (m.min.x + m.max.x) / 2;
  const cz = (m.min.z + m.max.z) / 2;
  o.glb(nombre, x - (cx * cos + cz * sin) * esc, (p.y ?? 0) - m.min.y * esc, z - (-cx * sin + cz * cos) * esc, { ry, esc });
  return { w: w0 * esc, h: m.tam.y * esc, d: d0 * esc };
}

interface CasaDePiezas {
  /** Escala: metros por unidad del pack. */
  e: number;
  /** Muros de la fachada (sur) y de la trasera (norte), de oeste a este. */
  sur: string[];
  norte: string[];
  /** Muros bajo los hastiales del tejado: oeste y este. */
  oeste: string;
  este: string;
  /** Muro que se repite en los pisos de arriba. */
  arriba?: string;
  pisos?: number;
  tejado: string;
  /** Largo al que se encoge o estira el tejado, en unidades del pack (por defecto, el suyo). */
  largoTejado?: number;
  /** Altura del zócalo de piedra, en metros. */
  zocalo?: number;
}

/**
 * Monta una casa con los muros de entramado y un tejado de paja sueltos de EmaceArt. Los muros miden
 * 8 × 3 unidades y se estiran lo justo para cerrar la planta que cubre el tejado; dentro va un cajón
 * oscuro que de noche da luz por puertas y ventanas. Devuelve las medidas en metros.
 */
function casaDePiezas(o: Obra, x0: number, z0: number, p: CasaDePiezas): { w: number; d: number; h: number; yAlero: number } {
  const tejado = o.bib.modelos.get(p.tejado)!;
  const e = p.e;
  const ALTO = 3.0; // alto de un muro, en unidades del pack
  const APOYO = 1.0; // el tejado de paja baja un metro por debajo de la cabeza de los muros
  const VUELO = 1.0; // lo que vuela el tejado en cada hastial
  const ex = (p.largoTejado ?? tejado.tam.x) / tejado.tam.x;
  const largo = (tejado.tam.x * ex - VUELO * 2) * e;
  const fondo = 8.3 * e;
  const pisos = p.pisos ?? 1;
  const y0 = p.zocalo ?? 0.25;
  const cx = x0;
  o.caja(largo + 0.3, y0 + 0.05, fondo + 0.3, cx, -0.05, z0, C.piedra, { mat: 'piedra', uv: 1.6 });
  o.caja(largo - 0.25, ALTO * e * pisos - 0.1, fondo - 0.25, cx, y0, z0, 0x2a2018, { luz: 0.85, vari: 0 });
  const muro = (nombre: string, x: number, z: number, piso: number, ry: number, tramo: number): void => {
    const m = o.bib.modelos.get(nombre)!;
    o.glb(nombre, x, y0 + piso * ALTO * e, z, { ry, esc: [e, e, (tramo / m.tam.z)] });
  };
  for (let piso = 0; piso < pisos; piso++) {
    const de = (nombre: string): string => (piso > 0 && p.arriba ? p.arriba : nombre);
    muro(de(p.oeste), cx - largo / 2, z0, piso, 0, fondo + 0.2);
    muro(de(p.este), cx + largo / 2, z0, piso, 0, fondo + 0.2);
    for (const [fila, z] of [[p.sur, z0 + fondo / 2], [p.norte, z0 - fondo / 2]] as [string[], number][]) {
      const tramo = (largo + 0.2) / fila.length;
      fila.forEach((nombre, i) => muro(de(nombre), cx - largo / 2 - 0.1 + tramo * (i + 0.5), z, piso, PI / 2, tramo));
    }
  }
  const yAlero = y0 + (ALTO * pisos - APOYO) * e;
  o.glb(p.tejado, cx - ((tejado.min.x + tejado.max.x) / 2) * e * ex, yAlero - tejado.min.y * e, z0 - ((tejado.min.z + tejado.max.z) / 2) * e, { esc: [e * ex, e, e] });
  return { w: largo, d: fondo, h: yAlero + tejado.tam.y * e, yAlero };
}

const PIEZAS_DE_CASA = ['ea_muro_liso', 'ea_muro_ventanas', 'ea_muro_puerta', 'ea_tejado_paja', 'ea_tejado_paja_largo'];

/** ¿Toca la casa montada con piezas de EmaceArt? La segunda de las tres plantillas, si están cargadas. */
function conPiezas(c: ContextoObra): boolean {
  return c.variante === 1 && PIEZAS_DE_CASA.every((m) => c.bib.tiene(m));
}

/** ¿Toca la variante de EmaceArt? Una de cada tres plantillas, y solo si el modelo está cargado. */
function conPack(c: ContextoObra, ...modelos: string[]): boolean {
  return c.variante === 2 && modelos.every((m) => c.bib.tiene(m));
}

function barril(o: Obra, x: number, z: number, esc = 1, y = 0): void {
  if (o.bib.tiene('barrel03')) {
    o.glb('barrel03', x, y, z, { ry: o.azar() * 6, esc });
  } else {
    o.cil(0.34 * esc, 0.3 * esc, 0.95 * esc, x, y, z, C.madera, { lados: 10 });
  }
}

function cajon(o: Obra, x: number, z: number, esc = 1, y = 0): void {
  if (o.bib.tiene('box01')) o.glb('box01', x, y, z, { ry: o.azar() * 6, esc });
  else o.caja(0.75 * esc, 0.7 * esc, 0.75 * esc, x, y, z, C.tabla, { ry: o.azar() });
}

function cajita(o: Obra, x: number, z: number, y = 0, esc = 1): void {
  if (o.bib.tiene('box02')) o.glb('box02', x, y, z, { ry: o.azar() * 6, esc });
  else o.caja(0.6 * esc, 0.36 * esc, 0.85 * esc, x, y, z, C.maderaClara, { ry: o.azar() });
}

function banco(o: Obra, x: number, z: number, ry = 0, esc = 0.7): void {
  if (o.bib.tiene('bench01')) o.glb('bench01', x, 0, z, { ry, esc });
  else {
    o.con(x, 0, z, ry, () => {
      o.caja(1.6 * esc, 0.08, 0.4, 0, 0.36, 0, C.madera);
      o.caja(0.1, 0.36, 0.36, -0.6 * esc, 0, 0, C.viga);
      o.caja(0.1, 0.36, 0.36, 0.6 * esc, 0, 0, C.viga);
    });
  }
}

/** Mata de flores o de hierbas: bolitas de color sobre verde. */
function flores(o: Obra, x: number, z: number, n: number, radio: number, colores: number[] = [0xd9534a, 0xf2c94c, 0xf4a6b8, 0xffffff, 0xa77bd1]): void {
  for (let i = 0; i < n; i++) {
    const a = o.azar() * PI * 2;
    const r = Math.sqrt(o.azar()) * radio;
    const fx = x + Math.cos(a) * r;
    const fz = z + Math.sin(a) * r;
    o.bola(0.11, fx, 0.1, fz, 0x5f8f45, { det: 0, esc: [1, 0.8, 1], vari: 0.12 });
    o.bola(0.075, fx + 0.02, 0.22, fz, colores[Math.floor(o.azar() * colores.length)], { det: 0, vari: 0.08 });
  }
}

function arbusto(o: Obra, x: number, z: number, r: number, color: number): void {
  o.bola(r, x, r * 0.7, z, color, { esc: [1.15, 0.8, 1], vari: 0.1 });
  o.bola(r * 0.7, x + r * 0.7, r * 0.5, z + r * 0.3, color, { det: 0, esc: [1, 0.8, 1], vari: 0.12 });
}

/** Valla de palos entre dos puntos, con sus largueros. */
function valla(o: Obra, x0: number, z0: number, x1: number, z1: number, alto = 0.95, color: number = C.madera): void {
  const largo = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(largo / 1.25));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    o.caja(0.13, alto + o.azar() * 0.12, 0.13, px, -0.15, pz, color, { ry: o.azar(), vari: 0.12 });
  }
  for (const h of [0.38, 0.74]) {
    const dy = (o.azar() - 0.5) * 0.05;
    o.viga(x0, alto * h + dy, z0, x1, alto * h - dy, z1, [0.1, 0.05], color, { vari: 0.12 });
  }
}

/** Murito de piedra seca entre dos puntos. */
function murito(o: Obra, x0: number, z0: number, x1: number, z1: number, alto = 0.7, grueso = 0.42): void {
  const largo = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(largo / 0.75));
  const ry = Math.atan2(x1 - x0, z1 - z0) + PI / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const h = alto * entre(o.azar, 0.85, 1.12);
    o.caja((largo / n) * 1.04, h + 0.3, grueso * entre(o.azar, 0.9, 1.1), px, -0.3, pz, C.piedra, { ry: ry + (o.azar() - 0.5) * 0.08, mat: 'roca', uv: 1.6 });
    if (o.azar() < 0.55) o.caja((largo / n) * 0.7, 0.12, grueso * 1.12, px, h - 0.02, pz, C.piedraClara, { ry: ry + (o.azar() - 0.5) * 0.2, mat: 'roca', uv: 1.2 });
  }
}

/** Leña apilada: troncos tumbados a lo largo de x. */
function lena(o: Obra, x: number, z: number, ry: number, ancho: number, filas: number, largo = 0.9): void {
  o.con(x, 0, z, ry, () => {
    const r = 0.13;
    const porFila = Math.max(2, Math.round(ancho / (r * 2)));
    for (let f = 0; f < filas; f++) {
      const n = porFila - (f % 2);
      for (let i = 0; i < n; i++) {
        const tx = (i - (n - 1) / 2) * r * 2.02;
        const col = o.azar() < 0.5 ? C.maderaClara : C.madera;
        o.cil(r, r, largo, tx, r * 0.9 + f * r * 1.75 - largo / 2 + r * 0.1, 0, col, { rx: PI / 2, lados: 6, vari: 0.15 });
      }
    }
  });
}

/** Farolillo de pared: brazo de hierro y caja de luz. En el plano local z = 0. */
function farolPared(o: Obra, u: number, v: number): void {
  o.viga(u, v + 0.28, 0, u, v + 0.28, 0.32, 0.05, C.hierro);
  o.viga(u, v + 0.28, 0.3, u, v + 0.1, 0.3, 0.03, C.hierro);
  o.caja(0.2, 0.26, 0.2, u, v - 0.16, 0.3, 0xffd58a, { luz: 1, vari: 0 });
  o.caja(0.26, 0.05, 0.26, u, v + 0.1, 0.3, C.hierro);
  o.caja(0.24, 0.04, 0.24, u, v - 0.2, 0.3, C.hierro);
  o.marca('luz', u, v - 0.05, 0.3, 0.8);
}

type Simbolo = 'jarra' | 'pan' | 'herradura' | 'pluma' | 'hoja' | 'saco';

/** Letrero colgante de oficio, perpendicular a la fachada. En el plano local z = 0. */
function letrero(o: Obra, u: number, v: number, simbolo: Simbolo, color: number): void {
  o.viga(u, v + 0.42, 0, u, v + 0.42, 0.95, [0.08, 0.08], C.hierro);
  o.viga(u, v + 0.1, 0, u, v + 0.42, 0.4, 0.04, C.hierro);
  for (const z of [0.4, 0.82]) o.viga(u, v + 0.42, z, u, v + 0.26, z, 0.025, C.hierro);
  o.caja(0.07, 0.52, 0.62, u, v - 0.26, 0.61, color, { vari: 0.03 });
  o.caja(0.09, 0.05, 0.68, u, v + 0.24, 0.61, C.viga);
  for (const lado of [-1, 1]) {
    const x = u + lado * 0.05;
    const claro = 0xf3e2b3;
    if (simbolo === 'jarra') {
      o.caja(0.03, 0.26, 0.2, x, v - 0.13, 0.58, claro, { vari: 0 });
      o.caja(0.03, 0.14, 0.06, x, v - 0.07, 0.75, claro, { vari: 0 });
    } else if (simbolo === 'pan') {
      o.bola(0.16, x, v, 0.61, 0xd9a85a, { det: 0, esc: [0.2, 0.7, 1.2], vari: 0 });
    } else if (simbolo === 'herradura') {
      o.caja(0.03, 0.26, 0.06, x, v - 0.13, 0.5, claro, { vari: 0 });
      o.caja(0.03, 0.26, 0.06, x, v - 0.13, 0.72, claro, { vari: 0 });
      o.caja(0.03, 0.06, 0.28, x, v + 0.1, 0.61, claro, { vari: 0 });
    } else if (simbolo === 'pluma') {
      o.viga(x, v - 0.16, 0.48, x, v + 0.16, 0.74, [0.03, 0.09], claro, { vari: 0 });
    } else if (simbolo === 'hoja') {
      o.bola(0.13, x, v, 0.61, 0x8fc46a, { det: 0, esc: [0.2, 1.1, 0.7], vari: 0 });
    } else {
      o.bola(0.15, x, v - 0.03, 0.61, claro, { det: 0, esc: [0.2, 1, 0.85], vari: 0 });
    }
  }
}

/** Saco de grano o de harina. */
function saco(o: Obra, x: number, z: number, y = 0, color = 0xd9c9a3): void {
  o.bola(0.26, x, y + 0.24, z, color, { det: 1, esc: [1, 1.05, 0.85], vari: 0.06 });
  o.bola(0.09, x, y + 0.52, z, color, { det: 0, vari: 0.06 });
}

// ───────────────────────── casas ─────────────────────────

interface OpcCasa {
  /** Planta del cuerpo en metros (x, z). */
  w: number;
  d: number;
  /** Altura de la planta baja sobre el zócalo. */
  alto: number;
  /** Altura del piso alto (voladizo); 0 o nada = una planta. */
  piso2?: number;
  vuelo?: number;
  /** Altura de la cumbrera sobre las paredes. */
  cumbre: number;
  /** Dirección de la cumbrera. */
  eje?: 'x' | 'z';
  cal?: number;
  zocalo?: number;
  /** Pared de la planta baja en piedra en vez de entramado. */
  bajoPiedra?: boolean;
  tejado?: OpcTejado;
  /** Fachada (0 sur, 1 este, 2 norte, 3 oeste) y posición u de la puerta; null = sin puerta. */
  puerta?: { lado: number; u: number; color?: number; arco?: boolean; ancho?: number } | null;
  contras?: number;
  /** Fachadas sin ventanas (porque llevan un anexo, la rueda…). */
  ciegas?: number[];
  jardineras?: boolean;
}

interface CasaHecha {
  /** Altura del borde superior de las paredes. */
  yAlero: number;
  yCumbre: number;
  w2: number;
  d2: number;
}

/** Cuerpo de una casa de entramado: zócalo de piedra, paredes encaladas con vigas vistas y tejado. */
function casa(o: Obra, c: OpcCasa, x = 0, z = 0): CasaHecha {
  const zoc = c.zocalo ?? 0.35;
  const cal = c.cal ?? CALES[Math.floor(o.azar() * CALES.length)];
  const contras = c.contras ?? o.acento();
  const vuelo = c.piso2 ? (c.vuelo ?? 0.22) : 0;
  o.caja(c.w + 0.18, zoc + 0.7, c.d + 0.18, x, -0.7, z, C.piedra, { mat: 'piedra', uv: 1.7 });
  if (c.bajoPiedra) o.caja(c.w, c.alto, c.d, x, zoc, z, C.piedra, { mat: 'piedra', uv: 1.7 });
  else o.caja(c.w, c.alto, c.d, x, zoc, z, cal, { sombra: 0.14, vari: 0.03 });
  let yTop = zoc + c.alto;
  const w2 = c.w + vuelo * 2;
  const d2 = c.d + vuelo * 2;
  if (c.piso2) {
    o.caja(w2 + 0.08, 0.18, d2 + 0.08, x, yTop - 0.05, z, C.viga);
    // Cabezas de las vigas del voladizo.
    for (let i = 0; i < Math.round(w2 / 0.7); i++) {
      const vx = x - w2 / 2 + 0.3 + i * ((w2 - 0.6) / Math.max(1, Math.round(w2 / 0.7) - 1));
      o.caja(0.12, 0.14, d2 + 0.2, vx, yTop - 0.17, z, C.vigaClara);
    }
    o.caja(w2, c.piso2, d2, x, yTop + 0.13, z, cal, { vari: 0.03 });
    yTop += 0.13 + c.piso2;
  }

  for (let lado = 0; lado < 4; lado++) {
    const ry = (lado * PI) / 2;
    const ancho = lado % 2 === 0 ? c.w : c.d;
    const prof = lado % 2 === 0 ? c.d / 2 : c.w / 2;
    const ciega = c.ciegas?.includes(lado) ?? false;
    const conPuerta = c.puerta && c.puerta.lado === lado ? c.puerta : null;
    const huecos: [number, number][] = [];
    // Planta baja.
    o.con(x + Math.sin(ry) * prof, 0, z + Math.cos(ry) * prof, ry, () => {
      const n = ancho >= 4.6 ? 3 : ancho >= 2.7 ? 2 : 1;
      const wv = 0.62;
      const hv = Math.min(0.78, c.alto * 0.36);
      const pw = conPuerta?.ancho ?? 0.95;
      let tramoPuerta = -1;
      if (conPuerta) {
        let mejor = Infinity;
        for (let i = 0; i < n; i++) {
          const u = -ancho / 2 + (ancho * (i + 0.5)) / n;
          if (Math.abs(u - conPuerta.u) < mejor) {
            mejor = Math.abs(u - conPuerta.u);
            tramoPuerta = i;
          }
        }
        o.puerta(conPuerta.u, pw, Math.min(1.85, c.alto - 0.15), { v0: zoc, color: conPuerta.color ?? C.puerta, arco: conPuerta.arco, marco: c.bajoPiedra ? C.piedraOscura : C.viga });
        huecos.push([conPuerta.u - pw / 2 - 0.1, conPuerta.u + pw / 2 + 0.1]);
      }
      if (!ciega) {
        for (let i = 0; i < n; i++) {
          if (i === tramoPuerta) continue;
          if (!conPuerta && lado !== 0 && o.azar() < 0.3) continue;
          const u = -ancho / 2 + (ancho * (i + 0.5)) / n + (o.azar() - 0.5) * 0.1;
          o.ventana(u, zoc + c.alto * 0.6, wv, hv, {
            contras: lado === 0 || o.azar() < 0.5 ? contras : undefined,
            jardinera: (c.jardineras ?? true) && lado === 0 && o.azar() < 0.75,
            marco: c.bajoPiedra ? C.piedraOscura : C.viga,
          });
          huecos.push([u - wv / 2 - 0.1, u + wv / 2 + 0.1]);
        }
      }
      if (!c.bajoPiedra) o.entramado(ancho, zoc, c.alto, { huecos, travesano: ciega ? 0.5 : undefined });
    });
    // Piso alto.
    if (c.piso2) {
      const ancho2 = ancho + vuelo * 2;
      o.con(x + Math.sin(ry) * (prof + vuelo), 0, z + Math.cos(ry) * (prof + vuelo), ry, () => {
        const v0 = zoc + c.alto + 0.13;
        const h2 = c.piso2 ?? 0;
        const n = ancho2 >= 4.6 ? 3 : 2;
        const hs: [number, number][] = [];
        if (!ciega) {
          for (let i = 0; i < n; i++) {
            if (lado !== 0 && o.azar() < 0.35) continue;
            const u = -ancho2 / 2 + (ancho2 * (i + 0.5)) / n;
            o.ventana(u, v0 + h2 * 0.55, 0.58, Math.min(0.7, h2 * 0.42), { contras: o.azar() < 0.6 ? contras : undefined });
            hs.push([u - 0.4, u + 0.4]);
          }
        }
        o.entramado(ancho2, v0, h2, { huecos: hs, solera: false });
      });
    }
  }

  const eje = c.eje ?? 'x';
  const t: OpcTejado = { eje, hastial: cal, color: PAJAS[Math.floor(o.azar() * PAJAS.length)], ...c.tejado };
  if (eje === 'x') o.tejado(d2, w2, c.cumbre, x, yTop, z, t);
  else o.tejado(w2, d2, c.cumbre, x, yTop, z, t);
  return { yAlero: yTop, yCumbre: yTop + c.cumbre, w2, d2 };
}

// ───────────────────────── constructores ─────────────────────────

const choza: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const r = Math.min(c.ancho, c.fondo) * 0.36;
  // Pared baja de varas y barro, redonda, con tejado cónico hasta casi el suelo.
  o.cil(r, r * 1.04, 1.5, 0, -0.3, 0, 0xcdb48a, { lados: 12, sombra: 0.2 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2 + 0.26;
    o.caja(0.11, 1.3, 0.11, Math.sin(a) * r * 1.01, 0, Math.cos(a) * r * 1.01, C.viga, { ry: a });
  }
  o.tejadoRedondo(r + 0.6, 2.9, 0, 1.05, 0, { abomba: 0.35, lados: 12, color: C.pajaVieja });
  o.cil(0.16, 0.3, 0.3, 0, 3.85, 0, C.pajaOscura, { lados: 6 });
  o.con(0, 0, r * 1.0, 0, () => o.puerta(0, 0.85, 1.25, { color: C.maderaVieja, escalon: false }));
  o.marca('humo', 0, 4.2, 0, 0.6);
  lena(o, -r - 0.5, 0.6, 0.3, 0.8, 2, 0.7);
  barril(o, r + 0.35, 0.9, 0.85);
  return o.grupo();
};

const casaSencilla: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  if (conPiezas(c)) {
    // Una de cada tres casas se monta con muros de entramado y tejado de paja de EmaceArt.
    const zc = -c.fondo * 0.03;
    const t = casaDePiezas(o, 0, zc, {
      e: 0.53, zocalo: 0.35, sur: ['ea_muro_puerta'], norte: ['ea_muro_liso'], oeste: 'ea_muro_ventanas', este: 'ea_muro_liso', tejado: 'ea_tejado_paja',
    });
    o.con(0, 0, zc + t.d / 2 + 0.12, 0, () => farolPared(o, -t.w * 0.12, 1.5));
    o.chimenea(-t.w * 0.24, t.yAlero + 0.7, zc - t.d * 0.16, 2.0, { ancho: 0.55 });
    banco(o, -t.w * 0.2, zc + t.d / 2 + 0.45, 0, 0.55);
    pieza(o, 'ea_cesto', t.w / 2 + 0.3, zc + t.d / 2 - 0.2, { esc: 0.9 });
    pieza(o, 'ea_saco', t.w / 2 + 0.35, zc + 0.4, { esc: 0.85, ry: 1.2 });
    return o.grupo();
  }
  if (conPack(c, 'ea_cabana')) {
    // Otra de cada tres es de troncos, con tejado de paja (EmaceArt).
    const zc = -c.fondo * 0.04;
    const t = pieza(o, 'ea_cabana', 0, zc, { ry: -PI / 2, ancho: c.ancho * 0.74 })!;
    o.marca('humo', 0, t.h - 0.3, zc - t.d * 0.2, 0.6);
    o.con(t.w / 2 - 0.45, 0, zc + t.d / 2 - 0.45, 0, () => farolPared(o, 0, 1.7));
    if (!pieza(o, 'ea_lenos', -t.w / 2 - 0.2, zc + 0.6, { esc: 0.55, ry: 0.5 })) lena(o, -t.w / 2 - 0.3, zc, PI / 2, 1.4, 3, 0.7);
    pieza(o, 'ea_barril', t.w / 2 + 0.25, zc + 1.2, { esc: 1.0 });
    pieza(o, 'ea_cesto', t.w / 2 + 0.2, zc + 0.3, { esc: 0.9, ry: 1 });
    return o.grupo();
  }
  const ejeX = o.azar() < 0.65;
  const w = c.ancho * (ejeX ? 0.76 : 0.66);
  const d = c.fondo * (ejeX ? 0.62 : 0.72);
  const z0 = -c.fondo * 0.07;
  const h = casa(o, {
    w, d, alto: 2.0, cumbre: ejeX ? 2.25 : 2.5, eje: ejeX ? 'x' : 'z',
    puerta: { lado: 0, u: ejeX ? (o.azar() < 0.5 ? -w * 0.22 : w * 0.22) : 0, color: [C.puerta, C.puertaVerde, C.puertaAzul, C.puertaRoja][Math.floor(o.azar() * 4)] },
    tejado: { abomba: 0.5, alero: 0.45, cadera: ejeX ? 0.3 : 0.7 },
  }, 0, z0);
  const lado = o.azar() < 0.5 ? -1 : 1;
  if (ejeX) o.chimenea(lado * w * 0.28, h.yAlero + 0.2, z0 - d * 0.12, 2.5);
  else o.chimenea(lado * w * 0.2, h.yAlero + 0.3, z0 - d * 0.2, 2.6);
  const frente = z0 + d / 2;
  // Enseres del corral.
  if (o.azar() < 0.7) barril(o, -lado * (w / 2 + 0.25), frente + 0.35, 0.8);
  if (o.azar() < 0.6) lena(o, lado * (w / 2 + 0.42), z0 - 0.2, PI / 2, 1.3, 3, 0.7);
  if (o.azar() < 0.5) banco(o, lado * w * 0.25, frente + 0.42, 0, 0.55);
  flores(o, -lado * w * 0.32, frente + 0.55, 4, 0.4);
  if (o.azar() < 0.5) arbusto(o, lado * (c.ancho / 2 - 0.6), c.fondo / 2 - 0.7, 0.42, c.paleta.copas[0]);
  return o.grupo();
};

const casaGrande: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  if (conPiezas(c)) {
    // Una de cada tres casas grandes se monta con piezas de EmaceArt: dos alturas de entramado y paja.
    const zc = -c.fondo * 0.03;
    const t = casaDePiezas(o, 0, zc, {
      e: 0.47, pisos: 2, sur: ['ea_muro_puerta', 'ea_muro_ventanas'], norte: ['ea_muro_liso', 'ea_muro_ventanas'],
      oeste: 'ea_muro_ventanas', este: 'ea_muro_liso', arriba: 'ea_muro_ventanas', tejado: 'ea_tejado_paja_largo', largoTejado: 16.6,
    });
    o.con(0, 0, zc + t.d / 2 + 0.12, 0, () => farolPared(o, -t.w * 0.26, 1.85));
    const xc = t.w / 2 + 0.3;
    o.caja(0.7, t.yAlero + 0.9, 1.0, xc, -0.3, zc - 0.3, C.piedra, { mat: 'piedra', uv: 1.6 });
    o.chimenea(xc, t.yAlero + 0.5, zc - 0.3, 2.4, { ancho: 0.62 });
    pieza(o, 'ea_barril', -t.w / 2 - 0.35, zc + t.d / 2 - 0.3, { esc: 1.0 });
    pieza(o, 'ea_cajon', -t.w / 2 - 0.3, zc + 0.5, { esc: 0.7, ry: 0.3 });
    return o.grupo();
  }
  if (conPack(c, 'ea_casona')) {
    // Otra de cada tres es la casa larga de troncos pintados y tejado de tablas (EmaceArt).
    const t = pieza(o, 'ea_casona', 0, -c.fondo * 0.04, { ancho: c.ancho * 0.96 })!;
    const zc = -c.fondo * 0.04;
    o.marca('humo', -t.w * 0.2, t.h - 0.2, zc, 0.8);
    // No trae ventanas que se enciendan: dos faroles en el ala que sale al frente.
    o.con(t.w * 0.27, 0, zc + t.d / 2 - 0.05, 0, () => {
      farolPared(o, -0.9, 1.75);
      farolPared(o, 0.9, 1.75);
    });
    pieza(o, 'ea_barril', -t.w * 0.42, zc + t.d / 2 - 0.2, { esc: 1.0 });
    pieza(o, 'ea_cajon', -t.w * 0.3, zc + t.d / 2 - 0.1, { esc: 0.7, ry: 0.4 });
    return o.grupo();
  }
  const w = c.ancho * 0.7;
  const d = c.fondo * 0.6;
  const z0 = -c.fondo * 0.08;
  const lado = o.azar() < 0.5 ? -1 : 1;
  const h = casa(o, {
    w, d, alto: 2.05, piso2: 1.75, cumbre: 2.3, eje: 'x',
    puerta: { lado: 0, u: -lado * w * 0.2, color: C.puertaVerde },
    tejado: { abomba: 0.45, alero: 0.42, cadera: 0.25 },
  }, 0, z0);
  // Chimenea de piedra adosada al hastial, desde el suelo.
  const xc = lado * (h.w2 / 2 + 0.2);
  o.caja(0.75, h.yAlero + 0.4, 1.1, xc, -0.3, z0, C.piedra, { mat: 'piedra', uv: 1.6 });
  o.chimenea(xc - lado * 0.05, h.yAlero, z0, 2.2, { ancho: 0.66 });
  const frente = z0 + d / 2;
  o.con(-lado * w * 0.2 + 0.85, 0, frente + 0.22, 0, () => farolPared(o, 0, 1.9));
  barril(o, lado * w * 0.32, frente + 0.6, 0.85);
  cajon(o, lado * w * 0.32 + 0.75, frente + 0.5, 0.7);
  flores(o, -lado * (w / 2 + 0.2), frente + 0.6, 5, 0.5);
  banco(o, -lado * w * 0.05 + 1.6 * -lado, frente + 0.5, 0, 0.6);
  arbusto(o, -lado * (c.ancho / 2 - 0.55), -c.fondo / 2 + 0.8, 0.5, c.paleta.copas[1]);
  return o.grupo();
};

const casona: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.66;
  const d = c.fondo * 0.5;
  const z0 = -c.fondo * 0.16;
  const techo: OpcTejado = { mat: 'pizarra', abomba: 0.12, alero: 0.4, cadera: 0.2, comba: 0, colorCanto: C.pizarra, hastial: C.cal, tramos: 2 };
  const h = casa(o, {
    w, d, alto: 2.3, piso2: 2.0, cumbre: 2.6, eje: 'x', cal: C.cal, bajoPiedra: true, contras: 0x8c3f32, vuelo: 0.2,
    puerta: { lado: 0, u: 0.6, color: 0x5a3a26, arco: true, ancho: 1.15 },
    tejado: techo, jardineras: false,
  }, 0.5, z0);
  // Ala cruzada con hastial al frente.
  const aw = 3.3;
  const ad = 3.4;
  const ax = 0.5 - w / 2 + aw / 2 - 0.6;
  const az = z0 + d / 2 + ad / 2 - 0.5;
  const ala = casa(o, {
    w: aw, d: ad, alto: 2.3, piso2: 2.0, cumbre: 2.2, eje: 'z', cal: C.cal, bajoPiedra: true, contras: 0x8c3f32, vuelo: 0.2,
    puerta: null, tejado: techo, ciegas: [2], jardineras: false,
  }, ax, az);
  // Balcón de madera sobre la puerta, con su estandarte.
  const frente = z0 + d / 2 + 0.2;
  const bx = 1.55;
  const by = 0.35 + 2.3 + 0.1;
  o.caja(3.0, 0.12, 1.0, bx, by, frente + 0.5, C.madera);
  for (const px of [-1.4, 1.4]) o.viga(bx + px, 0.3, frente + 0.9, bx + px, by, frente + 0.9, 0.14, C.viga);
  for (let i = 0; i <= 8; i++) o.caja(0.07, 0.6, 0.07, bx - 1.45 + (2.9 * i) / 8, by + 0.1, frente + 0.95, C.viga);
  o.caja(3.0, 0.08, 0.1, bx, by + 0.7, frente + 0.95, C.viga);
  o.caja(0.9, 1.5, 0.05, bx, by - 1.0, frente + 1.02, 0xa3352c, { vari: 0 });
  o.caja(0.5, 0.5, 0.06, bx, by - 0.45, frente + 1.04, 0xe2b94a, { rz: PI / 4, vari: 0 });
  o.chimenea(0.5 + w * 0.32, h.yAlero + 0.3, z0 - d * 0.1, 2.9, { ancho: 0.7 });
  o.chimenea(ax, ala.yAlero + 0.4, az - 0.4, 2.4, { ancho: 0.6 });
  // Veleta.
  o.viga(0.5, h.yCumbre, z0, 0.5, h.yCumbre + 0.9, z0, 0.04, C.hierro);
  o.caja(0.5, 0.05, 0.03, 0.5, h.yCumbre + 0.7, z0, C.hierro);
  o.cono(0.1, 0.25, 0.75, h.yCumbre + 0.6, z0, 0xe2b94a, { rz: -PI / 2, lados: 4 });
  // Corral delantero con murito y faroles.
  const fz = c.fondo / 2 - 0.4;
  murito(o, ax + aw / 2 + 0.4, fz, c.ancho / 2 - 0.3, fz, 0.7);
  murito(o, c.ancho / 2 - 0.3, fz, c.ancho / 2 - 0.3, z0 + d / 2 - 0.5, 0.7);
  o.con(0.6 - 1.0, 0, frente, 0, () => farolPared(o, 0, 2.0));
  o.con(0.6 + 1.0, 0, frente, 0, () => farolPared(o, 0, 2.0));
  flores(o, 3.2, fz - 0.6, 6, 0.6);
  barril(o, c.ancho / 2 - 1.0, z0 + d / 2 + 0.5, 0.9);
  arbusto(o, -c.ancho / 2 + 0.7, -c.fondo / 2 + 0.9, 0.55, c.paleta.pinos[0]);
  return o.grupo();
};

const hoguera: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2;
    o.bola(0.2, Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72, C.piedra, { det: 0, esc: [1.2, 0.8, 1], vari: 0.15, ry: o.azar() * 3 });
  }
  o.cil(0.62, 0.66, 0.06, 0, 0.0, 0, 0x3a322c, { lados: 9 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + 0.3;
    o.viga(Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5, -Math.cos(a) * 0.08, 0.62, -Math.sin(a) * 0.08, 0.13, 0x4a3526, { vari: 0.15 });
  }
  o.bola(0.26, 0, 0.14, 0, C.brasa, { det: 0, esc: [1.3, 0.5, 1.3], luz: 2, vari: 0 });
  o.marca('fuego', 0, 0.3, 0, 1);
  o.marca('humo', 0, 1.5, 0, 0.9);
  // Troncos para sentarse.
  const r = Math.min(c.ancho, c.fondo) / 2 - 0.45;
  o.cil(0.2, 0.2, 1.5, -r, 0.2 - 0.75, 0.2, C.madera, { rx: PI / 2, lados: 7, ry: 0.2 });
  o.cil(0.2, 0.2, 1.3, 0.3, 0.2 - 0.65, -r, C.maderaVieja, { rx: PI / 2, ry: PI / 2 + 0.2, lados: 7 });
  o.cil(0.24, 0.26, 0.4, r * 0.9, 0, r * 0.6, C.maderaClara, { lados: 7 });
  return o.grupo();
};

const pozo: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  // Losas alrededor.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    const r = entre(o.azar, 1.2, 1.55);
    o.cil(0.36, 0.38, 0.08, Math.cos(a) * r, -0.03, Math.sin(a) * r, C.piedraClara, { lados: 6, ry: o.azar() * 3, vari: 0.12 });
  }
  if (conPack(c, 'ea_pozo')) {
    // Pozo de brocal de tablas y tejadillo de paja (EmaceArt).
    pieza(o, 'ea_pozo', 0, 0, { ancho: 2.9 });
    pieza(o, 'ea_cubo', 1.5, 0.9, { esc: 1.1, ry: 0.6 });
    return o.grupo();
  }
  o.cil(0.95, 1.0, 1.1, 0, -0.25, 0, C.piedra, { mat: 'piedra', lados: 12, uv: 1.4 });
  o.cil(1.02, 1.02, 0.1, 0, 0.83, 0, C.piedraClara, { lados: 12 });
  o.cil(0.74, 0.74, 0.04, 0, 0.9, 0, 0x26404a, { lados: 12, vari: 0 });
  for (const s of [-1, 1]) o.caja(0.16, 2.3, 0.16, s * 0.92, 0, 0, C.viga);
  o.cil(0.09, 0.09, 2.0, 0, 1.75 - 1.0, 0, C.madera, { rz: PI / 2, lados: 6 });
  o.viga(1.02, 1.75, 0, 1.25, 1.75, 0, 0.05, C.hierro);
  o.viga(1.25, 1.75, 0, 1.25, 1.5, 0, 0.05, C.hierro);
  o.viga(0.1, 1.75, 0, 0.1, 1.15, 0, 0.03, 0xcbb894);
  o.cil(0.17, 0.14, 0.26, 0.1, 0.9, 0, C.madera, { lados: 8 });
  o.tejado(2.0, 1.1, 0.75, 0, 2.3, 0, { eje: 'x', alero: 0.28, abomba: 0.4, cadera: 0.1, grosor: 0.18, aspas: false, comba: 0 });
  o.cil(0.2, 0.16, 0.3, 1.5, 0, 0.9, C.madera, { lados: 8 });
  return o.grupo();
};

const campo: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const p = c.paleta;
  // Espigas: una malla instanciada que no se hornea (son muchas).
  const brote = new Obra(c.bib, c.semilla + 1);
  const alto = 0.25 + 0.9 * p.trigoAltura;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    const dx = Math.cos(a) * 0.1;
    const dz = Math.sin(a) * 0.1;
    brote.viga(dx, 0, dz, dx * 2.2, alto, dz * 2.2, [0.05, 0.05], p.trigo, { vari: 0.1 });
    if (p.trigoAltura > 0.6) brote.caja(0.08, 0.2, 0.08, dx * 2.3, alto - 0.04, dz * 2.3, 0xe8c45c, { vari: 0.08 });
  }
  const geo = (brote.grupo().children[0] as THREE.Mesh).geometry;
  const filas = Math.floor((c.fondo - 0.8) / 0.8);
  const porFila = Math.floor((c.ancho - 0.7) / 0.34);
  const malla = new THREE.InstancedMesh(geo, c.bib.pintura, filas * porFila);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let k = 0;
  for (let f = 0; f < filas; f++) {
    for (let i = 0; i < porFila; i++) {
      const x = -c.ancho / 2 + 0.45 + i * 0.34 + (o.azar() - 0.5) * 0.1;
      const z = -c.fondo / 2 + 0.6 + f * 0.8 + (o.azar() - 0.5) * 0.12;
      const s = entre(o.azar, 0.8, 1.2);
      q.setFromEuler(new THREE.Euler((o.azar() - 0.5) * 0.25, o.azar() * 6, (o.azar() - 0.5) * 0.25));
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
      malla.setMatrixAt(k++, m);
    }
  }
  malla.castShadow = false;
  malla.receiveShadow = true;
  malla.userData['pegarAlSuelo'] = true;
  o.vivo(malla);
  // Espantapájaros.
  const ex = c.ancho * 0.18;
  const ez = -c.fondo * 0.12;
  o.caja(0.1, 1.9, 0.1, ex, -0.2, ez, C.viga);
  o.caja(1.3, 0.09, 0.09, ex, 1.25, ez, C.viga);
  o.caja(0.55, 0.6, 0.22, ex, 0.85, ez, 0x8c5a3c, { vari: 0.1 });
  o.caja(1.1, 0.2, 0.16, ex, 1.2, ez, 0x8c5a3c);
  o.bola(0.2, ex, 1.62, ez, 0xd9c08a, { det: 1 });
  o.cono(0.36, 0.3, ex, 1.74, ez, C.pajaOscura, { lados: 8 });
  // En otoño e invierno, gavillas y almiares en el rastrojo.
  if (c.estacion === 'otono' || c.estacion === 'invierno') {
    for (let i = 0; i < 3; i++) {
      const gx = -c.ancho * 0.3 + i * c.ancho * 0.22 + (o.azar() - 0.5) * 0.5;
      const gz = c.fondo * 0.22 + (o.azar() - 0.5) * 1.2;
      o.tejadoRedondo(0.62, 1.15, gx, 0, gz, { abomba: 0.75, lados: 8, color: C.paja });
    }
  }
  if (c.estacion === 'verano') {
    for (let i = 0; i < 3; i++) saco(o, -c.ancho / 2 + 0.5 + i * 0.5, c.fondo / 2 - 0.35);
  }
  return o.grupo();
};

const huerto: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho;
  const d = c.fondo;
  const verde = c.paleta.huerto;
  // Bancales con sus hileras.
  const filas = 4;
  for (let f = 0; f < filas; f++) {
    const z = -d / 2 + 0.9 + f * ((d - 1.8) / (filas - 1));
    o.caja(w - 1.5, 0.16, 0.62, 0, -0.04, z, C.tierraOscura, { vari: 0.08 });
    const n = Math.round((w - 1.7) / 0.5);
    for (let i = 0; i < n; i++) {
      if (o.azar() > verde + 0.15) continue;
      const x = -(w - 1.9) / 2 + (i * (w - 1.9)) / (n - 1);
      if (f % 2 === 0) {
        o.bola(0.2, x, 0.2, z, C.col, { det: 0, esc: [1, 0.75, 1], vari: 0.15 });
      } else if (f === 1) {
        o.bola(0.12, x, 0.16, z, 0x7aa052, { det: 0, vari: 0.15 });
        o.bola(0.1, x, 0.1, z + 0.14, 0xd9793a, { det: 0, vari: 0.1 });
      } else {
        o.caja(0.05, 0.85, 0.05, x, 0, z, C.maderaClara);
        o.bola(0.16, x, 0.55, z, 0x6f9a4a, { det: 0, esc: [0.9, 1.6, 0.9], vari: 0.15 });
      }
    }
  }
  // Valla baja con hueco de entrada y un cubo.
  const a = w / 2 - 0.3;
  const b = d / 2 - 0.3;
  valla(o, -a, -b, a, -b, 0.7);
  valla(o, -a, -b, -a, b, 0.7);
  valla(o, a, -b, a, b, 0.7);
  valla(o, -a, b, -0.6, b, 0.7);
  valla(o, 0.6, b, a, b, 0.7);
  o.cil(0.17, 0.14, 0.28, a - 0.4, 0, b - 0.45, C.madera, { lados: 8 });
  o.viga(-a + 0.3, 0, b - 0.35, -a + 0.45, 1.1, b - 0.5, 0.05, C.maderaClara);
  return o.grupo();
};

const gallinero: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const a = c.ancho / 2 - 0.25;
  const b = c.fondo / 2 - 0.25;
  // Caseta sobre patas con rampa.
  const cx = -a + 1.0;
  const cz = -b + 0.8;
  if (c.variante !== 0 && pieza(o, 'ea_conejera', cx + 0.1, cz + 0.1, { esc: 0.72 })) {
    // Caseta de tablas sobre patas (EmaceArt) en dos de cada tres gallineros.
  } else {
    for (const [px, pz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) o.caja(0.1, 0.6, 0.1, cx + px, -0.1, cz + pz, C.viga);
    o.caja(1.5, 0.85, 1.05, cx, 0.45, cz, C.tabla, { vari: 0.06 });
    o.caja(0.34, 0.4, 0.06, cx + 0.2, 0.5, cz + 0.53, 0x2e241c);
    o.tejado(1.05, 1.5, 0.55, cx, 1.3, cz, { eje: 'x', alero: 0.22, abomba: 0.4, cadera: 0.15, grosor: 0.16, aspas: false, comba: 0 });
    o.viga(cx + 0.2, 0.5, cz + 0.55, cx + 0.2, 0, cz + 1.5, [0.32, 0.05], C.maderaClara);
  }
  // Cercado, comedero y paja.
  valla(o, -a, -b, a, -b, 0.75);
  valla(o, -a, -b, -a, b, 0.75);
  valla(o, a, -b, a, b, 0.75);
  valla(o, -a, b, a - 0.9, b, 0.75);
  o.caja(0.7, 0.14, 0.3, a - 0.7, 0, 0.2, C.madera);
  o.bola(0.3, 0.3, 0.05, b - 0.6, C.paja, { det: 0, esc: [1.4, 0.4, 1.1] });
  return o.grupo();
};

const redil: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const a = c.ancho / 2 - 0.3;
  const b = c.fondo / 2 - 0.3;
  valla(o, -a, -b, a, -b, 1.0);
  valla(o, -a, -b, -a, b, 1.0);
  valla(o, a, -b, a, b, 1.0);
  valla(o, -a, b, -0.2, b, 1.0);
  valla(o, 1.3, b, a, b, 1.0);
  // Portilla entornada.
  o.con(-0.2, 0, b, 0.6, () => {
    o.caja(0.12, 1.05, 0.12, 0, -0.1, 0, C.viga);
    for (const h of [0.3, 0.6, 0.85]) o.viga(0, h, 0, 1.35, h, 0, [0.08, 0.04], C.maderaClara);
    o.viga(0, 0.3, 0, 1.35, 0.85, 0, [0.07, 0.04], C.maderaClara);
  });
  // Cobertizo a un agua en la esquina.
  const sx = -a + 1.4;
  const sz = -b + 1.1;
  for (const [px, pz, h] of [[-1.1, -0.8, 1.5], [1.1, -0.8, 1.5], [-1.1, 0.8, 1.9], [1.1, 0.8, 1.9]]) o.caja(0.14, h, 0.14, sx + px, -0.1, sz + pz, C.viga);
  o.caja(2.7, 0.2, 2.2, sx, 1.52, sz, C.pajaVieja, { rx: 0.22, vari: 0.06 });
  o.caja(2.2, 1.2, 0.08, sx, 0.1, sz - 0.85, C.tabla);
  o.bola(0.5, sx - 0.3, 0.12, sz - 0.2, C.paja, { det: 1, esc: [1.5, 0.5, 1.2] });
  // Abrevadero.
  o.caja(1.4, 0.35, 0.5, a - 1.1, 0, -b + 0.6, C.madera);
  o.caja(1.2, 0.04, 0.34, a - 1.1, 0.33, -b + 0.6, 0x4f8f9a, { vari: 0 });
  return o.grupo();
};

const cabanaLenador: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.6;
  const d = c.fondo * 0.52;
  const x0 = -c.ancho * 0.12;
  const z0 = -c.fondo * 0.14;
  const cabana = pieza(o, 'ea_cabana', x0, z0, { ry: -PI / 2, ancho: w + 0.45 });
  if (cabana) {
    // Cabaña de troncos con tejado de paja (EmaceArt): el humo sale por el caballete, sin chimenea.
    o.marca('humo', x0, cabana.h - 0.25, z0 - cabana.d * 0.2, 0.55);
    o.con(x0 + cabana.w / 2 - 0.25, 0, z0 + cabana.d / 2 - 0.35, 0, () => farolPared(o, 0, 1.5));
  } else {
    // Paredes de troncos cruzados en las esquinas.
    const r = 0.17;
    const hiladas = 6;
    o.caja(w - 0.2, hiladas * r * 1.9, d - 0.2, x0, 0.1, z0, 0x5a4230, { vari: 0.03 });
    for (let i = 0; i < hiladas; i++) {
      const y = 0.12 + i * r * 1.9;
      for (const s of [-1, 1]) {
        o.cil(r, r, w + 0.5, x0, y + r - (w + 0.5) / 2, z0 + s * (d / 2 - 0.08), i % 2 ? C.madera : C.maderaVieja, { rz: PI / 2, lados: 6, vari: 0.12 });
        o.cil(r, r, d + 0.5, x0 + s * (w / 2 - 0.08), y + r * 1.9 - (d + 0.5) / 2, z0, i % 2 ? C.maderaVieja : C.madera, { rx: PI / 2, lados: 6, vari: 0.12 });
      }
    }
    const yTop = 0.12 + hiladas * r * 1.9;
    o.con(x0 + 0.5, 0, z0 + d / 2 + 0.1, 0, () => {
      o.puerta(0, 0.85, 1.6, { v0: 0.1, color: C.maderaVieja });
      o.ventana(-1.25, 1.3, 0.5, 0.5, {});
    });
    o.tejado(d + 0.2, w + 0.3, 1.7, x0, yTop, z0, { eje: 'x', alero: 0.5, abomba: 0.25, cadera: 0.2, color: 0x8a7350, colorCanto: 0x6b5a3e, colorCaballete: 0x5d4d36, hastial: 0x6a4e36, colorVigas: 0x4b3323 });
    o.chimenea(x0 - w * 0.3, yTop + 0.2, z0 - d * 0.15, 2.0, { ancho: 0.55 });
  }
  // Montón de troncos, tajo con hacha y caballete de serrar.
  const px = c.ancho / 2 - 1.25;
  if (c.bib.tiene('trunk01')) o.glb('trunk01', px - 0.1, 0, -c.fondo / 2 + 1.5, { esc: 0.42, ry: PI / 2 });
  else lena(o, px, -c.fondo / 2 + 1.4, PI / 2, 1.8, 4, 1.6);
  o.cil(0.3, 0.33, 0.5, px - 0.5, 0, c.fondo / 2 - 1.1, C.maderaClara, { lados: 8 });
  o.viga(px - 0.5, 0.5, c.fondo / 2 - 1.1, px - 0.1, 1.05, c.fondo / 2 - 1.3, 0.05, C.madera);
  o.caja(0.07, 0.2, 0.26, px - 0.42, 0.5, c.fondo / 2 - 1.12, C.hierro, { rz: -0.5 });
  o.con(x0 - 0.4, 0, c.fondo / 2 - 0.8, 0.15, () => {
    for (const s of [-0.5, 0.5]) {
      o.viga(s, 0, -0.3, s, 0.75, 0.2, 0.08, C.madera);
      o.viga(s, 0, 0.3, s, 0.75, -0.2, 0.08, C.madera);
    }
    o.cil(0.14, 0.14, 1.7, 0, 0.66 - 0.85, 0, C.maderaClara, { rz: PI / 2, lados: 6 });
  });
  if (!pieza(o, 'ea_lenos', x0 - w / 2 - 0.75, z0 + 0.2, { esc: 0.6, ry: 0.4 })) lena(o, x0 - w / 2 - 0.45, z0, PI / 2, 1.8, 4, 0.6);
  pieza(o, 'ea_haz', px - 0.2, 0.2, { esc: 0.6, ry: 1.1 });
  return o.grupo();
};

const cantera: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const a = c.ancho / 2;
  const b = c.fondo / 2;
  // Frente de roca al fondo: bloques grandes facetados.
  for (let i = 0; i < 7; i++) {
    const x = -a + 0.9 + i * ((c.ancho - 1.8) / 6) + (o.azar() - 0.5) * 0.5;
    const alto = entre(o.azar, 1.3, 2.6) * (1 - Math.abs(i - 3) * 0.08);
    o.caja(entre(o.azar, 1.2, 1.8), alto + 0.5, entre(o.azar, 1.2, 1.9), x, -0.5, -b + 1.2 + (o.azar() - 0.5) * 0.5, C.piedraClara, {
      mat: 'roca', ry: (o.azar() - 0.5) * 0.7, rz: (o.azar() - 0.5) * 0.12, uv: 2.4,
    });
  }
  for (let i = 0; i < 4; i++) o.bola(entre(o.azar, 0.35, 0.6), -a + 0.8 + o.azar() * (c.ancho - 1.6), 0.15, -b + 2.5 + o.azar() * 0.6, C.piedra, { mat: 'roca', det: 0, esc: [1.2, 0.7, 1] });
  // Sillares ya cortados.
  for (let i = 0; i < 5; i++) {
    const col = i % 3;
    const fila = Math.floor(i / 3);
    o.caja(0.8, 0.45, 0.5, a - 2.4 + col * 0.86 + fila * 0.4, fila * 0.46, b - 1.0, C.piedraClara, { mat: 'piedra', ry: (o.azar() - 0.5) * 0.1, uv: 1.2 });
  }
  // Cabria de madera con su polea.
  const gx = -a + 2.0;
  const gz = b - 1.7;
  o.viga(gx - 0.9, 0, gz + 0.6, gx, 3.0, gz, 0.14, C.viga);
  o.viga(gx + 0.9, 0, gz + 0.6, gx, 3.0, gz, 0.14, C.viga);
  o.viga(gx, 0, gz - 1.1, gx, 3.0, gz, 0.14, C.viga);
  o.viga(gx, 3.0, gz, gx + 0.1, 3.3, gz + 1.0, 0.1, C.madera);
  o.viga(gx + 0.1, 3.25, gz + 0.95, gx + 0.1, 1.3, gz + 0.95, 0.03, 0xcbb894);
  o.caja(0.6, 0.5, 0.5, gx + 0.1, 0.8, gz + 0.95, C.piedraClara, { mat: 'piedra', uv: 1.2 });
  // Carretilla y pico.
  const kx = 0.6;
  const kz = b - 0.9;
  o.caja(1.3, 0.3, 0.8, kx, 0.45, kz, C.tabla);
  o.caja(1.2, 0.2, 0.7, kx, 0.72, kz, C.piedra, { mat: 'roca', uv: 1 });
  if (c.bib.tiene('wheel_l')) {
    o.glb('wheel_l', kx - 0.1, 0.42, kz + 0.5, { esc: 0.48, ry: PI / 2 });
    o.glb('wheel_r', kx - 0.1, 0.42, kz - 0.5, { esc: 0.48, ry: PI / 2 });
  }
  o.viga(kx + 0.6, 0.55, kz + 0.3, kx + 1.5, 0.75, kz + 0.3, 0.06, C.madera);
  o.viga(kx + 0.6, 0.55, kz - 0.3, kx + 1.5, 0.75, kz - 0.3, 0.06, C.madera);
  o.viga(-0.7, 0, 0.2, -0.3, 0.9, 0.5, 0.05, C.madera);
  o.viga(-0.55, 0.85, 0.42, -0.05, 0.95, 0.6, [0.06, 0.06], C.hierro);
  return o.grupo();
};

/** Rueda hidráulica: llanta, radios y palas. Gira sobre el eje x. */
function ruedaMolino(bib: Biblioteca, semilla: number, r: number, ancho: number): THREE.Group {
  const o = new Obra(bib, semilla);
  const n = 12;
  for (const s of [-1, 1]) {
    const x = (s * ancho) / 2;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * PI * 2;
      const a1 = ((i + 1) / n) * PI * 2;
      o.viga(x, Math.cos(a0) * r, Math.sin(a0) * r, x, Math.cos(a1) * r, Math.sin(a1) * r, [0.1, 0.22], C.madera, { vari: 0.1 });
      o.viga(x, Math.cos(a0) * r * 0.62, Math.sin(a0) * r * 0.62, x, Math.cos(a1) * r * 0.62, Math.sin(a1) * r * 0.62, [0.07, 0.1], C.maderaVieja);
    }
    for (let i = 0; i < n / 2; i++) {
      const a = (i / (n / 2)) * PI * 2;
      o.viga(x, 0, 0, x, Math.cos(a) * r, Math.sin(a) * r, [0.08, 0.14], C.viga);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * PI * 2;
    o.con(0, 0, 0, 0, () => {
      const g = new THREE.BoxGeometry(ancho + 0.1, 0.46, 0.05);
      const m = new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(0, r * 0.95, 0));
      o.malla(g, C.maderaClara, { vari: 0.12 }, m);
    });
  }
  o.cil(0.2, 0.2, ancho + 1.2, 0, -(ancho + 1.2) / 2, 0, C.viga, { rz: PI / 2, lados: 8 });
  const g = o.grupo();
  g.userData['giro'] = { eje: 'x', vel: 0.55 };
  return g;
}

const molino: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  // El cuerpo va al oeste de la huella; la rueda, al este (hacia el agua).
  const w = c.ancho * 0.6;
  const d = c.fondo * 0.58;
  const x0 = -c.ancho * 0.14;
  const z0 = -c.fondo * 0.04;
  const h = casa(o, {
    w, d, alto: 2.4, piso2: 1.8, cumbre: 2.5, eje: 'z', bajoPiedra: true, vuelo: 0.18, zocalo: 0.3,
    puerta: { lado: 0, u: -w * 0.18, color: C.puerta, arco: true, ancho: 1.05 },
    tejado: { abomba: 0.5, alero: 0.45, cadera: 0.9 },
    ciegas: [1],
  }, x0, z0);
  // La rueda va en el costado este. Si el molino está en el sitio que marca el paisaje, el terreno
  // le abre un caz hasta el río; si no, queda medio hundida en su foso. Arriba, un canal de madera.
  const R = 1.95;
  const xr = x0 + w / 2 + 0.95;
  const yr = R - 0.42;
  const zr = z0 + 0.2;
  const rueda = ruedaMolino(c.bib, c.semilla + 3, R, 0.8);
  rueda.position.set(xr, yr, zr);
  o.vivo(rueda);
  // Muretes de piedra a los lados del foso de la rueda.
  for (const s of [-1, 1]) o.caja(1.5, 0.95, 0.3, xr - 0.1, -0.7, zr + s * (R + 0.5), C.piedra, { mat: 'piedra', uv: 1.5 });
  // Apoyo exterior del eje y canal de madera que trae el agua.
  o.caja(0.45, yr + 1.5, 0.6, xr + 1.05, -1.3, zr, C.piedra, { mat: 'piedra', uv: 1.5 });
  const yc = yr + R + 0.15;
  o.caja(0.95, 0.08, c.fondo * 0.5, xr, yc, z0 - c.fondo * 0.22, C.tabla);
  for (const s of [-1, 1]) o.caja(0.07, 0.3, c.fondo * 0.5, xr + s * 0.46, yc, z0 - c.fondo * 0.22, C.madera);
  o.caja(0.8, 0.03, c.fondo * 0.48, xr, yc + 0.1, z0 - c.fondo * 0.22, 0x6fb0c0, { vari: 0 });
  o.caja(0.7, 0.75, 0.07, xr, yc - 0.62, z0 + c.fondo * 0.03 + 0.02, 0xc4e6ee, { vari: 0 });
  for (const zz of [z0 - c.fondo * 0.42, z0 - c.fondo * 0.2]) {
    o.viga(xr - 0.42, -0.4, zz, xr - 0.42, yc, zz, 0.13, C.viga);
    o.viga(xr + 0.42, -0.4, zz, xr + 0.42, yc, zz, 0.13, C.viga);
  }
  o.chimenea(x0 - w * 0.25, h.yAlero + 0.4, z0 - d * 0.2, 2.6);
  // Sacos, muela y farol junto a la puerta.
  const frente = z0 + d / 2;
  saco(o, x0 + w * 0.2, frente + 0.5);
  saco(o, x0 + w * 0.2 + 0.5, frente + 0.4);
  saco(o, x0 + w * 0.2 + 0.25, frente + 0.45, 0.42);
  o.cil(0.55, 0.55, 0.2, x0 - w / 2 - 0.25, 0.5, frente - 0.5, C.piedraClara, { rz: PI / 2 - 0.25, lados: 12 });
  o.con(x0 - w * 0.18 + 0.9, 0, frente + 0.2, 0, () => {
    farolPared(o, 0, 2.0);
    letrero(o, -1.9, 2.2, 'saco', 0x7a5a3c);
  });
  barril(o, x0 - w / 2 + 0.2, frente + 0.55, 0.85);
  return o.grupo();
};

const panaderia: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.6;
  const d = c.fondo * 0.58;
  const x0 = -c.ancho * 0.12;
  const z0 = -c.fondo * 0.1;
  const h = casa(o, {
    w, d, alto: 2.05, cumbre: 2.3, eje: 'z', cal: C.calOcre, contras: 0xb07a2e,
    puerta: { lado: 0, u: -w * 0.2, color: C.puertaRoja },
    tejado: { abomba: 0.5, alero: 0.42, cadera: 0.75 },
    ciegas: [1],
  }, x0, z0);
  // Horno de bóveda adosado, con su boca encendida y chimenea de ladrillo.
  const hx = x0 + w / 2 + 0.75;
  const hz = z0 + 0.1;
  o.caja(1.7, 0.75, 1.9, hx, -0.3, hz, C.piedra, { mat: 'ladrillo', uv: 1.4 });
  o.bola(0.95, hx, 0.42, hz, 0xe0cba6, { det: 1, esc: [0.92, 1.0, 1.02], vari: 0.03 });
  o.caja(0.5, 0.36, 0.1, hx, 0.55, hz + 0.93, 0x241c18);
  o.caja(0.38, 0.22, 0.06, hx, 0.58, hz + 0.96, C.brasa, { luz: 2, vari: 0 });
  o.chimenea(hx, 1.1, hz - 0.5, h.yAlero + 0.9, { ancho: 0.5, mat: 'ladrillo', humo: 1.3 });
  o.marca('luz', hx, 0.7, hz + 1.3, 0.7);
  // Mesa con hogazas bajo un toldillo y letrero.
  const frente = z0 + d / 2;
  const mx = x0 + w * 0.22;
  o.caja(1.5, 0.08, 0.7, mx, 0.78, frente + 0.75, C.maderaClara);
  for (const s of [-0.65, 0.65]) o.caja(0.08, 0.78, 0.6, mx + s, 0, frente + 0.75, C.viga);
  for (let i = 0; i < 6; i++) o.bola(0.15, mx - 0.55 + (i % 3) * 0.5 + (o.azar() - 0.5) * 0.1, 0.95, frente + 0.6 + Math.floor(i / 3) * 0.3, i % 2 ? 0xc98f4a : 0xdaa560, { det: 0, esc: [1.2, 0.7, 0.9], vari: 0.08 });
  o.con(x0 - w * 0.2 - 0.85, 0, frente + 0.03, 0, () => letrero(o, 0, 2.1, 'pan', 0x8c5a2e));
  cajita(o, mx + 1.0, frente + 0.5);
  saco(o, x0 - w / 2 - 0.2, frente + 0.3);
  flores(o, x0 - w / 2 - 0.3, frente + 0.9, 3, 0.3);
  return o.grupo();
};

const granero: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.66;
  const d = c.fondo * 0.7;
  const z0 = -c.fondo * 0.04;
  if (conPack(c, 'ea_pajar')) {
    // Pajar de tablas con cobertizo (EmaceArt), con el hastial hacia la fachada.
    const pajar = pieza(o, 'ea_pajar', 0, z0, { ry: PI / 2, ancho: c.ancho * 0.88 })!;
    const bx = pajar.w / 2 - 0.9;
    pieza(o, 'ea_bala', bx, z0 + pajar.d / 2 + 0.1, { esc: 1.6, ry: 0.3 });
    pieza(o, 'ea_bala', bx - 0.8, z0 + pajar.d / 2 + 0.25, { esc: 1.6, ry: 1.5 });
    pieza(o, 'ea_saco', -bx, z0 + pajar.d / 2 + 0.15, { esc: 0.9, ry: 0.5 });
    pieza(o, 'ea_saco', -bx + 0.7, z0 + pajar.d / 2 + 0.3, { esc: 0.8, ry: 2.2 });
    return o.grupo();
  }
  // Pilares con su losa (para que no suban los ratones).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const px = sx * (w / 2 - 0.35);
      const pz = z0 + sz * (d / 2 - 0.4);
      o.cil(0.2, 0.28, 1.0, px, -0.3, pz, C.piedra, { lados: 7 });
      o.cil(0.46, 0.46, 0.12, px, 0.7, pz, C.piedraClara, { lados: 8 });
    }
  }
  const y0 = 0.82;
  o.caja(w + 0.2, 0.16, d + 0.2, 0, y0, z0, C.viga);
  o.caja(w, 1.9, d, 0, y0 + 0.16, z0, C.tabla, { mat: 'tabla', uv: 2.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.caja(0.16, 1.95, 0.16, sx * (w / 2), y0 + 0.16, z0 + sz * (d / 2), C.viga);
  for (const sx of [-1, 1]) {
    o.viga(sx * (w / 2 + 0.02), y0 + 0.3, z0 - d / 2, sx * (w / 2 + 0.02), y0 + 1.9, z0, 0.1, C.viga);
    o.viga(sx * (w / 2 + 0.02), y0 + 1.9, z0, sx * (w / 2 + 0.02), y0 + 0.3, z0 + d / 2, 0.1, C.viga);
  }
  o.con(0, 0, z0 + d / 2, 0, () => {
    o.puerta(0, 1.0, 1.5, { v0: y0 + 0.16, color: C.maderaVieja, escalon: false });
    o.caja(0.5, 0.4, 0.06, 0, y0 + 2.0, 0.02, 0x2e241c);
  });
  o.tejado(w, d, 2.1, 0, y0 + 2.06, z0, { alero: 0.55, abomba: 0.55, cadera: 1.3, color: C.paja });
  if (c.bib.tiene('ladder')) o.glb('ladder', 0.15, 0, z0 + d / 2 + 0.55, { esc: 0.42, rx: -0.3 });
  else o.viga(0, 0, z0 + d / 2 + 0.7, 0, y0 + 0.2, z0 + d / 2 + 0.1, [0.5, 0.06], C.madera);
  // Balas de paja y sacos.
  const bx = w / 2 + 0.55;
  o.cil(0.45, 0.45, 0.8, bx - 0.4, 0.45 - 0.4, z0 + 1.2, C.paja, { rz: PI / 2, lados: 10 });
  o.cil(0.45, 0.45, 0.8, bx - 0.4, 0.45 - 0.4, z0 + 0.2, C.pajaVieja, { rz: PI / 2, lados: 10 });
  saco(o, -bx + 0.3, z0 + d / 2 + 0.2);
  saco(o, -bx + 0.75, z0 + d / 2 + 0.4);
  cajon(o, -bx + 0.4, z0 - 0.8, 0.8);
  return o.grupo();
};

const herreria: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.52;
  const d = c.fondo * 0.6;
  const x0 = -c.ancho * 0.18;
  const z0 = -c.fondo * 0.1;
  const h = casa(o, {
    w, d, alto: 2.3, cumbre: 2.0, eje: 'z', bajoPiedra: true,
    puerta: { lado: 0, u: 0, color: 0x4a3526, ancho: 1.0 },
    tejado: { mat: 'pizarra', abomba: 0.1, alero: 0.35, cadera: 0.15, comba: 0, colorCanto: C.pizarra, hastial: C.piedra, matHastial: 'piedra', tramos: 2 },
    ciegas: [1],
  }, x0, z0);
  // Cobertizo abierto de la fragua.
  const fx = x0 + w / 2 + 1.2;
  const fz = z0 + 0.2;
  for (const [px, pz] of [[1.1, -1.3], [1.1, 1.3]]) o.caja(0.18, 2.3, 0.18, fx + px, -0.1, fz + pz, C.viga);
  o.caja(2.7, 0.14, 3.2, fx, 2.25, fz, 0x7a6248, { rz: -0.2, vari: 0.05 });
  o.caja(2.75, 0.06, 3.3, fx, 2.36, fz, 0x5d6b7c, { rz: -0.2, vari: 0.05 });
  // Fragua con brasas, fuelle, yunque y pila de agua.
  o.caja(1.2, 0.8, 1.0, fx - 0.5, -0.1, fz - 1.0, C.piedra, { mat: 'ladrillo', uv: 1.3 });
  o.caja(0.8, 0.1, 0.6, fx - 0.5, 0.68, fz - 1.0, C.brasa, { luz: 2, vari: 0 });
  o.marca('luz', fx - 0.5, 1.0, fz - 0.6, 1.0);
  o.chimenea(fx - 0.5, 0.7, fz - 1.35, h.yAlero + 1.6, { ancho: 0.6, mat: 'ladrillo', humo: 1.5 });
  o.cil(0.28, 0.3, 0.5, fx + 0.1, 0, fz + 0.3, C.maderaVieja, { lados: 8 });
  o.caja(0.6, 0.16, 0.24, fx + 0.1, 0.62, fz + 0.3, C.hierro);
  o.caja(0.3, 0.14, 0.2, fx + 0.1, 0.5, fz + 0.3, C.hierro);
  o.cono(0.12, 0.3, fx + 0.5, 0.63, fz + 0.3, C.hierro, { rz: -PI / 2, lados: 6 });
  barril(o, fx + 0.7, fz + 1.1, 0.8);
  o.viga(fx - 1.05, 0, fz + 1.2, fx - 1.0, 1.3, fz + 1.35, 0.05, C.madera);
  o.viga(fx - 0.85, 0, fz + 1.25, fx - 0.8, 1.2, fz + 1.4, 0.05, C.hierro);
  const frente = z0 + d / 2;
  o.con(x0 - 0.95, 0, frente + 0.03, 0, () => letrero(o, 0, 2.2, 'herradura', 0x4a4a4e));
  cajon(o, x0 - w / 2 - 0.2, frente + 0.5, 0.75);
  return o.grupo();
};

const taberna: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.68;
  const d = c.fondo * 0.58;
  const x0 = -c.ancho * 0.05;
  const z0 = -c.fondo * 0.1;
  const h = casa(o, {
    w, d, alto: 2.1, piso2: 1.7, cumbre: 2.4, eje: 'x', cal: C.calRosa, contras: 0x8c3f32, vuelo: 0.25,
    puerta: { lado: 0, u: 0, color: C.puertaRoja, ancho: 1.1, arco: true },
    tejado: { abomba: 0.5, alero: 0.45, cadera: 0.3 },
  }, x0, z0);
  o.chimenea(x0 + w * 0.3, h.yAlero + 0.25, z0 - d * 0.12, 2.7, { ancho: 0.68, humo: 1.2 });
  const frente = z0 + d / 2;
  o.con(x0, 0, frente + 0.03, 0, () => {
    letrero(o, 1.0, 2.35, 'jarra', 0x8c3f32);
    farolPared(o, -0.95, 2.0);
  });
  // Barriles apilados, mesa y bancos en la puerta.
  const bx = x0 + w / 2 + 0.3;
  barril(o, bx, frente - 0.3, 0.95);
  barril(o, bx + 0.1, frente + 0.5, 0.95);
  barril(o, bx + 0.05, frente + 0.1, 0.85, 0.93);
  const mx = x0 - w * 0.3;
  o.caja(1.6, 0.08, 0.7, mx, 0.7, frente + 1.0, C.madera);
  for (const s of [-0.6, 0.6]) o.caja(0.1, 0.7, 0.5, mx + s, 0, frente + 1.0, C.viga);
  banco(o, mx, frente + 0.4, 0, 0.6);
  banco(o, mx, frente + 1.6, 0, 0.6);
  o.cil(0.07, 0.06, 0.16, mx - 0.3, 0.78, frente + 0.95, 0xcab07a, { lados: 6 });
  o.cil(0.07, 0.06, 0.16, mx + 0.35, 0.78, frente + 1.1, 0xcab07a, { lados: 6 });
  cajon(o, x0 + w * 0.32, frente + 0.6, 0.7);
  return o.grupo();
};

const iglesia: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.62;
  const d = c.fondo * 0.6;
  const z0 = -c.fondo * 0.12;
  const alto = 3.4;
  const piedra = { mat: 'piedra' as ClaveMaterial, uv: 2 };
  // Nave.
  o.caja(w + 0.3, 1.0, d + 0.3, 0, -0.6, z0, C.piedraOscura, piedra);
  o.caja(w, alto, d, 0, 0.3, z0, C.piedra, piedra);
  o.tejado(w, d, 2.6, 0, alto + 0.3, z0, { mat: 'pizarra', abomba: 0.06, alero: 0.35, cadera: 0, comba: 0, colorCanto: C.pizarra, hastial: C.piedra, matHastial: 'piedra', tramos: 2 });
  // Contrafuertes y ventanas de arco en los costados.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = z0 - d / 2 + 0.7 + i * ((d - 1.4) / 2);
      o.caja(0.5, alto * 0.8, 0.55, s * (w / 2 + 0.2), 0, z, C.piedraOscura, piedra);
      o.caja(0.5, 0.3, 0.55, s * (w / 2 + 0.12), alto * 0.8 - 0.05, z, C.piedraClara, { ...piedra, rz: s * 0.5 });
    }
    o.con(s * (w / 2), 0, z0, (s * PI) / 2, () => {
      for (const u of [-(d - 1.4) / 4, (d - 1.4) / 4]) o.ventana(u, 2.1, 0.55, 1.2, { arco: true, marco: C.piedraOscura, cruceta: false, luz: 0.9 });
    });
  }
  // Ábside redondo al fondo.
  o.cil(w * 0.34, w * 0.34, alto * 0.85, 0, 0.1, z0 - d / 2, C.piedra, { ...piedra, lados: 10 });
  o.tejadoRedondo(w * 0.34 + 0.25, 1.5, 0, alto * 0.85 + 0.1, z0 - d / 2, { mat: 'pizarra', abomba: 0.15, lados: 10 });
  // Torre del campanario al frente.
  const tw = 2.5;
  const tz = z0 + d / 2 + tw / 2 - 0.5;
  const th = 7.2;
  o.caja(tw + 0.3, 1.2, tw + 0.3, 0, -0.6, tz, C.piedraOscura, piedra);
  o.caja(tw, th, tw, 0, 0.3, tz, C.piedra, piedra);
  o.caja(tw + 0.2, 0.2, tw + 0.2, 0, th * 0.62, tz, C.piedraClara, piedra);
  o.caja(tw + 0.3, 0.25, tw + 0.3, 0, th + 0.3, tz, C.piedraClara, piedra);
  for (let lado = 0; lado < 4; lado++) {
    const ry = (lado * PI) / 2;
    o.con(Math.sin(ry) * (tw / 2), 0, tz + Math.cos(ry) * (tw / 2), ry, () => {
      // Vano del campanario.
      o.caja(0.7, 1.2, 0.1, 0, th - 1.6, 0.0, 0x1f1a18);
      o.cil(0.35, 0.35, 0.1, 0, th - 0.45, 0, 0x1f1a18, { rx: PI / 2, lados: 10 });
      if (lado === 0) {
        o.puerta(0, 1.3, 2.0, { v0: 0.3, color: 0x5a3a26, arco: true, marco: C.piedraOscura });
        o.ventana(0, 4.3, 0.6, 0.6, { arco: true, marco: C.piedraOscura, cruceta: false, luz: 0.8 });
        o.caja(1.9, 0.14, 0.7, 0, 0.16, 0.5, C.piedraClara, piedra);
        o.caja(2.3, 0.14, 0.9, 0, 0.02, 0.6, C.piedraClara, piedra);
      }
    });
  }
  o.cono(0.3, 0.45, 0, th - 1.25, tz, 0xc9a23a, { lados: 8 });
  o.malla(new THREE.ConeGeometry(tw * 0.78, 3.2, 4, 1), C.pizarra, { mat: 'pizarra' }, new THREE.Matrix4().makeTranslation(0, th + 0.55 + 1.6, tz).multiply(new THREE.Matrix4().makeRotationY(PI / 4)));
  const yc = th + 0.55 + 3.2;
  o.caja(0.09, 0.9, 0.09, 0, yc - 0.1, tz, C.hierro);
  o.caja(0.5, 0.09, 0.09, 0, yc + 0.4, tz, C.hierro);
  o.con(0.95, 0, tz + tw / 2, 0, () => farolPared(o, 0, 2.1));
  flores(o, -w / 2 - 0.3, z0 + d / 2 + 1.0, 4, 0.45, [0xffffff, 0xf2c94c]);
  arbusto(o, w / 2 + 0.5, z0 + d / 2 + 1.2, 0.5, c.paleta.pinos[1]);
  return o.grupo();
};

const escribania: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.62;
  const d = c.fondo * 0.6;
  const z0 = -c.fondo * 0.12;
  const h = casa(o, {
    w, d, alto: 2.2, cumbre: 2.5, eje: 'z', cal: C.cal, contras: C.puertaAzul,
    puerta: { lado: 0, u: 0, color: C.puertaAzul },
    tejado: { abomba: 0.45, alero: 0.42, cadera: 0.3 },
  }, 0, z0);
  o.chimenea(-w * 0.26, h.yAlero + 0.2, z0 - d * 0.25, 2.6, { ancho: 0.55 });
  // Porche con tejadillo sobre la puerta.
  const frente = z0 + d / 2;
  for (const s of [-0.9, 0.9]) o.caja(0.13, 2.1, 0.13, s, 0, frente + 1.0, C.viga);
  o.tejado(1.1, 2.4, 0.5, 0, 2.1, frente + 0.5, { eje: 'x', alero: 0.18, abomba: 0.3, cadera: 0.1, grosor: 0.16, aspas: false, comba: 0 });
  o.con(0, 0, frente + 0.03, 0, () => letrero(o, 1.35, 2.2, 'pluma', C.puertaAzul));
  // Tablón de edictos y banco.
  const tx = -w / 2 - 0.55;
  o.caja(0.1, 1.7, 0.1, tx - 0.45, 0, frente + 0.6, C.viga);
  o.caja(0.1, 1.7, 0.1, tx + 0.45, 0, frente + 0.6, C.viga);
  o.caja(1.1, 0.75, 0.06, tx, 0.9, frente + 0.6, C.tabla);
  o.caja(0.35, 0.45, 0.02, tx - 0.2, 1.05, frente + 0.64, 0xf0e6cc, { rz: 0.05, vari: 0 });
  o.caja(0.3, 0.35, 0.02, tx + 0.25, 1.1, frente + 0.64, 0xe8dcc0, { rz: -0.08, vari: 0 });
  banco(o, w / 2 + 0.1, frente + 0.5, PI / 2, 0.55);
  flores(o, w * 0.3, frente + 1.5, 3, 0.3, [0x86a8d6, 0xffffff]);
  return o.grupo();
};

const botica: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.6;
  const d = c.fondo * 0.56;
  const x0 = c.ancho * 0.06;
  const z0 = -c.fondo * 0.12;
  const h = casa(o, {
    w, d, alto: 1.9, cumbre: 2.9, eje: 'x', cal: C.calSombra, contras: C.puertaVerde,
    puerta: { lado: 0, u: w * 0.22, color: C.puertaVerde, arco: true },
    tejado: { abomba: 0.6, alero: 0.5, cadera: 0.9, color: C.pajaVieja, comba: 0.12 },
  }, x0, z0);
  o.chimenea(x0 - w * 0.25, h.yAlero + 0.3, z0, 3.0, { ancho: 0.5, humo: 0.8 });
  const frente = z0 + d / 2;
  // Manojos de hierbas colgados del alero.
  for (let i = 0; i < 5; i++) {
    const u = x0 - w * 0.4 + i * 0.36;
    o.viga(u, h.yAlero - 0.1, frente + 0.3, u, h.yAlero - 0.45, frente + 0.3, 0.02, 0xcbb894);
    o.bola(0.1, u, h.yAlero - 0.55, frente + 0.3, [0x7f9a55, 0x9a7fb5, 0xb59a55][i % 3], { det: 0, esc: [0.8, 1.6, 0.8] });
  }
  o.con(x0, 0, frente + 0.03, 0, () => letrero(o, -w * 0.32, 2.0, 'hoja', 0x4f6b4a));
  // Jardín de hierbas, caldero al fuego y setas.
  const jx = -c.ancho / 2 + 1.0;
  o.caja(1.5, 0.14, 1.8, jx, -0.03, 0.9, C.tierraOscura);
  flores(o, jx, 0.9, 9, 0.7, [0x9a7fb5, 0xe2c84a, 0xffffff, 0x7fb5a0]);
  const kx = x0 + w * 0.05;
  const kz = c.fondo / 2 - 0.8;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    o.viga(kx + Math.cos(a) * 0.5, 0, kz + Math.sin(a) * 0.5, kx, 1.2, kz, 0.05, C.viga);
  }
  o.viga(kx, 1.15, kz, kx, 0.65, kz, 0.02, C.hierro);
  o.bola(0.26, kx, 0.45, kz, C.hierro, { det: 1, esc: [1, 0.85, 1] });
  o.cil(0.2, 0.2, 0.03, kx, 0.56, kz, 0x8fd16a, { lados: 8, luz: 0.5, vari: 0 });
  o.bola(0.14, kx, 0.08, kz, C.brasa, { det: 0, esc: [1.4, 0.5, 1.4], luz: 2, vari: 0 });
  o.marca('humo', kx, 0.9, kz, 0.4);
  for (let i = 0; i < 4; i++) {
    const sx = x0 + w / 2 + 0.2 + o.azar() * 0.5;
    const sz = z0 + o.azar() * 1.6;
    o.cil(0.04, 0.05, 0.14, sx, 0, sz, 0xf0e6d0, { lados: 5 });
    o.cono(0.12, 0.1, sx, 0.12, sz, 0xb5483a, { lados: 6 });
  }
  // El gato en el poyete.
  const gx = x0 - w * 0.3;
  o.bola(0.13, gx, 0.2, frente + 0.25, 0x2b2826, { det: 0, esc: [1, 1.2, 1.3] });
  o.bola(0.09, gx, 0.4, frente + 0.33, 0x2b2826, { det: 0 });
  for (const s of [-1, 1]) o.cono(0.03, 0.07, gx + s * 0.05, 0.46, frente + 0.33, 0x2b2826, { lados: 4 });
  return o.grupo();
};

const mercado: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const m = c.bib.modelos.get('market03');
  let w = c.ancho * 0.72;
  let frente = c.fondo * 0.25;
  if (m) {
    // El armazón de troncos es del pack; el toldo, el mostrador y el género son nuestros.
    const s = Math.min((c.ancho * 0.84) / m.tam.x, (c.fondo * 0.84) / m.tam.z);
    const ox = -((m.min.x + m.max.x) / 2) * s;
    const oz = -((m.min.z + m.max.z) / 2) * s - 0.2;
    o.glb('market03', ox, 0, oz, { esc: s });
    const x0 = ox + m.min.x * s - 0.1;
    const x1 = ox + m.max.x * s + 0.1;
    const zA = oz + m.min.z * s - 0.25;
    const zB = oz + m.max.z * s + 0.35;
    const yA = 2.9 * s + 0.12;
    const yB = 4.08 * s + 0.12;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      o.viga(x, yA, zA, x, yB, zB, [(x1 - x0) / n, 0.05], i % 2 ? 0xf0e6d0 : 0xb5483a, { vari: 0.03 });
      // Faldón que cuelga por delante.
      o.caja((x1 - x0) / n, 0.3, 0.04, x, yB - 0.3, zB + 0.01, i % 2 ? 0xf0e6d0 : 0xb5483a, { vari: 0.03 });
    }
    w = (x1 - x0) * 0.8;
    frente = zB - 1.0;
  } else {
    const d = c.fondo * 0.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.caja(0.14, sz > 0 ? 2.1 : 2.6, 0.14, (sx * w) / 2, 0, (sz * d) / 2, C.viga);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 - 0.2 + ((w + 0.4) * (i + 0.5)) / n;
      o.caja((w + 0.4) / n, 0.06, d + 0.7, x, 2.32, 0.05, i % 2 ? 0xf0e6d0 : 0xb5483a, { rx: 0.24, vari: 0.02 });
    }
  }
  // Mostrador con género.
  o.caja(w, 0.85, 0.8, 0, 0, frente, C.tabla, { vari: 0.05 });
  o.caja(w + 0.2, 0.07, 1.0, 0, 0.85, frente, C.maderaClara);
  const generos = [0xd9534a, 0xe2a93a, 0x8fb56a, 0xd9a85a, 0x9a6fb0];
  for (let i = 0; i < 14; i++) {
    const x = -w / 2 + 0.25 + (i % 7) * ((w - 0.5) / 6);
    o.bola(0.13, x + (o.azar() - 0.5) * 0.08, 1.02, frente - 0.2 + Math.floor(i / 7) * 0.4, generos[Math.floor(o.azar() * generos.length)], { det: 0, vari: 0.1 });
  }
  // Cestos, sacos y cajas alrededor.
  o.cil(0.3, 0.24, 0.3, -w / 2 + 0.3, 0, frente - 1.3, C.pajaSombra, { lados: 8 });
  for (let i = 0; i < 5; i++) o.bola(0.1, -w / 2 + 0.3 + (o.azar() - 0.5) * 0.3, 0.32, frente - 1.3 + (o.azar() - 0.5) * 0.3, 0xc9392e, { det: 0 });
  saco(o, w / 2 - 0.3, frente - 1.2);
  saco(o, w / 2 - 0.8, frente - 1.4);
  cajon(o, -w / 2 - 0.35, frente + 0.2, 0.8);
  cajita(o, -w / 2 - 0.3, frente + 0.2, 0.62);
  barril(o, w / 2 + 0.4, frente + 0.1, 0.9);
  cajon(o, 0.4, frente - 2.0, 0.7);
  pieza(o, 'ea_cesto_verduras', -0.5, frente + 0.85, { esc: 0.9, ry: 0.3 });
  pieza(o, 'ea_cesto', w / 2 - 0.2, frente + 0.8, { esc: 0.8 });
  return o.grupo();
};

const torre: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = Math.min(c.ancho, c.fondo) * 0.68;
  if (conPack(c, 'ea_torre')) {
    // Torre de troncos con escalera y tejado de tablas (EmaceArt).
    const t = pieza(o, 'ea_torre', 0, 0, { ancho: Math.min(c.ancho, c.fondo) * 1.12, y: -0.2 })!;
    o.viga(0, t.h - 0.4, 0, 0, t.h + 0.9, 0, 0.05, C.viga);
    o.caja(0.8, 0.42, 0.03, 0.42, t.h + 0.4, 0, 0xa3352c, { vari: 0 });
    if (c.bib.tiene('brazier')) {
      o.glb('brazier', -1.3, 0, t.d / 2 - 0.3, { esc: 0.8, ry: 0.4 });
      o.marca('fuego', -1.3, 0.45, t.d / 2 - 0.3, 0.45);
    }
    return o.grupo();
  }
  const alto = 6.6;
  const piedra = { mat: 'piedra' as ClaveMaterial, uv: 2 };
  o.caja(w + 0.35, 1.5, w + 0.35, 0, -0.7, 0, C.piedraOscura, piedra);
  o.caja(w, alto, w, 0, 0.3, 0, C.piedra, piedra);
  // Cadalso de madera en voladizo y tejado de pizarra.
  const cw = w + 0.9;
  o.caja(cw, 0.16, cw, 0, alto + 0.2, 0, C.viga);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const p = -w / 2 + 0.2 + (i * (w - 0.4)) / 3;
      o.viga(s * (w / 2), alto - 0.5, p, s * (cw / 2 - 0.05), alto + 0.2, p, 0.1, C.viga);
      o.viga(p, alto - 0.5, s * (w / 2), p, alto + 0.2, s * (cw / 2 - 0.05), 0.1, C.viga);
    }
  }
  o.caja(cw, 1.3, cw, 0, alto + 0.36, 0, C.tabla, { mat: 'tabla', uv: 2 });
  for (let lado = 0; lado < 4; lado++) {
    const ry = (lado * PI) / 2;
    o.con(Math.sin(ry) * (cw / 2), 0, Math.cos(ry) * (cw / 2), ry, () => {
      o.caja(0.7, 0.5, 0.06, -0.55, alto + 0.85, 0, 0x241c18, { luz: lado % 2 ? 0.5 : 0 });
      o.caja(0.7, 0.5, 0.06, 0.55, alto + 0.85, 0, 0x241c18);
    });
    o.con(Math.sin(ry) * (w / 2), 0, Math.cos(ry) * (w / 2), ry, () => {
      o.caja(0.14, 0.7, 0.06, 0, alto * 0.5, 0, 0x1f1a18);
      if (lado === 0) o.puerta(0, 0.95, 1.75, { v0: 0.3, color: 0x4a3526, arco: true, marco: C.piedraOscura });
    });
  }
  o.malla(new THREE.ConeGeometry(cw * 0.8, 2.3, 4, 1), C.pizarra, { mat: 'pizarra' }, new THREE.Matrix4().makeTranslation(0, alto + 1.66 + 1.15, 0).multiply(new THREE.Matrix4().makeRotationY(PI / 4)));
  // Banderín.
  const yb = alto + 1.66 + 2.3;
  o.viga(0, yb - 0.1, 0, 0, yb + 1.2, 0, 0.05, C.viga);
  o.caja(0.8, 0.42, 0.03, 0.42, yb + 0.7, 0, 0xa3352c, { vari: 0 });
  o.con(0.85, 0, w / 2, 0, () => farolPared(o, 0, 2.0));
  // El brasero de la guardia, a la puerta.
  if (c.bib.tiene('brazier')) {
    o.glb('brazier', -1.0, 0, w / 2 + 0.55, { esc: 0.8, ry: 0.4 });
    o.marca('fuego', -1.0, 0.45, w / 2 + 0.55, 0.45);
  }
  return o.grupo();
};

/** Lanza de pie o apoyada: asta de madera y moharra de hierro, de (x0, z0) en el suelo a (x1, z1) en lo alto. */
function lanza(o: Obra, x0: number, z0: number, x1: number, z1: number, alto = 2.3, y0 = 0): void {
  o.viga(x0, y0, z0, x1, y0 + alto, z1, 0.045, C.maderaClara, { vari: 0.1 });
  const dx = (x1 - x0) / alto;
  const dz = (z1 - z0) / alto;
  o.viga(x1, y0 + alto, z1, x1 + dx * 0.3, y0 + alto + 0.3, z1 + dz * 0.3, [0.09, 0.03], 0xb9bcc2, { vari: 0.02 });
}

/** Rodela: escudo redondo de tablas con su umbo, de cara a +z en el plano local. */
function rodela(o: Obra, x: number, y: number, z: number, color: number, r = 0.3): void {
  o.cil(r, r, 0.06, x, y - 0.03, z, color, { rx: PI / 2, lados: 10, vari: 0.03 });
  o.cil(r * 0.3, r * 0.3, 0.1, x, y - 0.05, z + 0.03, 0xb9bcc2, { rx: PI / 2, lados: 8, vari: 0.02 });
}

const cuartel: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const a = c.ancho / 2;
  const b = c.fondo / 2;
  const pendon = 0xa3352c;

  // La casa larga de la tropa, al fondo: jergones dentro y el patio delante.
  let w = c.ancho * 0.86;
  let d = c.fondo * 0.44;
  let z0 = -b + d / 2 + 0.25;
  let yAlero: number;
  let yCumbre: number;
  if (conPiezas(c)) {
    // Una de cada tres, con muros de entramado y tejado largo de paja de EmaceArt.
    const e = 0.44;
    const tejado = c.bib.modelos.get('ea_tejado_paja_largo')!;
    z0 = -b + (8.3 * e) / 2 + 0.2;
    const t = casaDePiezas(o, 0, z0, {
      e, zocalo: 0.3, tejado: 'ea_tejado_paja_largo', largoTejado: Math.min(tejado.tam.x, (c.ancho * 0.84) / e + 2),
      sur: ['ea_muro_ventanas', 'ea_muro_puerta', 'ea_muro_ventanas'], norte: ['ea_muro_liso', 'ea_muro_liso', 'ea_muro_liso'],
      oeste: 'ea_muro_liso', este: 'ea_muro_liso',
    });
    w = t.w;
    d = t.d;
    yAlero = t.yAlero;
    yCumbre = t.h;
  } else {
    const h = casa(o, {
      w, d, alto: 2.25, cumbre: 1.9, eje: 'x', bajoPiedra: true, zocalo: 0.3, contras: 0x6e2f28, jardineras: false,
      puerta: { lado: 0, u: 0, color: 0x5a2f25, ancho: 1.15, arco: true },
      tejado: c.variante === 2
        ? { abomba: 0.35, alero: 0.4, cadera: 0.25, color: C.pajaOscura }
        : { mat: 'pizarra', abomba: 0.12, alero: 0.38, cadera: 0.2, comba: 0, colorCanto: C.pizarra, hastial: C.piedra, matHastial: 'piedra', tramos: 3 },
    }, 0, z0);
    yAlero = h.yAlero;
    yCumbre = h.yCumbre;
    o.chimenea(-w * 0.34, yAlero + 0.15, z0 - d * 0.1, 2.2, { ancho: 0.6, mat: 'piedra', humo: 0.9 });
  }
  const frente = z0 + d / 2;
  // Lo que cuelga de la fachada va a la altura que den los muros (los del pack son más bajos).
  const yPared = Math.min(1.5, yAlero - 0.55);
  o.con(0, 0, frente + 0.04, 0, () => {
    farolPared(o, 1.2, yPared + 0.45);
    // Una rodela colgada junto a la puerta, con los colores de la casa.
    rodela(o, -1.2, yPared, 0.05, pendon, Math.min(0.27, yPared * 0.25));
  });
  // El pendón, en lo alto del hastial de levante.
  const xp = w / 2 - 0.25;
  o.viga(xp, yCumbre - 0.5, z0, xp, yCumbre + 1.7, z0, 0.07, C.viga);
  o.caja(1.05, 0.62, 0.035, xp + 0.56, yCumbre + 0.98, z0, pendon, { vari: 0 });
  o.caja(0.5, 0.2, 0.04, xp + 0.56, yCumbre + 1.19, z0, C.amarillo, { vari: 0 });
  o.bola(0.09, xp, yCumbre + 1.74, z0, C.amarillo, { det: 0, vari: 0 });

  // El patio de armas: tierra pisada, cercado de estacas y una entrada en medio, al sur.
  const patio = b - frente;
  o.caja(c.ancho - 0.5, 0.06, patio - 0.1, 0, -0.02, frente + patio / 2, C.tierra, { vari: 0.04 });
  const estaca = (x: number, z: number): void => {
    const h = entre(o.azar, 1.05, 1.3);
    o.cil(0.085, 0.1, h + 0.3, x, -0.3, z, o.azar() < 0.5 ? C.madera : C.maderaVieja, { lados: 6, vari: 0.12, sombra: 0.2 });
    o.cono(0.085, 0.22, x, h, z, C.maderaClara, { lados: 6 });
  };
  const cerca = (x0: number, z0c: number, x1: number, z1: number): void => {
    const largo = Math.hypot(x1 - x0, z1 - z0c);
    const n = Math.max(1, Math.round(largo / 0.34));
    for (let i = 0; i <= n; i++) estaca(x0 + ((x1 - x0) * i) / n, z0c + ((z1 - z0c) * i) / n);
    o.viga(x0, 0.75, z0c, x1, 0.75, z1, [0.07, 0.1], C.viga);
  };
  const xc = a - 0.28;
  const zc = b - 0.28;
  cerca(-xc, frente + 0.35, -xc, zc);
  cerca(xc, frente + 0.35, xc, zc);
  cerca(-xc, zc, -1.0, zc);
  cerca(1.0, zc, xc, zc);
  // Los postes de la entrada, más altos, y el brasero de la guardia al lado.
  for (const s of [-1, 1]) {
    o.caja(0.2, 2.2, 0.2, s * 1.0, -0.2, zc, C.viga, { sombra: 0.2 });
    o.cono(0.16, 0.25, s * 1.0, 2.0, zc, C.maderaClara, { lados: 4, ry: PI / 4 });
  }
  const bx = 1.55;
  const bz = zc - 0.75;
  if (c.bib.tiene('brazier')) {
    o.glb('brazier', bx, 0, bz, { esc: 0.75, ry: 0.5 });
  } else {
    for (const ang of [0, 2.1, 4.2]) o.viga(bx + Math.cos(ang) * 0.3, 0, bz + Math.sin(ang) * 0.3, bx, 0.5, bz, 0.05, C.hierro);
    o.cil(0.34, 0.2, 0.2, bx, 0.45, bz, C.hierro, { lados: 8 });
    o.cil(0.28, 0.28, 0.06, bx, 0.62, bz, C.brasa, { lados: 8, luz: 2, vari: 0 });
  }
  o.marca('fuego', bx, 0.5, bz, 0.45);

  // El astillero de lanzas, arrimado a la cerca de levante.
  const ax = xc - 0.45;
  const az = frente + patio * 0.5;
  for (const s of [-1, 1]) o.caja(0.11, 1.5, 0.11, ax, -0.1, az + s * 0.85, C.viga);
  o.viga(ax, 1.3, az - 0.95, ax, 1.3, az + 0.95, [0.09, 0.07], C.viga);
  o.viga(ax, 0.3, az - 0.95, ax, 0.3, az + 0.95, [0.09, 0.07], C.viga);
  for (let i = 0; i < 6; i++) {
    const lz = az - 0.72 + i * 0.29;
    lanza(o, ax - 0.38, lz, ax + 0.02, lz + (o.azar() - 0.5) * 0.06, entre(o.azar, 2.15, 2.4));
  }
  o.con(ax - 0.12, 0, az - 1.25, -PI / 2, () => rodela(o, 0, 0.36, 0, 0x3f5d7a, 0.33));

  // El estafermo: un poste con un travesaño que gira, escudo a un lado y saco al otro. Quien le da mal, lo cobra.
  const ex = -a * 0.42;
  const ez = frente + patio * 0.55;
  o.cil(0.2, 0.26, 0.2, ex, -0.05, ez, C.piedra, { lados: 7 });
  o.caja(0.14, 1.75, 0.14, ex, 0, ez, C.viga, { sombra: 0.2 });
  o.con(ex, 0, ez, 0.5, () => {
    o.viga(-0.8, 1.6, 0, 0.8, 1.6, 0, [0.09, 0.09], C.madera);
    o.caja(0.5, 0.6, 0.06, -0.8, 1.25, 0.06, pendon, { vari: 0.03 });
    o.caja(0.14, 0.14, 0.08, -0.8, 1.48, 0.1, 0xb9bcc2, { vari: 0.02 });
    o.viga(0.8, 1.6, 0, 0.8, 1.25, 0, 0.025, C.maderaClara);
    saco(o, 0.8, 0, 0.78, 0xcbb98f);
  });

  // La diana de paja, en su caballete, contra la cerca de poniente.
  const dx = -xc + 0.5;
  const dz = frente + patio * 0.42;
  o.con(dx, 0, dz, PI / 2 - 0.12, () => {
    o.viga(-0.38, 0, -0.1, -0.1, 1.5, -0.12, 0.06, C.viga);
    o.viga(0.38, 0, -0.1, 0.1, 1.5, -0.12, 0.06, C.viga);
    o.viga(0, 0, -0.75, 0, 1.45, -0.14, 0.06, C.viga);
    o.cil(0.5, 0.5, 0.16, 0, 0.92, 0, C.paja, { rx: PI / 2, lados: 12, vari: 0.06 });
    o.cil(0.33, 0.33, 0.02, 0, 0.99, 0.085, 0xf3efe6, { rx: PI / 2, lados: 12, vari: 0 });
    o.cil(0.14, 0.14, 0.02, 0, 0.99, 0.095, pendon, { rx: PI / 2, lados: 10, vari: 0 });
    // Una flecha clavada, que no todo va a ser fallar.
    o.viga(0.1, 1.02, 0.1, 0.16, 1.1, 0.55, 0.02, C.maderaClara);
  });

  // Enseres: un barril de agua, cajones de pertrechos y un par de sacos junto a la puerta.
  if (!pieza(o, 'ea_barril', -w * 0.36, frente + 0.4, { esc: 1.05 })) barril(o, -w * 0.36, frente + 0.4, 0.85);
  if (!pieza(o, 'ea_cajon', w * 0.36, frente + 0.5, { esc: 0.8, ry: 0.3 })) cajon(o, w * 0.36, frente + 0.5, 0.75);
  if (!pieza(o, 'ea_saco', w * 0.36 - 0.75, frente + 0.35, { esc: 0.85, ry: 1.1 })) saco(o, w * 0.36 - 0.75, frente + 0.35);
  return o.grupo();
};

// ─────────────── piezas de arrastre (se enlazan con las vecinas) ───────────────

/** Brazos hacia los vecinos según los bits de `enlaces` (1 norte, 2 este, 4 sur, 8 oeste). */
function brazos(enlaces: number): [number, number][] {
  const lista: [number, number][] = [];
  if (enlaces & 1) lista.push([0, -1]);
  if (enlaces & 2) lista.push([1, 0]);
  if (enlaces & 4) lista.push([0, 1]);
  if (enlaces & 8) lista.push([-1, 0]);
  return lista;
}

const muralla: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const enlaces = c.enlaces ?? 10;
  const L = c.ancho / 2;
  const alto = 3.1;
  const piedra = { mat: 'piedra' as ClaveMaterial, uv: 2 };
  const lista = brazos(enlaces);
  // Machón central (más recio si es esquina o remate) y lienzos hacia los vecinos.
  const recto = enlaces === 5 || enlaces === 10;
  const g = recto ? 0.9 : 1.15;
  o.caja(g, alto + 0.8 + (recto ? 0 : 0.35), g, 0, -0.8, 0, C.piedra, piedra);
  if (!recto) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) o.caja(0.36, 0.45, 0.36, sx * 0.4, alto + 0.35, sz * 0.4, C.piedraClara, piedra);
  }
  for (const [dx, dz] of lista) {
    const ry = Math.atan2(dx, dz);
    o.con(0, 0, 0, ry, () => {
      o.caja(0.9, alto + 0.8, L, 0, -0.8, L / 2, C.piedra, piedra);
      // Almenas a los dos lados del adarve.
      for (const s of [-1, 1]) {
        o.caja(0.22, 0.5, 0.5, s * 0.34, alto, L * 0.3, C.piedraClara, piedra);
        o.caja(0.22, 0.5, 0.36, s * 0.34, alto, L * 0.85, C.piedraClara, piedra);
        o.caja(0.22, 0.18, L, s * 0.34, alto - 0.02, L / 2, C.piedra, piedra);
      }
    });
  }
  return o.grupo();
};

const empalizada: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const enlaces = c.enlaces ?? 10;
  const L = c.ancho / 2;
  const tronco = (x: number, z: number) => {
    const h = entre(o.azar, 2.1, 2.5);
    const r = entre(o.azar, 0.15, 0.19);
    o.cil(r * 0.9, r, h + 0.4, x, -0.4, z, o.azar() < 0.5 ? C.madera : C.maderaVieja, { lados: 6, vari: 0.12, sombra: 0.2 });
    o.cono(r * 0.9, 0.4, x, h, z, C.maderaClara, { lados: 6 });
  };
  tronco(0, 0);
  for (const [dx, dz] of brazos(enlaces)) {
    for (let i = 1; i <= 3; i++) {
      const t = (i * L) / 3 - 0.02;
      tronco(dx * t + (o.azar() - 0.5) * 0.05, dz * t + (o.azar() - 0.5) * 0.05);
    }
    // Larguero que ata los troncos por dentro.
    const ry = Math.atan2(dx, dz);
    o.con(0, 0, 0, ry, () => o.caja(0.08, 0.12, L, 0.2, 1.5, L / 2, C.viga));
  }
  return o.grupo();
};

const murete: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const enlaces = c.enlaces ?? 10;
  const L = c.ancho / 2;
  o.caja(0.6, 1.1, 0.6, 0, -0.3, 0, C.piedra, { mat: 'roca', uv: 1.4, ry: (o.azar() - 0.5) * 0.3 });
  o.caja(0.5, 0.12, 0.5, 0, 0.78, 0, C.piedraClara, { mat: 'roca', uv: 1.2, ry: o.azar() });
  for (const [dx, dz] of brazos(enlaces)) murito(o, dx * 0.2, dz * 0.2, dx * L, dz * L, 0.68, 0.44);
  return o.grupo();
};

const vallaArrastre: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const enlaces = c.enlaces ?? 10;
  const L = c.ancho / 2;
  o.caja(0.15, 1.25, 0.15, 0, -0.2, 0, C.madera, { ry: o.azar() * 0.4, vari: 0.12 });
  for (const [dx, dz] of brazos(enlaces)) {
    for (const h of [0.4, 0.78]) {
      const dy = (o.azar() - 0.5) * 0.06;
      o.viga(0, h + dy, 0, dx * L, h - dy * 0.5, dz * L, [0.1, 0.05], o.azar() < 0.5 ? C.madera : C.maderaClara, { vari: 0.12 });
    }
    o.caja(0.1, 0.95, 0.1, dx * L * 0.52, -0.1, dz * L * 0.52, C.maderaVieja, { ry: o.azar(), vari: 0.12 });
  }
  return o.grupo();
};

const camino: Constructor = (c) => {
  // El camino lo pinta el terreno; esta losa solo sirve para la vista previa.
  const o = new Obra(c.bib, c.semilla);
  o.caja(c.ancho * 0.92, 0.06, c.fondo * 0.92, 0, 0, 0, 0xc09a66);
  return o.grupo();
};

// ───────────────────────── adornos ─────────────────────────

const farol: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  if (c.bib.tiene('streetlamp01')) {
    // Farol del pack: poste con brazo y linterna colgante. Se centra para que la luz caiga en la celda.
    const s = 0.8;
    o.glb('streetlamp01', 0.1, 0, -0.5, { esc: s });
    o.marca('luz', 0.1 - 0.16 * s, 2.25 * s, -0.5 + 1.1 * s, 1.3);
    return o.grupo();
  }
  o.cil(0.2, 0.26, 0.3, 0, -0.1, 0, C.piedra, { lados: 7 });
  o.caja(0.13, 2.7, 0.13, 0, 0.1, 0, C.viga, { sombra: 0.2 });
  o.viga(0, 2.6, 0, 0, 2.6, 0.62, [0.09, 0.09], C.viga);
  o.viga(0, 2.15, 0, 0, 2.58, 0.4, 0.06, C.viga);
  o.viga(0, 2.58, 0.55, 0, 2.38, 0.55, 0.025, C.hierro);
  o.caja(0.26, 0.05, 0.26, 0, 2.36, 0.55, C.hierro);
  o.caja(0.2, 0.3, 0.2, 0, 2.06, 0.55, 0xffd58a, { luz: 1, vari: 0 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) o.caja(0.03, 0.3, 0.03, sx * 0.11, 2.06, 0.55 + sz * 0.11, C.hierro);
  o.caja(0.24, 0.04, 0.24, 0, 2.03, 0.55, C.hierro);
  o.marca('luz', 0, 2.2, 0.55, 1.3);
  return o.grupo();
};

const tendedero: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const a = c.ancho / 2 - 0.3;
  for (const s of [-1, 1]) {
    o.caja(0.1, 1.9, 0.1, s * a, -0.1, 0, C.madera);
    o.viga(s * a, 1.2, 0, s * (a - 0.35), 1.72, 0, 0.05, C.madera);
  }
  o.viga(-a, 1.72, 0, a, 1.72, 0, 0.025, 0xcbb894);
  const telas = [C.tela, 0xb5483a, C.tela, 0x4d7a9c, 0xe2c98a, C.tela];
  let x = -a + 0.35;
  for (let i = 0; x < a - 0.4; i++) {
    const w = entre(o.azar, 0.35, 0.6);
    const h = entre(o.azar, 0.5, 0.95);
    o.caja(w, h, 0.03, x + w / 2, 1.7 - h, 0, telas[i % telas.length], { rx: (o.azar() - 0.5) * 0.25, vari: 0.04 });
    x += w + 0.12;
  }
  o.cil(0.26, 0.2, 0.26, a - 0.5, 0, 0.5, C.maderaClara, { lados: 8 });
  return o.grupo();
};

const bancoSuelto: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  banco(o, 0, 0, 0, 0.72);
  return o.grupo();
};

const barriles: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  if (c.variante === 1 && c.bib.tiene('ea_barril') && c.bib.tiene('ea_cajon')) {
    pieza(o, 'ea_barril', -0.42, -0.32, { esc: 1.0, ry: o.azar() * 6 });
    pieza(o, 'ea_cajon', 0.4, -0.3, { esc: 0.7, ry: 0.2 });
    pieza(o, 'ea_saco', 0.35, 0.45, { esc: 0.85, ry: o.azar() * 6 });
    pieza(o, 'ea_tinaja', -0.42, 0.42, { esc: 1.0 });
    return o.grupo();
  }
  if (conPack(c, 'ea_cajon_abierto', 'ea_cesto')) {
    pieza(o, 'ea_cajon_abierto', -0.35, -0.3, { esc: 0.85, ry: 0.3 });
    pieza(o, 'ea_cesto_verduras', -0.35, -0.3, { esc: 0.8, y: 0.12 });
    pieza(o, 'ea_cuba', 0.45, -0.35, { esc: 1.7 });
    pieza(o, 'ea_cesto', 0.4, 0.42, { esc: 0.9, ry: o.azar() * 6 });
    pieza(o, 'ea_saco', -0.42, 0.45, { esc: 0.8, ry: o.azar() * 6 });
    return o.grupo();
  }
  barril(o, -0.4, -0.3, 0.9);
  barril(o, 0.42, -0.35, 0.8);
  cajon(o, 0.3, 0.45, 0.75);
  cajita(o, -0.45, 0.45, 0, 0.8);
  if (o.azar() < 0.6) cajita(o, 0.3, 0.45, 0.56, 0.7);
  return o.grupo();
};

const letreroSuelto: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  if (c.bib.tiene('sign01')) o.glb('sign01', 0, 0, 0, { esc: 1.15, ry: (o.azar() - 0.5) * 0.3 });
  else {
    o.caja(0.1, 1.4, 0.1, 0, 0, 0, C.viga);
    o.caja(0.8, 0.45, 0.06, 0, 0.9, 0.06, C.tabla);
  }
  return o.grupo();
};

const lenera: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const w = c.ancho * 0.7;
  const d = c.fondo * 0.42;
  const z0 = -c.fondo * 0.14;
  if (conPack(c, 'ea_cobertizo', 'ea_lenera')) {
    // Cobertizo de varas y leñero (EmaceArt).
    pieza(o, 'ea_cobertizo', 0, z0, { ancho: w + 0.7 });
    pieza(o, 'ea_lenera', 0, z0 + 0.1, { ancho: w * 0.82 });
  } else {
    for (const sx of [-1, 1]) {
      o.caja(0.14, 1.6, 0.14, (sx * w) / 2, -0.1, z0 - d / 2, C.viga);
      o.caja(0.14, 2.0, 0.14, (sx * w) / 2, -0.1, z0 + d / 2, C.viga);
    }
    o.caja(w + 0.5, 0.12, d + 0.7, 0, 1.62, z0, 0x7a6248, { rx: 0.25, vari: 0.05 });
    o.caja(w + 0.55, 0.05, d + 0.75, 0, 1.72, z0, 0x8a7350, { rx: 0.25, vari: 0.05 });
    lena(o, -w * 0.22, z0, 0, w * 0.48, 6, d * 0.9);
    lena(o, w * 0.25, z0, 0, w * 0.4, 4, d * 0.9);
  }
  // Tajo con el hacha clavada y unos leños sueltos.
  const tx = w * 0.2;
  const tz = c.fondo / 2 - 0.9;
  o.cil(0.3, 0.33, 0.45, tx, 0, tz, C.maderaClara, { lados: 8 });
  o.viga(tx, 0.45, tz, tx + 0.35, 1.0, tz - 0.15, 0.05, C.madera);
  o.caja(0.07, 0.2, 0.26, tx + 0.06, 0.45, tz - 0.02, C.hierro, { rz: -0.5 });
  for (let i = 0; i < 4; i++) o.cil(0.1, 0.1, 0.5, tx - 0.9 + o.azar() * 0.6, -0.15, tz + (o.azar() - 0.5) * 0.6, C.maderaClara, { rx: PI / 2, ry: o.azar() * 3, lados: 5 });
  return o.grupo();
};

/** Árbol suelto para la vista previa; los plantados van a la vegetación instanciada. */
const arbol: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const copa = c.paleta.copas[Math.floor(o.azar() * c.paleta.copas.length)];
  o.cil(0.16, 0.26, 1.9, 0, -0.1, 0, 0x6b4a32, { lados: 6 });
  o.bola(1.25, 0, 2.6, 0, copa, { esc: [1, 0.9, 1] });
  o.bola(0.85, 0.6, 3.3, 0.2, copa, { det: 0 });
  return o.grupo();
};

const camposanto: Constructor = (c) => {
  const o = new Obra(c.bib, c.semilla);
  const a = c.ancho / 2 - 0.3;
  const b = c.fondo / 2 - 0.3;
  murito(o, -a, -b, a, -b, 0.7);
  murito(o, -a, -b, -a, b, 0.7);
  murito(o, a, -b, a, b, 0.7);
  murito(o, -a, b, -0.7, b, 0.7);
  murito(o, 0.7, b, a, b, 0.7);
  for (const s of [-1, 1]) {
    o.caja(0.4, 1.5, 0.4, s * 0.7, -0.2, b, C.piedra, { mat: 'piedra', uv: 1.4 });
    o.bola(0.2, s * 0.7, 1.42, b, C.piedraClara, { det: 0 });
  }
  // Lápidas y cruces en hileras desiguales.
  let i = 0;
  for (const z of [-b + 1.0, -b + 2.6]) {
    for (let k = 0; k < 3; k++) {
      const x = -a + 1.0 + k * ((a * 2 - 2.0) / 2) + (o.azar() - 0.5) * 0.3;
      if (i % 3 === 2 || !c.bib.tiene('graveyard03')) {
        o.caja(0.09, 0.95, 0.09, x, -0.1, z, C.maderaVieja, { rz: (o.azar() - 0.5) * 0.2 });
        o.caja(0.5, 0.09, 0.09, x, 0.55, z, C.maderaVieja);
      } else {
        o.glb('graveyard03', x, -0.05, z, { esc: entre(o.azar, 0.42, 0.55), ry: (o.azar() - 0.5) * 0.4, rz: (o.azar() - 0.5) * 0.12 });
      }
      o.bola(0.3, x, 0.02, z + 0.55, 0x6b5a45, { det: 0, esc: [1, 0.3, 1.5] });
      i++;
    }
  }
  // Un tejo oscuro y flores.
  o.cil(0.12, 0.16, 0.7, a - 0.7, -0.1, b - 0.9, 0x5a4230, { lados: 6 });
  o.cono(0.6, 2.4, a - 0.7, 0.5, b - 0.9, 0x2f5a3c, { lados: 7 });
  flores(o, -a + 0.8, b - 0.7, 4, 0.4, [0xffffff, 0xf2e2b0, 0xc7a6e6]);
  // Un peto de ánimas junto a la entrada (EmaceArt).
  pieza(o, 'ea_peto', -a + 0.75, b - 1.5, { esc: 0.48 });
  return o.grupo();
};

/** Un constructor por cada `modelo` del catálogo. */
export const CONSTRUCTORES: Record<string, Constructor> = {
  choza,
  casa: casaSencilla,
  casa_grande: casaGrande,
  casona,
  hoguera,
  pozo,
  campo,
  huerto,
  gallinero,
  redil,
  cabana_lenador: cabanaLenador,
  cantera,
  molino,
  panaderia,
  granero,
  herreria,
  taberna,
  iglesia,
  escribania,
  botica,
  mercado,
  torre,
  cuartel,
  muralla,
  empalizada,
  murete,
  valla: vallaArrastre,
  camino,
  farol,
  tendedero,
  banco: bancoSuelto,
  barriles,
  letrero: letreroSuelto,
  lenera,
  arbol,
  camposanto,
};

/** Modelo del pack ajustado a la huella, cuando GLB_POR_MODELO lo pide. */
function desdeGLB(c: ContextoObra, ajuste: AjusteGLB): THREE.Group | null {
  const m = c.bib.modelos.get(ajuste.glb);
  if (!m) return null;
  const cuartos = ajuste.cuartos ?? 0;
  const tx = cuartos % 2 === 0 ? m.tam.x : m.tam.z;
  const tz = cuartos % 2 === 0 ? m.tam.z : m.tam.x;
  const relleno = ajuste.relleno ?? 0.9;
  const esc = ajuste.escala ?? Math.min((c.ancho * relleno) / tx, (c.fondo * relleno) / tz);
  const interior = c.bib.grupo(ajuste.glb);
  interior.position.set(-(m.min.x + m.max.x) / 2, -m.min.y, -(m.min.z + m.max.z) / 2);
  const giro = new THREE.Group();
  giro.add(interior);
  giro.rotation.y = (-cuartos * PI) / 2;
  giro.scale.setScalar(esc);
  if (ajuste.desplaza) giro.position.set(...ajuste.desplaza);
  const g = new THREE.Group();
  g.add(giro);
  g.updateMatrixWorld(true);
  const marcas: Marca[] = (ajuste.marcas ?? []).map((m) => ({
    tipo: m.tipo,
    pos: new THREE.Vector3(...m.pos).applyMatrix4(interior.matrixWorld),
    valor: m.valor ?? 1,
  }));
  g.userData['marcas'] = marcas;
  return g;
}

/** Levanta el edificio de ese `modelo`: GLB si está enchufado, constructor procedural si no. */
export function construir(modelo: string, c: ContextoObra): THREE.Group {
  const ajuste = GLB_POR_MODELO[modelo];
  if (ajuste) {
    const g = desdeGLB(c, ajuste);
    if (g) return g;
  }
  const fn = CONSTRUCTORES[modelo];
  if (!fn) {
    console.warn(`No hay constructor para el modelo «${modelo}»; se usa un cajón.`);
    const o = new Obra(c.bib, c.semilla);
    o.caja(c.ancho * 0.8, 2, c.fondo * 0.8, 0, 0, 0, C.tabla);
    return o.grupo();
  }
  return fn(c);
}
