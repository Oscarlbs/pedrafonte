// Figuras: aldeanos y el señor hechos con formas básicas (no hay modelos de personas en los packs).
// Cada figura es un cuerpo y dos pies dentro del lote de «pintura», así que un pueblo entero de
// figuras no añade llamadas de dibujo. Andan con balanceo, siguiendo los caminos cuando los hay.
import * as THREE from 'three';
import type { Par } from '../datos';
import type { Ficha, Lotes } from '../escena/lotes';
import type { Biblioteca } from '../escena/modelos';
import { C } from '../escena/paleta';
import { Obra } from '../escena/taller';
import { crearAzar, semillaDe } from '../util/azar';
import type { Cuadricula } from './cuadricula';

export interface DatosFigura {
  id: string;
  nombre: string;
  /** Oficio del reparto (molinero, panadera, herrero…); decide ropa y sombrero. */
  oficio: string;
  esSenor?: boolean;
}

type Sombrero = 'paja' | 'gorro' | 'cofia' | 'capucha' | 'boina' | 'velo' | 'corona' | 'casco' | 'calva' | 'pelo';
type Extra = 'cayado' | 'hacha' | 'pergamino' | 'baston' | 'cetro' | 'lanza' | 'cesta';

interface Atuendo {
  ropa: number;
  falda?: boolean;
  sombrero: Sombrero;
  colorSombrero?: number;
  delantal?: number;
  extra?: Extra;
  pelo?: number;
  escala?: number;
  /** Anchura relativa del cuerpo. */
  ancho?: number;
  capa?: number;
}

const ATUENDOS: Record<string, Atuendo> = {
  senor: { ropa: 0x7a2630, sombrero: 'corona', capa: 0x8c1f2e, extra: 'cetro', pelo: 0x4a3526, escala: 1.14 },
  molinero: { ropa: 0xe6dcc6, sombrero: 'gorro', colorSombrero: 0xf3efe6, delantal: 0xf3efe6, pelo: 0x8a6240, ancho: 1.15 },
  panadera: { ropa: 0xc9853e, falda: true, sombrero: 'cofia', delantal: 0xf3efe6, pelo: 0x6b4a32 },
  herrero: { ropa: 0x6a5a50, sombrero: 'calva', delantal: 0x4a342a, pelo: 0x2b2826, escala: 1.1, ancho: 1.25 },
  tabernero: { ropa: 0x5f7f4a, sombrero: 'calva', delantal: 0xd9c9a3, pelo: 0x8a6240, ancho: 1.3 },
  cura: { ropa: 0x2b2a30, falda: true, sombrero: 'boina', colorSombrero: 0x1f1e24, pelo: 0x9a948a, extra: 'baston' },
  escriba: { ropa: 0x486a8a, falda: true, sombrero: 'boina', colorSombrero: 0x7a2e3a, pelo: 0x4a3526, extra: 'pergamino', ancho: 0.9 },
  curandera: { ropa: 0x6a4a7a, falda: true, sombrero: 'capucha', pelo: 0xb5b0a8, extra: 'cesta', escala: 0.95 },
  pastor: { ropa: 0x8a6a48, sombrero: 'paja', pelo: 0x6b4a32, extra: 'cayado', capa: 0x6b5a45 },
  lenador: { ropa: 0xa8482f, sombrero: 'gorro', colorSombrero: 0x4f6b4a, pelo: 0x8a4a2a, extra: 'hacha', escala: 1.06, ancho: 1.15 },
  viuda: { ropa: 0x34303a, falda: true, sombrero: 'velo', pelo: 0x9a948a },
  mozo: { ropa: 0x7f9a55, sombrero: 'pelo', pelo: 0xc98f3a, escala: 0.84 },
  forastero: { ropa: 0x5a6258, sombrero: 'capucha', pelo: 0x2b2826, capa: 0x4a5248, extra: 'baston' },
  guardia: { ropa: 0x8c3f32, sombrero: 'casco', pelo: 0x4a3526, extra: 'lanza', escala: 1.05 },
  cantero: { ropa: 0x9a8f7f, sombrero: 'gorro', colorSombrero: 0x6b5a45, pelo: 0x4a3526, delantal: 0x6b5a45 },
  labrador: { ropa: 0x9a7a4a, sombrero: 'paja', pelo: 0x6b4a32 },
  labradora: { ropa: 0x8a5a6a, falda: true, sombrero: 'cofia', pelo: 0x6b4a32, delantal: 0xe6dcc6 },
  mercader: { ropa: 0x7a4a8a, sombrero: 'boina', colorSombrero: 0xc9a23a, pelo: 0x2b2826, capa: 0x5a3a6a, ancho: 1.2 },
};

/** Ropas para aldeanos sin oficio conocido: se elige una estable por su id. */
const ROPAS_SUELTAS = [0x9a7a4a, 0x7f9a55, 0x8a5a6a, 0x5f7f8a, 0xb08a4a, 0x8a6a48];

function atuendoDe(d: DatosFigura): Atuendo {
  if (d.esSenor) return ATUENDOS['senor'];
  const conocido = ATUENDOS[d.oficio];
  if (conocido) return conocido;
  const azar = crearAzar(semillaDe(d.id));
  const mujer = azar() < 0.5;
  return {
    ropa: ROPAS_SUELTAS[Math.floor(azar() * ROPAS_SUELTAS.length)],
    falda: mujer,
    sombrero: mujer ? 'cofia' : azar() < 0.5 ? 'paja' : 'gorro',
    colorSombrero: 0x6b5a45,
    pelo: 0x6b4a32,
  };
}

const PIELES = [0xedc4a0, 0xe2b48c, 0xd9a47c, 0xf0cdb0];

/** Cuerpo de la figura: de pie, mirando a +z, con los pies en y = 0. */
function geometriaCuerpo(bib: Biblioteca, d: DatosFigura): THREE.BufferGeometry {
  const a = atuendoDe(d);
  const o = new Obra(bib, semillaDe(d.id));
  const piel = PIELES[Math.floor(o.azar() * PIELES.length)];
  const ancho = a.ancho ?? 1;
  const pelo = a.pelo ?? 0x6b4a32;
  // Túnica o vestido.
  if (a.falda) o.cil(0.19 * ancho, 0.37 * ancho, 0.88, 0, 0.08, 0, a.ropa, { lados: 9, sombra: 0.12, vari: 0.03 });
  else {
    o.cil(0.2 * ancho, 0.3 * ancho, 0.62, 0, 0.34, 0, a.ropa, { lados: 9, sombra: 0.1, vari: 0.03 });
    for (const s of [-1, 1]) o.cil(0.085, 0.08, 0.34, s * 0.11, 0.04, 0, 0x5a4a3c, { lados: 6 });
  }
  o.cil(0.255 * ancho, 0.265 * ancho, 0.07, 0, 0.56, 0, 0x4a3526, { lados: 9 });
  if (a.delantal !== undefined) o.caja(0.3 * ancho, 0.5, 0.04, 0, 0.3, 0.26 * ancho, a.delantal, { rx: -0.14, vari: 0.02 });
  // Brazos y manos.
  for (const s of [-1, 1]) {
    o.viga(s * 0.22 * ancho, 0.92, 0, s * 0.33 * ancho, 0.56, 0.04, 0.12, a.ropa, { vari: 0.06 });
    o.bola(0.065, s * 0.34 * ancho, 0.52, 0.05, piel, { det: 0 });
  }
  // Capa.
  if (a.capa !== undefined) {
    o.cil(0.22 * ancho, 0.44 * ancho, 0.86, 0, 0.1, -0.1, a.capa, { lados: 8, vari: 0.03 });
    if (d.esSenor) o.cil(0.27, 0.29, 0.1, 0, 0.9, -0.02, 0xf3efe6, { lados: 9 });
  }
  // Cabeza con su cara.
  const yc = 1.16;
  o.bola(0.2, 0, yc, 0, piel, { det: 1, vari: 0.02 });
  o.caja(0.035, 0.045, 0.02, -0.07, yc + 0.01, 0.185, 0x2b2826, { vari: 0 });
  o.caja(0.035, 0.045, 0.02, 0.07, yc + 0.01, 0.185, 0x2b2826, { vari: 0 });
  o.bola(0.035, 0, yc - 0.035, 0.2, piel, { det: 0, vari: 0.03 });
  const cs = a.colorSombrero ?? 0x6b5a45;
  switch (a.sombrero) {
    case 'paja':
      o.bola(0.2, 0, yc + 0.03, -0.03, pelo, { det: 0, esc: [1.03, 1, 1.03] });
      o.cil(0.36, 0.38, 0.035, 0, yc + 0.13, 0, C.paja, { lados: 10 });
      o.cil(0.13, 0.19, 0.14, 0, yc + 0.16, 0, C.pajaSombra, { lados: 8 });
      break;
    case 'gorro':
      o.bola(0.215, 0, yc + 0.06, -0.02, cs, { det: 1, esc: [1, 0.85, 1] });
      o.bola(0.06, 0.04, yc + 0.27, -0.06, cs, { det: 0 });
      break;
    case 'cofia':
      o.bola(0.225, 0, yc + 0.04, -0.05, 0xf3efe6, { det: 1, esc: [1, 0.95, 1] });
      break;
    case 'capucha':
      o.bola(0.25, 0, yc + 0.03, -0.06, a.capa ?? a.ropa, { det: 1, esc: [1, 1.05, 1] });
      o.cono(0.1, 0.2, 0, yc + 0.2, -0.16, a.capa ?? a.ropa, { rx: -0.9, lados: 6 });
      break;
    case 'boina':
      o.bola(0.2, 0, yc + 0.02, -0.03, pelo, { det: 0, esc: [1.03, 1, 1.03] });
      o.cil(0.2, 0.22, 0.07, 0.02, yc + 0.15, 0, cs, { lados: 9, rz: -0.15 });
      break;
    case 'velo':
      o.bola(0.235, 0, yc + 0.03, -0.05, 0x25232a, { det: 1 });
      o.cil(0.16, 0.24, 0.3, 0, yc - 0.32, -0.1, 0x25232a, { lados: 7 });
      break;
    case 'corona':
      o.bola(0.205, 0, yc + 0.03, -0.03, pelo, { det: 0, esc: [1.03, 1, 1.03] });
      o.cil(0.19, 0.17, 0.09, 0, yc + 0.15, 0, 0xe2b94a, { lados: 8, vari: 0 });
      for (let i = 0; i < 5; i++) {
        const an = (i / 5) * Math.PI * 2;
        o.cono(0.04, 0.09, Math.sin(an) * 0.17, yc + 0.24, Math.cos(an) * 0.17, 0xe2b94a, { lados: 4, vari: 0 });
      }
      break;
    case 'casco':
      o.bola(0.22, 0, yc + 0.05, 0, 0x8f959c, { det: 1, esc: [1, 0.9, 1], vari: 0.02 });
      o.caja(0.03, 0.12, 0.03, 0, yc - 0.02, 0.21, 0x8f959c);
      break;
    case 'calva':
      o.bola(0.2, 0, yc - 0.02, -0.04, pelo, { det: 0, esc: [1.04, 0.8, 1.02] });
      break;
    default:
      o.bola(0.215, 0, yc + 0.04, -0.03, pelo, { det: 1, esc: [1.02, 0.95, 1.02], vari: 0.06 });
  }
  // Lo que lleva en la mano o a la espalda.
  switch (a.extra) {
    case 'cayado':
      o.viga(0.36, 0, 0.08, 0.36, 1.55, 0.08, 0.045, C.madera);
      o.viga(0.36, 1.55, 0.08, 0.26, 1.62, 0.08, 0.045, C.madera);
      break;
    case 'baston':
      o.viga(0.36 * ancho, 0, 0.1, 0.36 * ancho, 1.05, 0.06, 0.04, C.maderaVieja);
      break;
    case 'cetro':
      o.viga(0.38, 0.1, 0.08, 0.38, 1.3, 0.08, 0.04, 0x4a3526);
      o.bola(0.075, 0.38, 1.36, 0.08, 0xe2b94a, { det: 0, vari: 0 });
      break;
    case 'lanza':
      o.viga(0.37, 0, 0.08, 0.37, 2.0, 0.08, 0.04, C.madera);
      o.cono(0.05, 0.2, 0.37, 2.0, 0.08, 0xa8adb3, { lados: 4 });
      break;
    case 'hacha':
      o.viga(0.2, 0.45, -0.24, -0.16, 1.1, -0.24, 0.04, C.madera);
      o.caja(0.2, 0.16, 0.04, -0.2, 1.0, -0.24, 0x8f959c, { rz: 0.5 });
      break;
    case 'pergamino':
      o.cil(0.04, 0.04, 0.3, 0.33, 0.5, 0.12, 0xf0e6cc, { rx: 1.2, lados: 6, vari: 0 });
      break;
    case 'cesta':
      o.cil(0.12, 0.09, 0.12, -0.36, 0.42, 0.06, C.pajaSombra, { lados: 7 });
      o.bola(0.07, -0.36, 0.55, 0.06, 0x7f9a55, { det: 0 });
      break;
    default:
  }
  const malla = o.grupo().children[0] as THREE.Mesh;
  return malla.geometry;
}

let geoPie: THREE.BufferGeometry | null = null;
function geometriaPie(bib: Biblioteca): THREE.BufferGeometry {
  if (!geoPie) {
    const o = new Obra(bib, 7);
    o.bola(0.085, 0, 0.055, 0.03, 0x3a2a20, { det: 0, esc: [1, 0.65, 1.55], vari: 0 });
    geoPie = (o.grupo().children[0] as THREE.Mesh).geometry;
  }
  return geoPie;
}

interface Figura {
  datos: DatosFigura;
  x: number;
  z: number;
  dir: number;
  ruta: { x: number; z: number }[];
  fase: number;
  andando: boolean;
  escala: number;
  geometria: THREE.BufferGeometry;
  cuerpo: Ficha;
  pies: [Ficha, Ficha];
  bocadillo: { el: HTMLElement; hasta: number } | null;
  semilla: number;
}

const _m = new THREE.Matrix4();
const _base = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class Figuras {
  private readonly figuras = new Map<string, Figura>();
  private tiempo = 0;
  /** Se llama cuando una figura llega a donde iba. */
  alLlegar: ((id: string) => void) | null = null;

  constructor(
    private readonly lotes: Lotes,
    private readonly bib: Biblioteca,
    private readonly cuadricula: Cuadricula,
    /** Altura por la que se anda: el suelo o el tablero del puente. */
    private readonly alturaPaso: (x: number, z: number) => number,
    private readonly capa: HTMLElement,
  ) {}

  poner(d: DatosFigura): void {
    if (this.figuras.has(d.id)) this.quitar(d.id);
    const a = atuendoDe(d);
    const geometria = geometriaCuerpo(this.bib, d);
    const pie = geometriaPie(this.bib);
    const etiqueta = { tipo: 'figura' as const, id: d.id };
    _m.makeScale(0, 0, 0);
    const semilla = semillaDe(d.id);
    const f: Figura = {
      datos: d,
      x: 0,
      z: 0,
      dir: ((semilla % 628) / 100),
      ruta: [],
      fase: (semilla % 100) / 10,
      andando: false,
      escala: (a.escala ?? 1) * (0.96 + ((semilla >> 4) % 9) / 100),
      geometria,
      cuerpo: this.lotes.crear(geometria, this.bib.pintura, _m, etiqueta),
      pies: [this.lotes.crear(pie, this.bib.pintura, _m, etiqueta), this.lotes.crear(pie, this.bib.pintura, _m, etiqueta)],
      bocadillo: null,
      semilla,
    };
    this.figuras.set(d.id, f);
  }

  quitar(id: string): void {
    const f = this.figuras.get(id);
    if (!f) return;
    this.lotes.quitar(f.cuerpo);
    this.lotes.quitar(f.pies[0]);
    this.lotes.quitar(f.pies[1]);
    this.lotes.soltarGeometria(f.geometria);
    f.geometria.dispose();
    f.bocadillo?.el.remove();
    this.figuras.delete(id);
  }

  vaciar(): void {
    for (const id of [...this.figuras.keys()]) this.quitar(id);
  }

  tiene(id: string): boolean {
    return this.figuras.has(id);
  }

  /** Pone la figura en el centro de la celda, sin andar. */
  colocar(id: string, cx: number, cz: number): void {
    const f = this.figuras.get(id);
    if (!f) return;
    const { x, z } = this.cuadricula.celdaAMundo(cx, cz);
    f.x = x;
    f.z = z;
    f.ruta = [];
    f.andando = false;
  }

  /** Hace mirar a la figura hacia una celda (para las escenas de charla). */
  mirar(id: string, cx: number, cz: number): void {
    const f = this.figuras.get(id);
    if (!f) return;
    const { x, z } = this.cuadricula.celdaAMundo(cx, cz);
    if (Math.hypot(x - f.x, z - f.z) > 0.05) f.dir = Math.atan2(x - f.x, z - f.z);
  }

  /** La manda andando hasta la celda, por los caminos si los hay. Devuelve false si no existe. */
  mover(id: string, cx: number, cz: number): boolean {
    const f = this.figuras.get(id);
    if (!f) return false;
    const desde = this.cuadricula.mundoACelda(f.x, f.z);
    const celdas = this.buscarRuta([desde.cx, desde.cz], [cx, cz]);
    const azar = crearAzar(f.semilla + Math.round(this.tiempo * 10));
    f.ruta = celdas.map(([px, pz], i) => {
      const p = this.cuadricula.celdaAMundo(px, pz);
      // Un poco de desorden para que no vayan todos en fila por el centro de la celda.
      const ultimo = i === celdas.length - 1;
      return { x: p.x + (ultimo ? 0 : (azar() - 0.5) * 0.7), z: p.z + (ultimo ? 0 : (azar() - 0.5) * 0.7) };
    });
    f.andando = f.ruta.length > 0;
    return true;
  }

  posicion(id: string): { x: number; y: number; z: number; cx: number; cz: number; andando: boolean } | null {
    const f = this.figuras.get(id);
    if (!f) return null;
    const c = this.cuadricula.mundoACelda(f.x, f.z);
    return { x: f.x, y: this.alturaPaso(f.x, f.z), z: f.z, cx: c.cx, cz: c.cz, andando: f.andando };
  }

  /** Bocadillo de cómic sobre la figura durante unos segundos. */
  decir(id: string, texto: string, segundos = 5): void {
    const f = this.figuras.get(id);
    if (!f) return;
    f.bocadillo?.el.remove();
    const el = document.createElement('div');
    el.className = 'bocadillo';
    const nombre = document.createElement('span');
    nombre.className = 'bocadillo-nombre';
    nombre.textContent = f.datos.nombre;
    const cuerpo = document.createElement('span');
    cuerpo.textContent = texto;
    el.append(nombre, cuerpo);
    this.capa.appendChild(el);
    f.bocadillo = { el, hasta: this.tiempo + segundos };
  }

  private pasable(cx: number, cz: number, destino: Par): boolean {
    const c = this.cuadricula;
    if (!c.dentro(cx, cz)) return false;
    if (cx === destino[0] && cz === destino[1]) return true;
    if (c.tipoCelda(cx, cz) === 'agua') return false;
    return c.ocupante(cx, cz) === undefined;
  }

  /** A* sobre la cuadrícula: el camino y el puente cuestan menos que el campo. */
  private buscarRuta(desde: Par, hasta: Par): Par[] {
    const c = this.cuadricula;
    const n = c.n;
    if (!c.dentro(hasta[0], hasta[1])) return [];
    if (desde[0] === hasta[0] && desde[1] === hasta[1]) return [hasta];
    const total = n * n;
    const coste = new Float32Array(total).fill(Infinity);
    const previo = new Int32Array(total).fill(-1);
    const cerrado = new Uint8Array(total);
    const inicio = c.indice(Math.min(n - 1, Math.max(0, desde[0])), Math.min(n - 1, Math.max(0, desde[1])));
    const fin = c.indice(hasta[0], hasta[1]);
    coste[inicio] = 0;
    const abiertos: number[] = [inicio];
    const h = (i: number) => Math.hypot((i % n) - hasta[0], Math.floor(i / n) - hasta[1]);
    const peso = (cx: number, cz: number) => {
      const t = c.tipoCelda(cx, cz);
      return t === 'camino' || t === 'puente' ? 1 : t === 'orilla' ? 3 : 2.6;
    };
    while (abiertos.length) {
      let mejor = 0;
      for (let i = 1; i < abiertos.length; i++) {
        if (coste[abiertos[i]] + h(abiertos[i]) < coste[abiertos[mejor]] + h(abiertos[mejor])) mejor = i;
      }
      const actual = abiertos.splice(mejor, 1)[0];
      if (actual === fin) break;
      if (cerrado[actual]) continue;
      cerrado[actual] = 1;
      const ax = actual % n;
      const az = Math.floor(actual / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const bx = ax + dx;
          const bz = az + dz;
          if (!this.pasable(bx, bz, hasta)) continue;
          // En diagonal no se cortan esquinas.
          if (dx && dz && (!this.pasable(ax + dx, az, hasta) || !this.pasable(ax, az + dz, hasta))) continue;
          const i = c.indice(bx, bz);
          if (cerrado[i]) continue;
          const nuevo = coste[actual] + peso(bx, bz) * (dx && dz ? 1.414 : 1);
          if (nuevo < coste[i]) {
            coste[i] = nuevo;
            previo[i] = actual;
            abiertos.push(i);
          }
        }
      }
    }
    if (previo[fin] === -1) return [hasta]; // sin ruta: en línea recta
    const ruta: Par[] = [];
    for (let i = fin; i !== -1 && i !== inicio; i = previo[i]) ruta.push([i % n, Math.floor(i / n)]);
    return ruta.reverse();
  }

  actualizar(dt: number, camara: THREE.Camera, ancho: number, alto: number): void {
    this.tiempo += dt;
    for (const f of this.figuras.values()) {
      // Avance por la ruta.
      if (f.andando && f.ruta.length) {
        const meta = f.ruta[0];
        const dx = meta.x - f.x;
        const dz = meta.z - f.z;
        const d = Math.hypot(dx, dz);
        const paso = 1.5 * f.escala * dt;
        if (d <= paso) {
          f.x = meta.x;
          f.z = meta.z;
          f.ruta.shift();
          if (!f.ruta.length) {
            f.andando = false;
            this.alLlegar?.(f.datos.id);
          }
        } else {
          f.x += (dx / d) * paso;
          f.z += (dz / d) * paso;
          const quiere = Math.atan2(dx, dz);
          let giro = quiere - f.dir;
          giro = Math.atan2(Math.sin(giro), Math.cos(giro));
          f.dir += giro * Math.min(1, dt * 9);
        }
        f.fase += dt * 9.5;
      }
      const y = this.alturaPaso(f.x, f.z);
      const anda = f.andando ? 1 : 0;
      const vaiven = anda ? Math.sin(f.fase) * 0.09 : Math.sin(this.tiempo * 1.2 + f.semilla) * 0.012;
      const bote = anda ? Math.abs(Math.sin(f.fase)) * 0.055 : 0;
      const e = f.escala;
      _base.makeRotationY(f.dir).setPosition(f.x, y, f.z);
      _rot.makeRotationZ(vaiven).setPosition(0, bote, 0).scale(_v.set(e, e, e));
      f.cuerpo.lote.mover(f.cuerpo.instancia, _m.multiplyMatrices(_base, _rot));
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        const zancada = anda ? Math.sin(f.fase) * 0.17 * s : 0;
        const alza = anda ? Math.max(0, Math.cos(f.fase) * s) * 0.09 : 0;
        _rot.makeTranslation(s * 0.11 * e, alza * e, zancada * e).scale(_v.set(e, e, e));
        f.pies[i].lote.mover(f.pies[i].instancia, _m.multiplyMatrices(_base, _rot));
      }
      // Bocadillo pegado a la figura.
      if (f.bocadillo) {
        if (this.tiempo > f.bocadillo.hasta) {
          f.bocadillo.el.remove();
          f.bocadillo = null;
        } else {
          _v.set(f.x, y + 1.75 * e, f.z).project(camara);
          const visible = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
          f.bocadillo.el.style.display = visible ? '' : 'none';
          f.bocadillo.el.style.transform = `translate(-50%, -100%) translate(${((_v.x + 1) / 2) * ancho}px, ${((1 - _v.y) / 2) * alto}px)`;
        }
      }
    }
  }
}
