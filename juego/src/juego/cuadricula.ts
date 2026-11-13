// Cuadrícula invisible del valle y reglas del contrato de mapa (docs/DISENO.md, Parte II §2).
//
// Dos sistemas de coordenadas:
//  · celdas (cx, cz): enteros de 0 a n−1. Los puntos de paisajes.yaml (río, caminos…) son celdas,
//    es decir, se refieren al CENTRO de esa celda. Las distancias del contrato se miden así, en celdas.
//  · mundo (x, z): metros; el centro de la cuadrícula es el origen y el norte es z negativo.
import { LADO_CELDA, type Paisaje, type Par } from '../datos';

export type TipoCelda = 'tierra' | 'agua' | 'orilla' | 'puente' | 'camino';

export interface PuntoRio {
  /** Distancia al eje, en celdas. */
  dist: number;
  /** Dirección de la corriente (unitaria, en celdas). */
  tx: number;
  tz: number;
}

function distSegmento(px: number, pz: number, a: Par, b: Par): { d: number; t: number } {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const l2 = vx * vx + vz * vz;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a[0]) * vx + (pz - a[1]) * vz) / l2));
  const dx = px - (a[0] + vx * t);
  const dz = pz - (a[1] + vz * t);
  return { d: Math.hypot(dx, dz), t };
}

/** Celdas que pisa una polilínea, unidas por los lados (sin saltos en diagonal). */
export function celdasDePolilinea(puntos: Par[]): Par[] {
  const celdas: Par[] = [];
  const vistas = new Set<string>();
  const anotar = (cx: number, cz: number) => {
    const k = `${cx},${cz}`;
    if (!vistas.has(k)) {
      vistas.add(k);
      celdas.push([cx, cz]);
    }
  };
  for (let i = 0; i + 1 < puntos.length; i++) {
    let [x, z] = puntos[i];
    const [x1, z1] = puntos[i + 1];
    const dx = Math.abs(x1 - x);
    const dz = Math.abs(z1 - z);
    const sx = x < x1 ? 1 : -1;
    const sz = z < z1 ? 1 : -1;
    let err = dx - dz;
    anotar(x, z);
    while (x !== x1 || z !== z1) {
      // Avanza un solo eje cada vez para que la fila de celdas quede unida por los lados.
      if (err > 0 || (err === 0 && dx >= dz)) {
        err -= 2 * dz;
        x += sx;
      } else {
        err += 2 * dx;
        z += sz;
      }
      anotar(x, z);
    }
  }
  return celdas;
}

export class Cuadricula {
  readonly n: number;
  readonly lado = LADO_CELDA;
  /** Mitad del lado del valle, en metros. */
  readonly mitad: number;
  readonly paisaje: Paisaje;
  private readonly caminoBase: Uint8Array;
  private readonly caminoPuesto: Uint8Array;
  private readonly ocupantes = new Map<number, string>();

  constructor(paisaje: Paisaje) {
    this.paisaje = paisaje;
    this.n = paisaje.celdas;
    this.mitad = (this.n * this.lado) / 2;
    this.caminoBase = new Uint8Array(this.n * this.n);
    this.caminoPuesto = new Uint8Array(this.n * this.n);
    for (const tramo of paisaje.camino) {
      for (const [cx, cz] of celdasDePolilinea(tramo)) {
        if (this.dentro(cx, cz)) this.caminoBase[this.indice(cx, cz)] = 1;
      }
    }
  }

  indice(cx: number, cz: number): number {
    return cz * this.n + cx;
  }

  dentro(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n;
  }

  /** Centro de la celda en metros. Admite fracciones (0,5 = borde entre dos celdas). */
  celdaAMundo(cx: number, cz: number): { x: number; z: number } {
    return { x: (cx - this.n / 2 + 0.5) * this.lado, z: (cz - this.n / 2 + 0.5) * this.lado };
  }

  /** Celda que contiene el punto (puede caer fuera: compruébese con `dentro`). */
  mundoACelda(x: number, z: number): { cx: number; cz: number } {
    return { cx: Math.floor(x / this.lado + this.n / 2), cz: Math.floor(z / this.lado + this.n / 2) };
  }

  /** Coordenadas de celda con decimales (el centro de la celda es el entero). */
  mundoACeldaReal(x: number, z: number): { cx: number; cz: number } {
    return { cx: x / this.lado + this.n / 2 - 0.5, cz: z / this.lado + this.n / 2 - 0.5 };
  }

  /** Distancia al eje del río y dirección de la corriente, en celdas. */
  rio(cxf: number, czf: number): PuntoRio {
    const p = this.paisaje.rio.puntos;
    let mejor = Infinity;
    let tx = 0;
    let tz = 1;
    for (let i = 0; i + 1 < p.length; i++) {
      const { d } = distSegmento(cxf, czf, p[i], p[i + 1]);
      if (d < mejor) {
        mejor = d;
        const vx = p[i + 1][0] - p[i][0];
        const vz = p[i + 1][1] - p[i][1];
        const l = Math.hypot(vx, vz) || 1;
        tx = vx / l;
        tz = vz / l;
      }
    }
    return { dist: mejor, tx, tz };
  }

  distRio(cxf: number, czf: number): number {
    const p = this.paisaje.rio.puntos;
    let mejor = Infinity;
    for (let i = 0; i + 1 < p.length; i++) {
      const { d } = distSegmento(cxf, czf, p[i], p[i + 1]);
      if (d < mejor) mejor = d;
    }
    return mejor;
  }

  /** Distancia al camino real del paisaje (polilíneas), en celdas. */
  distCaminoReal(cxf: number, czf: number): number {
    let mejor = Infinity;
    for (const tramo of this.paisaje.camino) {
      for (let i = 0; i + 1 < tramo.length; i++) {
        const { d } = distSegmento(cxf, czf, tramo[i], tramo[i + 1]);
        if (d < mejor) mejor = d;
      }
    }
    return mejor;
  }

  enPuente(cx: number, cz: number): boolean {
    const { celda, tam } = this.paisaje.puente;
    return cx >= celda[0] && cx < celda[0] + tam[0] && cz >= celda[1] && cz < celda[1] + tam[1];
  }

  esCamino(cx: number, cz: number): boolean {
    if (!this.dentro(cx, cz)) return false;
    const i = this.indice(cx, cz);
    return this.caminoBase[i] === 1 || this.caminoPuesto[i] > 0;
  }

  /** Anota o borra una celda de camino puesta por el jugador. */
  marcarCamino(cx: number, cz: number, puesto: boolean): void {
    if (!this.dentro(cx, cz)) return;
    const i = this.indice(cx, cz);
    this.caminoPuesto[i] = Math.max(0, this.caminoPuesto[i] + (puesto ? 1 : -1));
  }

  /**
   * Regla común del contrato: agua si el centro de la celda dista del eje menos de anchura/2;
   * orilla si dista menos de anchura/2 + 2. El puente manda sobre el agua y el camino sobre la orilla.
   */
  tipoCelda(cx: number, cz: number): TipoCelda {
    if (this.enPuente(cx, cz)) return 'puente';
    const d = this.distRio(cx, cz);
    const medio = this.paisaje.rio.anchura / 2;
    if (d < medio) return 'agua';
    if (this.esCamino(cx, cz)) return 'camino';
    if (d < medio + 2) return 'orilla';
    return 'tierra';
  }

  /** Punto del eje del río más cercano, en celdas. */
  puntoRio(cxf: number, czf: number): Par {
    const p = this.paisaje.rio.puntos;
    let mejor = Infinity;
    let punto: Par = [p[0][0], p[0][1]];
    for (let i = 0; i + 1 < p.length; i++) {
      const { d, t } = distSegmento(cxf, czf, p[i], p[i + 1]);
      if (d < mejor) {
        mejor = d;
        punto = [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t];
      }
    }
    return punto;
  }

  /**
   * Sitio del molino: el solar del paisaje arrimado al río hasta que su borde toca el agua (sin
   * pisarla), con el giro que deja la rueda mirando a la corriente. `rueda` es dónde cae la rueda
   * y `toma` el punto del río del que bebe; el terreno abre un caz entre los dos.
   */
  sitioMolino(tam: Par = [4, 4]): { cx: number; cz: number; rot: number; rueda: Par; toma: Par } {
    if (this.molino) return this.molino;
    let [cx, cz] = this.paisaje.solar_molino;
    const [w, f] = tam;
    const centro = (): Par => [cx + (w - 1) / 2, cz + (f - 1) / 2];
    const rio = this.puntoRio(...centro());
    const dx = rio[0] - centro()[0];
    const dz = rio[1] - centro()[1];
    const enX = Math.abs(dx) >= Math.abs(dz);
    const paso: Par = enX ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
    const pisaAgua = (x: number, z: number) => {
      for (let j = 0; j < f; j++) for (let i = 0; i < w; i++) if (this.tipoCelda(x + i, z + j) === 'agua' || this.enPuente(x + i, z + j)) return true;
      return false;
    };
    for (let i = 0; i < 12; i++) {
      if (pisaAgua(cx + paso[0], cz + paso[1])) break;
      cx += paso[0];
      cz += paso[1];
    }
    // La rueda está en el costado este del molino con rot = 0; rot gira la fachada sur → oeste → norte → este.
    const rot = enX ? (paso[0] > 0 ? 0 : 2) : paso[1] > 0 ? 1 : 3;
    const c = centro();
    const rueda: Par = [c[0] + paso[0] * (w / 2 - 0.9), c[1] + paso[1] * (f / 2 - 0.9)];
    const toma = this.puntoRio(rueda[0], rueda[1]);
    this.molino = { cx, cz, rot, rueda, toma };
    return this.molino;
  }

  private molino: { cx: number; cz: number; rot: number; rueda: Par; toma: Par } | null = null;

  ocupar(cx: number, cz: number, id: string): void {
    if (this.dentro(cx, cz)) this.ocupantes.set(this.indice(cx, cz), id);
  }

  liberar(cx: number, cz: number, id: string): void {
    const i = this.indice(cx, cz);
    if (this.ocupantes.get(i) === id) this.ocupantes.delete(i);
  }

  ocupante(cx: number, cz: number): string | undefined {
    return this.dentro(cx, cz) ? this.ocupantes.get(this.indice(cx, cz)) : undefined;
  }

  vaciarOcupacion(): void {
    this.ocupantes.clear();
    this.caminoPuesto.fill(0);
  }
}
