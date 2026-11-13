// Animales de formas básicas (gallinas, ovejas, perros) que deambulan cerca de donde se les suelta.
// Como las figuras, viven en el lote de «pintura»: muchos animales, ninguna llamada de dibujo más.
import * as THREE from 'three';
import type { Ficha, Lotes } from '../escena/lotes';
import type { Biblioteca } from '../escena/modelos';
import { Obra } from '../escena/taller';
import { type Azar, crearAzar, entre } from '../util/azar';
import type { Cuadricula } from './cuadricula';

export type TipoAnimal = 'gallina' | 'oveja' | 'perro';

const PASO: Record<TipoAnimal, number> = { gallina: 0.7, oveja: 0.5, perro: 1.5 };

function geometria(bib: Biblioteca, tipo: TipoAnimal, variante: number): THREE.BufferGeometry {
  const o = new Obra(bib, 300 + variante);
  if (tipo === 'gallina') {
    const pluma = [0xf3efe6, 0xb5683a, 0x8a5a3a, 0xe2d2b0][variante % 4];
    o.bola(0.17, 0, 0.24, 0, pluma, { det: 1, esc: [0.85, 0.9, 1.2], vari: 0.03 });
    o.bola(0.095, 0, 0.42, 0.15, pluma, { det: 0 });
    o.cono(0.035, 0.08, 0, 0.4, 0.26, 0xe2a93a, { rx: Math.PI / 2, lados: 4, vari: 0 });
    o.caja(0.03, 0.07, 0.09, 0, 0.5, 0.14, 0xc9392e, { vari: 0 });
    o.caja(0.03, 0.05, 0.03, 0, 0.34, 0.22, 0xc9392e, { vari: 0 });
    o.caja(0.1, 0.18, 0.05, 0, 0.3, -0.2, pluma, { rx: -0.6 });
    for (const s of [-1, 1]) o.caja(0.02, 0.12, 0.02, s * 0.06, 0, 0.02, 0xe2a93a, { vari: 0 });
  } else if (tipo === 'oveja') {
    const lana = [0xf0ebdf, 0xe6dfd0, 0xd9d0c0, 0x5a5048][variante % 4];
    o.bola(0.36, 0, 0.55, 0, lana, { det: 1, esc: [0.9, 0.82, 1.25], vari: 0.03 });
    o.bola(0.2, 0, 0.78, 0.2, lana, { det: 0 });
    o.bola(0.15, 0, 0.66, 0.5, 0x3a3230, { det: 0, esc: [0.85, 0.95, 1.2], vari: 0.03 });
    for (const s of [-1, 1]) o.caja(0.05, 0.04, 0.12, s * 0.15, 0.68, 0.44, 0x3a3230, { rz: s * 0.5 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.caja(0.07, 0.34, 0.07, sx * 0.17, 0, sz * 0.26, 0x3a3230, { vari: 0.05 });
  } else {
    const pelo = [0x8a5a34, 0x3a302a, 0xc9a070, 0xe6dcc6][variante % 4];
    o.caja(0.26, 0.24, 0.6, 0, 0.3, 0, pelo, { vari: 0.03 });
    o.caja(0.22, 0.22, 0.26, 0, 0.5, 0.36, pelo, { vari: 0.03 });
    o.caja(0.12, 0.1, 0.14, 0, 0.5, 0.54, pelo, { vari: 0.06 });
    o.caja(0.05, 0.04, 0.04, 0, 0.56, 0.61, 0x2b2826, { vari: 0 });
    for (const s of [-1, 1]) o.caja(0.06, 0.14, 0.05, s * 0.1, 0.66, 0.3, pelo, { rz: s * 0.4 });
    o.viga(0, 0.5, -0.3, 0, 0.72, -0.44, 0.05, pelo);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.caja(0.07, 0.32, 0.07, sx * 0.09, 0, sz * 0.22, pelo, { vari: 0.05 });
  }
  return (o.grupo().children[0] as THREE.Mesh).geometry;
}

interface Animal {
  tipo: TipoAnimal;
  x: number;
  z: number;
  dir: number;
  /** Punto alrededor del cual pasta. */
  ax: number;
  az: number;
  radio: number;
  metaX: number;
  metaZ: number;
  espera: number;
  fase: number;
  escala: number;
  ficha: Ficha;
  azar: Azar;
}

const _m = new THREE.Matrix4();
const _base = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class Animales {
  private readonly animales: Animal[] = [];
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private cuenta = 0;

  constructor(
    private readonly lotes: Lotes,
    private readonly bib: Biblioteca,
    private readonly cuadricula: Cuadricula,
    private readonly alturaPaso: (x: number, z: number) => number,
    /** ¿Hay agua en ese punto? (los animales no se bañan). */
    private readonly mojado: (x: number, z: number) => boolean,
  ) {}

  /** Suelta `n` animales alrededor de la celda; se quedan a `radio` metros como mucho. */
  poner(tipo: TipoAnimal, cx: number, cz: number, n: number, radio = 2.6): void {
    const centro = this.cuadricula.celdaAMundo(cx, cz);
    for (let i = 0; i < n; i++) {
      const azar = crearAzar(1000 + this.cuenta * 31);
      const variante = this.cuenta++ % 4;
      const clave = `${tipo}${variante}`;
      let geo = this.geos.get(clave);
      if (!geo) {
        geo = geometria(this.bib, tipo, variante);
        this.geos.set(clave, geo);
      }
      let x = centro.x;
      let z = centro.z;
      for (let intento = 0; intento < 8; intento++) {
        const a = azar() * Math.PI * 2;
        const r = Math.sqrt(azar()) * radio;
        x = centro.x + Math.cos(a) * r;
        z = centro.z + Math.sin(a) * r;
        if (!this.mojado(x, z)) break;
      }
      this.animales.push({
        tipo, x, z, dir: azar() * 6.28, ax: centro.x, az: centro.z, radio, metaX: x, metaZ: z,
        espera: azar() * 4, fase: azar() * 6, escala: entre(azar, 0.85, 1.12),
        ficha: this.lotes.crear(geo, this.bib.pintura, _m.identity(), { tipo: 'animal', id: `${tipo}-${this.cuenta}` }),
        azar,
      });
    }
  }

  vaciar(): void {
    for (const a of this.animales) this.lotes.quitar(a.ficha);
    this.animales.length = 0;
  }

  actualizar(dt: number): void {
    for (const a of this.animales) {
      const dx = a.metaX - a.x;
      const dz = a.metaZ - a.z;
      const d = Math.hypot(dx, dz);
      let anda = false;
      if (d > 0.08) {
        anda = true;
        const paso = Math.min(d, PASO[a.tipo] * dt);
        a.x += (dx / d) * paso;
        a.z += (dz / d) * paso;
        let giro = Math.atan2(dx, dz) - a.dir;
        giro = Math.atan2(Math.sin(giro), Math.cos(giro));
        a.dir += giro * Math.min(1, dt * 6);
        a.fase += dt * (a.tipo === 'gallina' ? 16 : 10);
      } else {
        a.espera -= dt;
        if (a.espera <= 0) {
          a.espera = entre(a.azar, 1.5, 7);
          // Nuevo sitio al que ir, sin meterse en el agua.
          for (let intento = 0; intento < 4; intento++) {
            const ang = a.azar() * Math.PI * 2;
            const r = Math.sqrt(a.azar()) * a.radio;
            const x = a.ax + Math.cos(ang) * r;
            const z = a.az + Math.sin(ang) * r;
            if (this.mojado(x, z) || this.mojado((x + a.x) / 2, (z + a.z) / 2)) continue;
            a.metaX = x;
            a.metaZ = z;
            break;
          }
        }
        a.fase += dt * 2;
      }
      const y = this.alturaPaso(a.x, a.z);
      const bote = anda ? Math.abs(Math.sin(a.fase)) * (a.tipo === 'gallina' ? 0.05 : 0.035) : 0;
      // Parada, la gallina picotea y la oveja pace: agachan la cabeza de vez en cuando.
      const cabeceo = !anda && a.tipo !== 'perro' ? Math.max(0, Math.sin(a.fase * 0.8)) * (a.tipo === 'gallina' ? 0.5 : 0.22) : 0;
      _base.makeRotationY(a.dir).setPosition(a.x, y + bote, a.z);
      _m.makeRotationX(cabeceo).scale(_v.set(a.escala, a.escala, a.escala));
      a.ficha.lote.mover(a.ficha.instancia, _base.multiply(_m));
    }
  }
}
