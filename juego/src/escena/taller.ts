// Taller: utilidades para levantar piezas procedurales de cuento (cajas, vigas, tejados de paja
// abombados, ventanas, puertas…) acumulándolas en una «obra» que al final se funde en una malla por
// material. Las piezas de color liso van al material «pintura» (color por vértice); las de piedra,
// pizarra, ladrillo y madera reutilizan las texturas del pack para casar con sus modelos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Azar, crearAzar, entre } from '../util/azar';
import type { Biblioteca } from './modelos';
import { ACENTOS, C } from './paleta';

export type ClaveMaterial = 'pintura' | 'piedra' | 'pizarra' | 'ladrillo' | 'madera' | 'tabla' | 'roca';

/** Material del pack que hace de cada clave, y el color liso que lo suple si falta el pack. */
const MATERIAL_PACK: Record<Exclude<ClaveMaterial, 'pintura'>, [string, number]> = {
  piedra: ['StoneBrick1', C.piedra],
  pizarra: ['Roof01', C.pizarra],
  ladrillo: ['StoneBrick2', 0xb98a5a],
  madera: ['WoodPlank03', C.viga],
  tabla: ['WoodPlank01', C.tabla],
  roca: ['Rock01', C.piedraClara],
};

export interface Opc {
  rx?: number;
  ry?: number;
  rz?: number;
  mat?: ClaveMaterial;
  /** 0–1: brilla de noche (ventanas, faroles). 2: brilla siempre (fuego, brasas). */
  luz?: number;
  /** Variación de claridad de la pieza (0,05 por defecto). */
  vari?: number;
  /** Oscurece la parte baja de la pieza (0–1): mancha de humedad, sombra de contacto. */
  sombra?: number;
  /** Metros que cubre una baldosa de textura (2 por defecto). */
  uv?: number;
  lados?: number;
}

export type TipoMarca = 'humo' | 'fuego' | 'luz' | 'puerta';

export interface Marca {
  tipo: TipoMarca;
  pos: THREE.Vector3;
  /** Tamaño o fuerza relativa. */
  valor: number;
}

const _pos = new THREE.Vector3();
const _esc = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _color = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const EJE_Y = new THREE.Vector3(0, 1, 0);

export class Obra {
  readonly azar: Azar;
  readonly bib: Biblioteca;
  private readonly partes = new Map<ClaveMaterial, THREE.BufferGeometry[]>();
  private readonly extras: THREE.Object3D[] = [];
  private readonly marcas: Marca[] = [];
  private base = new THREE.Matrix4();

  constructor(bib: Biblioteca, semilla: number) {
    this.bib = bib;
    this.azar = crearAzar(semilla);
  }

  /** Ejecuta `fn` con el origen movido a (x, y, z) y girado `ry` sobre la vertical. */
  con(x: number, y: number, z: number, ry: number, fn: () => void): this {
    const previa = this.base.clone();
    _mat.makeRotationY(ry).setPosition(x, y, z);
    this.base.multiply(_mat);
    fn();
    this.base.copy(previa);
    return this;
  }

  /** Añade una geometría (en coordenadas locales de la obra) con su color y opciones. */
  malla(g: THREE.BufferGeometry, color: number, o: Opc = {}, local?: THREE.Matrix4): this {
    const mat = o.mat ?? 'pintura';
    const m = local ? this.base.clone().multiply(local) : this.base;
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    if (!g.getIndex()) {
      const indices = new Uint32Array(n);
      for (let i = 0; i < n; i++) indices[i] = i;
      g.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    if (mat === 'pintura') {
      g.deleteAttribute('uv');
      const vari = o.vari ?? 0.05;
      const f = 1 + (this.azar() - 0.5) * 2 * vari;
      _color.setHex(color);
      const col = new Float32Array(n * 3);
      const luz = new Float32Array(n).fill(o.luz ?? 0);
      let y0 = Infinity;
      let y1 = -Infinity;
      const p = g.getAttribute('position');
      if (o.sombra) {
        for (let i = 0; i < n; i++) {
          y0 = Math.min(y0, p.getY(i));
          y1 = Math.max(y1, p.getY(i));
        }
      }
      for (let i = 0; i < n; i++) {
        let k = f;
        if (o.sombra) k *= 1 - o.sombra * (1 - (p.getY(i) - y0) / Math.max(0.001, y1 - y0));
        col[i * 3] = _color.r * k;
        col[i * 3 + 1] = _color.g * k;
        col[i * 3 + 2] = _color.b * k;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('luz', new THREE.BufferAttribute(luz, 1));
    } else {
      g.deleteAttribute('color');
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    const lista = this.partes.get(mat);
    if (lista) lista.push(g);
    else this.partes.set(mat, [g]);
    return this;
  }

  private matriz(x: number, y: number, z: number, o: Opc): THREE.Matrix4 {
    _euler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
    return new THREE.Matrix4().compose(_pos.set(x, y, z), _quat.setFromEuler(_euler), _esc.set(1, 1, 1));
  }

  /** Caja de w × h × d apoyada en `y` (la base), centrada en x y z. Gira sobre su centro. */
  caja(w: number, h: number, d: number, x: number, y: number, z: number, color: number, o: Opc = {}): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.mat && o.mat !== 'pintura') escalarUvCaja(g, w, h, d, o.uv ?? 2);
    return this.malla(g, color, o, this.matriz(x, y + h / 2, z, o));
  }

  /** Cilindro o tronco de cono apoyado en `y`. */
  cil(rArriba: number, rAbajo: number, h: number, x: number, y: number, z: number, color: number, o: Opc = {}): this {
    const g = new THREE.CylinderGeometry(rArriba, rAbajo, h, o.lados ?? 8, 1);
    if (o.mat && o.mat !== 'pintura') {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const k = o.uv ?? 2;
      const giro = (Math.PI * (rArriba + rAbajo)) / k;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * giro, (uv.getY(i) * h) / k);
    }
    return this.malla(g, color, o, this.matriz(x, y + h / 2, z, o));
  }

  cono(r: number, h: number, x: number, y: number, z: number, color: number, o: Opc = {}): this {
    return this.cil(0.001, r, h, x, y, z, color, o);
  }

  /** Bola facetada centrada en (x, y, z); `esc` la achata o la estira. */
  bola(r: number, x: number, y: number, z: number, color: number, o: Opc & { esc?: [number, number, number]; det?: number } = {}): this {
    const g = new THREE.IcosahedronGeometry(r, o.det ?? 1);
    const m = this.matriz(x, y, z, o);
    if (o.esc) m.scale(_esc.set(o.esc[0], o.esc[1], o.esc[2]));
    return this.malla(g, color, o, m);
  }

  /** Viga recta entre dos puntos; `grosor` puede ser [ancho, canto]. */
  viga(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    grosor: number | [number, number],
    color: number,
    o: Opc = {},
  ): this {
    _a.set(x0, y0, z0);
    _b.set(x1, y1, z1);
    const largo = _a.distanceTo(_b);
    if (largo < 1e-4) return this;
    const [gx, gz] = typeof grosor === 'number' ? [grosor, grosor] : grosor;
    const g = new THREE.BoxGeometry(gx, largo, gz);
    if (o.mat && o.mat !== 'pintura') escalarUvCaja(g, gx, largo, gz, o.uv ?? 2);
    _quat.setFromUnitVectors(EJE_Y, _b.clone().sub(_a).normalize());
    // El giro `ry` orienta la cara ancha de la viga alrededor de su propio eje.
    if (o.ry) _quat.multiply(new THREE.Quaternion().setFromAxisAngle(EJE_Y, o.ry));
    const m = new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), _quat, _esc.set(1, 1, 1));
    return this.malla(g, color, o, m);
  }

  /** Coloca un modelo del pack. `esc` escala uniforme; la base del modelo queda en `y`. */
  glb(nombre: string, x: number, y: number, z: number, o: { ry?: number; esc?: number | [number, number, number]; rx?: number; rz?: number } = {}): this {
    if (!this.bib.tiene(nombre)) return this;
    const g = this.bib.grupo(nombre);
    g.position.set(x, y, z);
    g.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
    if (typeof o.esc === 'number') g.scale.setScalar(o.esc);
    else if (o.esc) g.scale.set(o.esc[0], o.esc[1], o.esc[2]);
    const cont = new THREE.Group();
    cont.applyMatrix4(this.base);
    cont.add(g);
    this.extras.push(cont);
    return this;
  }

  /** Punto con significado: de dónde sale humo, dónde hay fuego o una luz. */
  marca(tipo: TipoMarca, x: number, y: number, z: number, valor = 1): this {
    this.marcas.push({ tipo, pos: new THREE.Vector3(x, y, z).applyMatrix4(this.base), valor });
    return this;
  }

  /** Objeto que no se hornea en los lotes (se mueve o tiene material propio). */
  vivo(obj: THREE.Object3D): this {
    const cont = new THREE.Group();
    cont.applyMatrix4(this.base);
    cont.add(obj);
    cont.userData['vivo'] = true;
    this.extras.push(cont);
    return this;
  }

  /** Funde todo en un grupo: una malla por material, más los modelos del pack y las piezas vivas. */
  grupo(): THREE.Group {
    const grupo = new THREE.Group();
    for (const [mat, lista] of this.partes) {
      const fundida = mergeGeometries(lista, false);
      for (const g of lista) g.dispose();
      if (!fundida) continue;
      const material = mat === 'pintura' ? this.bib.pintura : this.bib.material(...MATERIAL_PACK[mat]);
      const malla = new THREE.Mesh(fundida, material);
      malla.castShadow = true;
      malla.receiveShadow = true;
      grupo.add(malla);
    }
    for (const e of this.extras) grupo.add(e);
    grupo.userData['marcas'] = this.marcas;
    return grupo;
  }

  // ───────────────────────── piezas de cuento ─────────────────────────

  /**
   * Tejado de cuento con la cumbrera a lo largo de z. `w` es el ancho entre paredes, `d` el largo,
   * `alto` lo que sube la cumbrera sobre el borde de las paredes (`y`).
   */
  tejado(w: number, d: number, alto: number, x: number, y: number, z: number, t: OpcTejado = {}): this {
    return this.con(x, y, z, t.eje === 'x' ? Math.PI / 2 : 0, () => this.tejadoLocal(w, d, alto, t));
  }

  private tejadoLocal(w: number, d: number, alto: number, t: OpcTejado): void {
    const alero = t.alero ?? 0.4;
    const ab = t.abomba ?? 0.45;
    const cadera = t.cadera ?? 0.25;
    const comba = t.comba ?? 0.06;
    const grosor = t.grosor ?? 0.28;
    const mat = t.mat ?? 'pintura';
    const color = t.color ?? C.paja;
    const canto = t.colorCanto ?? C.pajaSombra;
    const X = w / 2 + alero;
    const caida = (alto * alero) / (w / 2);
    const altoT = alto + caida;
    const y0 = -caida;
    const nt = ab > 0.01 ? 12 : 2;
    const ns = t.tramos ?? (cadera > 0.6 || comba > 0.01 ? 6 : 2);
    const uvK = t.uv ?? 2;

    const perfil = (i: number): [number, number] => {
      const tt = i / nt;
      const s = tt * 2 - 1;
      const xT = X * s;
      const yT = altoT * (1 - Math.abs(s));
      const xE = -X * Math.cos(Math.PI * tt);
      const yE = altoT * Math.sin(Math.PI * tt);
      return [xT + (xE - xT) * ab, yT + (yE - yT) * ab];
    };
    const tiron = (yRel: number) => cadera * Math.pow(Math.max(0, yRel) / altoT, 1.3);

    // Superficie exterior.
    const pos: number[] = [];
    const uvs: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    _color.setHex(color);
    const base: [number, number, number] = [_color.r, _color.g, _color.b];
    const semiLargo = d / 2 + alero;
    let arco = 0;
    const arcos: number[] = [0];
    for (let i = 1; i <= nt; i++) {
      const [xa, ya] = perfil(i - 1);
      const [xb, yb] = perfil(i);
      arco += Math.hypot(xb - xa, yb - ya);
      arcos.push(arco);
    }
    const punto = (i: number, j: number): [number, number, number] => {
      const [px, py] = perfil(i);
      const u = (j / ns) * 2 - 1;
      const hRel = py / altoT;
      const yv = y0 + py * (1 - comba * (1 - u * u) * hRel);
      const zv = u * semiLargo - Math.sign(u) * Math.pow(Math.abs(u), 1.5) * tiron(py);
      return [px, yv, zv];
    };
    for (let j = 0; j <= ns; j++) {
      for (let i = 0; i <= nt; i++) {
        const [px, py, pz] = punto(i, j);
        const borde = i === 0 || i === nt;
        pos.push(px, py + (borde && mat === 'pintura' ? (this.azar() - 0.5) * 0.07 : 0), pz);
        uvs.push(pz / uvK, arcos[i] / uvK);
        const hRel = (py - y0) / altoT;
        const k = (0.9 + this.azar() * 0.18) * (0.86 + 0.2 * hRel);
        cols.push(base[0] * k, base[1] * k, base[2] * k);
      }
    }
    const fila = nt + 1;
    for (let j = 0; j < ns; j++) {
      for (let i = 0; i < nt; i++) {
        const a = j * fila + i;
        const b = a + 1;
        const c = a + fila;
        const e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    this.mallaCruda(pos, idx, uvs, cols, mat);

    // Cantos: el grosor de la paja visto en los testeros y en los aleros.
    const posC: number[] = [];
    const idxC: number[] = [];
    const dentro = (p: [number, number, number], zExtra: number): [number, number, number] => [
      p[0] * (1 - (0.9 * grosor) / X),
      Math.max(y0 - grosor * 0.2, p[1] - grosor),
      p[2] + zExtra,
    ];
    for (const j of [0, ns]) {
      const signo = j === 0 ? 1 : -1;
      const ini = posC.length / 3;
      for (let i = 0; i <= nt; i++) {
        const p = punto(i, j);
        const q = dentro(p, signo * 0.04);
        posC.push(p[0], p[1], p[2], q[0], q[1], q[2]);
      }
      for (let i = 0; i < nt; i++) {
        const a = ini + i * 2;
        if (j === 0) idxC.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
        else idxC.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    for (const i of [0, nt]) {
      const lado = i === 0 ? -1 : 1;
      const ini = posC.length / 3;
      for (let j = 0; j <= ns; j++) {
        const p = punto(i, j);
        // Frente del alero y vuelta por debajo hasta la pared.
        posC.push(p[0], p[1], p[2], p[0] - lado * 0.06, p[1] - grosor * 0.75, p[2], lado * (w / 2 - 0.02), Math.min(-0.02, p[1]), p[2]);
      }
      for (let j = 0; j < ns; j++) {
        const a = ini + j * 3;
        const b = a + 3;
        const cara = (p0: number, p1: number, p2: number, p3: number) =>
          lado < 0 ? idxC.push(p0, p1, p2, p2, p1, p3) : idxC.push(p0, p2, p1, p2, p3, p1);
        cara(a, a + 1, b, b + 1);
        cara(a + 1, a + 2, b + 1, b + 2);
      }
    }
    this.mallaCruda(posC, idxC, undefined, undefined, mat, canto);

    // Hastiales: el triángulo de pared bajo el tejado, recortado si la cadera se lo come.
    if (t.hastial !== undefined) {
      const tope = cadera > alero - 0.05 ? altoT * Math.pow(Math.max(0.02, alero - 0.05) / cadera, 1 / 1.3) - grosor : Infinity;
      for (const signo of [1, -1]) {
        const zp = signo * (d / 2);
        const pts: [number, number][] = [[-w / 2, 0]];
        for (let i = 0; i <= nt; i++) {
          const [px, py] = perfil(i);
          if (Math.abs(px) > w / 2) continue;
          pts.push([px, Math.max(0, Math.min(tope, y0 + py - grosor * 0.55))]);
        }
        pts.push([w / 2, 0]);
        const pp: number[] = [0, 0, zp];
        const ii: number[] = [];
        for (const [px, py] of pts) pp.push(px, py, zp);
        for (let k = 1; k < pts.length; k++) {
          if (signo > 0) ii.push(0, k + 1, k);
          else ii.push(0, k, k + 1);
        }
        this.mallaCruda(pp, ii, undefined, undefined, t.matHastial ?? 'pintura', t.hastial);
        if (t.vigas !== false && (t.matHastial ?? 'pintura') === 'pintura') {
          const cima = Math.min(tope, alto - grosor * 0.6);
          const zz = zp + signo * 0.04;
          const cv = t.colorVigas ?? C.viga;
          this.viga(0, 0, zz, 0, cima, zz, 0.13, cv);
          this.viga(-w / 2, 0.07, zz, w / 2, 0.07, zz, 0.14, cv);
          if (cima > 1) {
            this.viga(-w * 0.27, 0.07, zz, 0, cima * 0.62, zz, 0.11, cv);
            this.viga(w * 0.27, 0.07, zz, 0, cima * 0.62, zz, 0.11, cv);
          }
        }
      }
    }

    // Caballete y palos cruzados en los extremos de la cumbrera.
    if (t.caballete !== false && mat === 'pintura') {
      const cc = t.colorCaballete ?? C.pajaOscura;
      for (let j = 0; j < ns; j++) {
        const p = punto(nt / 2, j);
        const q = punto(nt / 2, j + 1);
        this.viga(p[0], p[1] + 0.03, p[2], q[0], q[1] + 0.03, q[2], [0.5, 0.16], cc);
      }
      if (t.aspas !== false) {
        for (const j of [0, ns]) {
          const p = punto(nt / 2, j);
          const zz = p[2] + (j === 0 ? 0.12 : -0.12);
          this.viga(-0.32, p[1] - 0.25, zz, 0.2, p[1] + 0.42, zz, 0.07, C.viga);
          this.viga(0.32, p[1] - 0.25, zz, -0.2, p[1] + 0.42, zz, 0.07, C.viga);
        }
      }
    }
  }

  /** Geometría suelta a partir de listas de posiciones e índices (en coordenadas locales). */
  mallaCruda(pos: number[], idx: number[], uvs: number[] | undefined, cols: number[] | undefined, mat: ClaveMaterial, color: number = C.paja): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    if (uvs && mat !== 'pintura') g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.computeVertexNormals();
    this.malla(g, color, { mat, vari: 0.03 });
    if (cols && mat === 'pintura') {
      const lista = this.partes.get('pintura');
      const ultima = lista?.[lista.length - 1];
      ultima?.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
    }
  }

  /** Tejado redondo (pozo, torre, pajar): perfil de revolución abombado. */
  tejadoRedondo(r: number, alto: number, x: number, y: number, z: number, o: { color?: number; abomba?: number; lados?: number; mat?: ClaveMaterial } = {}): this {
    const ab = o.abomba ?? 0.5;
    const pts: THREE.Vector2[] = [];
    const n = 6;
    pts.push(new THREE.Vector2(r * 0.86, -0.14));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const rr = r * (1 - t);
      const recto = alto * t;
      const curvo = alto * Math.sin((t * Math.PI) / 2);
      pts.push(new THREE.Vector2(Math.max(0.001, rr), recto + (curvo - recto) * ab));
    }
    const g = new THREE.LatheGeometry(pts, o.lados ?? 10);
    if (o.mat && o.mat !== 'pintura') {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * r, uv.getY(i) * (alto / 1.4));
    }
    return this.malla(g, o.color ?? C.paja, { mat: o.mat, vari: 0.06 }, new THREE.Matrix4().makeTranslation(x, y, z));
  }

  /**
   * Entramado: vigas vistas sobre una fachada. Se dibuja en el plano local z = 0 mirando a +z,
   * centrado en u = 0, entre v0 y v0 + h. Úsese dentro de `con(...)`.
   */
  entramado(w: number, v0: number, h: number, e: OpcEntramado = {}): this {
    const c = e.color ?? C.viga;
    const g = e.grosor ?? 0.14;
    const z = 0.03;
    const izq = -w / 2 + g / 2;
    const der = w / 2 - g / 2;
    this.viga(izq, v0, z, izq, v0 + h, z, [g, 0.12], c);
    this.viga(der, v0, z, der, v0 + h, z, [g, 0.12], c);
    this.viga(-w / 2, v0 + h - g / 2, z, w / 2, v0 + h - g / 2, z, [g, 0.12], c);
    if (e.solera !== false) this.viga(-w / 2, v0 + g / 2, z, w / 2, v0 + g / 2, z, [g, 0.12], c);
    if (e.travesano) this.viga(-w / 2, v0 + h * e.travesano, z, w / 2, v0 + h * e.travesano, z, [g * 0.85, 0.11], c);
    const montantes = e.montantes ?? Math.max(0, Math.round(w / 1.3) - 1);
    for (let i = 1; i <= montantes; i++) {
      const u = -w / 2 + (w * i) / (montantes + 1);
      if (e.huecos?.some(([a, b]) => u > a - 0.1 && u < b + 0.1)) continue;
      this.viga(u, v0, z, u, v0 + h, z, [g * 0.8, 0.11], c);
    }
    if (e.riostras !== false) {
      const largo = Math.min(h * 0.8, w * 0.28);
      this.viga(izq, v0 + h - largo, z, izq + largo * 0.8, v0 + h - g, z, [g * 0.75, 0.1], c);
      this.viga(der, v0 + h - largo, z, der - largo * 0.8, v0 + h - g, z, [g * 0.75, 0.1], c);
    }
    return this;
  }

  /** Ventanita con marco, cruceta, contraventanas y jardinera. Plano local z = 0; (u, v) es su centro. */
  ventana(u: number, v: number, w: number, h: number, e: OpcVentana = {}): this {
    const marco = e.marco ?? C.viga;
    const g = 0.08;
    const luz = e.luz ?? (this.azar() < 0.8 ? entre(this.azar, 0.6, 1) : 0);
    this.caja(w, h, 0.05, u, v - h / 2, 0.015, C.cristal, { luz, vari: 0.1 });
    if (e.arco) this.cil(w / 2, w / 2, 0.05, u, v + h / 2 - 0.025, 0.015, C.cristal, { rx: Math.PI / 2, lados: 12, luz, vari: 0.1 });
    else this.caja(w + g * 2, g, 0.12, u, v + h / 2, 0.04, marco);
    this.caja(w + g * 2.6, g * 1.1, 0.18, u, v - h / 2 - g, 0.05, marco);
    this.caja(g, h, 0.12, u - w / 2 - g / 2, v - h / 2, 0.04, marco);
    this.caja(g, h, 0.12, u + w / 2 + g / 2, v - h / 2, 0.04, marco);
    if (e.cruceta !== false) {
      this.caja(0.045, h, 0.07, u, v - h / 2, 0.03, marco);
      this.caja(w, 0.045, 0.07, u, v - 0.02, 0.03, marco);
    }
    if (e.contras !== undefined) {
      const cw = w * 0.5;
      this.caja(cw, h * 1.02, 0.05, u - w / 2 - g - cw / 2, v - h / 2, 0.06, e.contras, { ry: -0.35 });
      this.caja(cw, h * 1.02, 0.05, u + w / 2 + g + cw / 2, v - h / 2, 0.06, e.contras, { ry: 0.35 });
    }
    if (e.jardinera) {
      const yj = v - h / 2 - g - 0.2;
      this.caja(w + 0.2, 0.2, 0.24, u, yj, 0.16, C.madera);
      const flores = [0xd9534a, 0xf2c94c, 0xf4a6b8, 0xffffff, 0xc86fc9];
      const n = Math.max(3, Math.round(w / 0.16));
      for (let i = 0; i < n; i++) {
        const fx = u - w / 2 + (w * (i + 0.5)) / n;
        this.bola(0.085, fx, yj + 0.24 + this.azar() * 0.05, 0.17 + (this.azar() - 0.5) * 0.06, i % 3 === 1 ? 0x5f8f45 : flores[Math.floor(this.azar() * flores.length)], { det: 0, vari: 0.1 });
      }
    }
    return this;
  }

  /** Puerta de tablas con marco, tirador y escalón. Plano local z = 0; `u` es su centro. */
  puerta(u: number, w: number, h: number, e: OpcPuerta = {}): this {
    const marco = e.marco ?? C.viga;
    const v0 = e.v0 ?? 0;
    const color = e.color ?? C.puerta;
    this.caja(w, h, 0.08, u, v0, 0.02, color, { sombra: 0.15 });
    // Tablas marcadas con listones finos.
    for (let i = 1; i < 3; i++) this.caja(0.025, h * 0.96, 0.1, u - w / 2 + (w * i) / 3, v0, 0.02, 0x3a2618);
    this.caja(0.13, h + 0.1, 0.16, u - w / 2 - 0.065, v0, 0.04, marco);
    this.caja(0.13, h + 0.1, 0.16, u + w / 2 + 0.065, v0, 0.04, marco);
    if (e.arco) this.cil(w / 2, w / 2, 0.08, u, v0 + h - 0.04, 0.02, color, { rx: Math.PI / 2, lados: 12 });
    else this.caja(w + 0.42, 0.16, 0.2, u, v0 + h, 0.05, marco);
    this.caja(0.06, 0.06, 0.08, u + w * 0.3, v0 + h * 0.48, 0.09, C.hierro);
    if (e.escalon !== false) this.caja(w + 0.5, 0.14, 0.5, u, v0 - 0.06, 0.25, C.piedraClara, { vari: 0.08 });
    this.marca('puerta', u, v0, 0.6);
    return this;
  }

  /** Chimenea de piedra o ladrillo con su remate; deja la marca del humo. */
  chimenea(x: number, y: number, z: number, alto: number, e: { ancho?: number; mat?: ClaveMaterial; humo?: number } = {}): this {
    const a = e.ancho ?? 0.62;
    const mat = e.mat ?? 'piedra';
    this.caja(a, alto, a, x, y, z, C.piedra, { mat, uv: 1.6 });
    this.caja(a + 0.16, 0.14, a + 0.16, x, y + alto, z, C.piedraOscura, { mat, uv: 1.6 });
    this.caja(a * 0.7, 0.22, a * 0.7, x, y + alto + 0.14, z, C.piedraOscura, { mat, uv: 1.6 });
    this.caja(a * 0.5, 0.03, a * 0.5, x, y + alto + 0.36, z, C.negro);
    this.marca('humo', x, y + alto + 0.4, z, e.humo ?? 1);
    return this;
  }

  /** Color de acento estable para esta obra (contraventanas, puerta, toldos). */
  acento(): number {
    return ACENTOS[Math.floor(this.azar() * ACENTOS.length)];
  }
}

export interface OpcTejado {
  /** Vuelo del tejado más allá de las paredes, en metros. */
  alero?: number;
  /** 0 = dos aguas rectas; 1 = bóveda. La paja de cuento va entre 0,3 y 0,6. */
  abomba?: number;
  /** Metros que la cumbrera se acorta en cada testero (a cuatro aguas si es grande). */
  cadera?: number;
  /** Hundimiento de la cumbrera en el centro (fracción de la altura). */
  comba?: number;
  grosor?: number;
  color?: number;
  colorCanto?: number;
  colorCaballete?: number;
  colorVigas?: number;
  mat?: ClaveMaterial;
  /** Dirección de la cumbrera: 'z' (por defecto) o 'x'. */
  eje?: 'x' | 'z';
  /** Color de la pared del hastial; si falta, no se dibuja. */
  hastial?: number;
  matHastial?: ClaveMaterial;
  vigas?: boolean;
  caballete?: boolean;
  aspas?: boolean;
  tramos?: number;
  uv?: number;
}

export interface OpcEntramado {
  color?: number;
  grosor?: number;
  solera?: boolean;
  /** Altura relativa de un travesaño horizontal (0–1). */
  travesano?: number;
  montantes?: number;
  riostras?: boolean;
  /** Tramos [u0, u1] sin montantes (donde van puertas y ventanas). */
  huecos?: [number, number][];
}

export interface OpcVentana {
  marco?: number;
  contras?: number;
  jardinera?: boolean;
  cruceta?: boolean;
  arco?: boolean;
  luz?: number;
}

export interface OpcPuerta {
  color?: number;
  marco?: number;
  arco?: boolean;
  escalon?: boolean;
  v0?: number;
}

function escalarUvCaja(g: THREE.BoxGeometry, w: number, h: number, d: number, k: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let cara = 0; cara < 6; cara++) {
    for (let v = 0; v < 4; v++) {
      const i = cara * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[cara][0]) / k, (uv.getY(i) * dims[cara][1]) / k);
    }
  }
}

/** Sustituye todos los materiales de un grupo (para el fantasma de la vista previa). */
export function conMaterial(grupo: THREE.Object3D, material: THREE.Material): void {
  grupo.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
      o.material = material;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
}
