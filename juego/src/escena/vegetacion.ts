// Vegetación instanciada: árboles de hoja caduca y pinos, arbustos, matas de hierba, flores, juncos
// y rocas. Todo sale de los datos del paisaje (bosques, rocas, claro, río) con azar de semilla fija.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Cuadricula } from '../juego/cuadricula';
import { type Azar, crearAzar, entre, fbm, ruido2, semillaDe } from '../util/azar';
import { GLOBALES } from './glsl';
import { type Biblioteca, conNieve } from './modelos';
import type { PaletaEstacion } from './paleta';
import { NIVEL_AGUA, type Rect } from './terreno';

type Especie = 'caduco' | 'pino' | 'arbusto' | 'mata' | 'flor' | 'junco' | 'roca' | 'pedrusco';

interface Planta {
  especie: Especie;
  indice: number;
  matriz: THREE.Matrix4;
  oculta: number;
}

export interface ArbolPlantado {
  especie: 'caduco' | 'pino';
  indice: number;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const CERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Balanceo con el viento: mueve más lo que está más alto. */
function conViento(material: THREE.Material, fuerza: number, alturaRef: number): void {
  const previo = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previo?.call(material, shader, renderer);
    shader.uniforms['uTiempo'] = GLOBALES.uTiempo;
    shader.uniforms['uViento'] = GLOBALES.uViento;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTiempo;\nuniform float uViento;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 aldeaFase = instanceMatrix[3].xz;
        #else
          vec2 aldeaFase = vec2(0.0);
        #endif
        float aldeaAlto = clamp(position.y / ${alturaRef.toFixed(2)}, 0.0, 1.5);
        float aldeaOla = sin(uTiempo * 1.6 + aldeaFase.x * 0.35 + aldeaFase.y * 0.27) + 0.5 * sin(uTiempo * 3.1 + aldeaFase.x * 1.3);
        transformed.x += aldeaOla * aldeaAlto * aldeaAlto * ${fuerza.toFixed(3)} * (0.25 + uViento);
        transformed.z += aldeaOla * aldeaAlto * aldeaAlto * ${(fuerza * 0.6).toFixed(3)} * (0.25 + uViento);`,
      );
  };
  const clave = material.customProgramCacheKey?.call(material) ?? '';
  material.customProgramCacheKey = () => `${clave}|viento${fuerza}|${alturaRef}`;
}

function deformar(g: THREE.BufferGeometry, cuanto: number, semilla: number): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (ruido2(x * 1.7 + y * 2.3 + semilla, z * 1.9 - y * 1.1, semilla) - 0.5) * cuanto;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
}

function sinIndice(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const h = g.index ? g.toNonIndexed() : g;
  h.deleteAttribute('uv');
  return h;
}

function geoCopa(): THREE.BufferGeometry {
  const a = deformar(new THREE.IcosahedronGeometry(1.45, 1), 0.3, 3);
  a.scale(1, 0.86, 1);
  a.translate(0, 3.0, 0);
  const b = deformar(new THREE.IcosahedronGeometry(0.95, 0), 0.25, 5);
  b.translate(0.85, 3.75, 0.3);
  const c = deformar(new THREE.IcosahedronGeometry(0.85, 0), 0.25, 8);
  c.translate(-0.8, 3.45, -0.45);
  const g = mergeGeometries([sinIndice(a), sinIndice(b), sinIndice(c)]);
  g.computeVertexNormals();
  return g;
}

function geoTronco(alto: number, r: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.55, r, alto, 6, 1, true);
  g.translate(0, alto / 2 - 0.2, 0);
  return g;
}

function geoPino(): THREE.BufferGeometry {
  const pisos: THREE.BufferGeometry[] = [];
  const medidas: [number, number, number][] = [
    [1.35, 1.9, 1.5],
    [1.05, 1.7, 2.6],
    [0.7, 1.5, 3.6],
  ];
  for (const [r, h, y] of medidas) {
    const g = new THREE.ConeGeometry(r, h, 7, 1, true);
    g.translate(0, y + h / 2 - 0.5, 0);
    pisos.push(sinIndice(g));
  }
  const g = mergeGeometries(pisos);
  g.computeVertexNormals();
  return g;
}

function geoArbusto(): THREE.BufferGeometry {
  const a = deformar(new THREE.IcosahedronGeometry(0.6, 0), 0.3, 2);
  a.scale(1.2, 0.8, 1);
  a.translate(0, 0.38, 0);
  const b = deformar(new THREE.IcosahedronGeometry(0.4, 0), 0.3, 4);
  b.translate(0.5, 0.3, 0.2);
  const g = mergeGeometries([sinIndice(a), sinIndice(b)]);
  g.computeVertexNormals();
  return g;
}

function geoMata(): THREE.BufferGeometry {
  // Dos planos cruzados con la textura recortada de la mata (solo su parte limpia).
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 2; k++) {
    const a = (k * Math.PI) / 2 + 0.4;
    const dx = Math.cos(a) * 0.5;
    const dz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, 0.8, dz, -dx, 0.8, -dz);
    uv.push(0.06, 0.04, 0.76, 0.04, 0.76, 0.98, 0.06, 0.98);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function geoFlor(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.09, 0);
  g.translate(0, 0.24, 0);
  const h = sinIndice(g);
  h.computeVertexNormals();
  return h;
}

function geoJunco(): THREE.BufferGeometry {
  const partes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const h = 0.8 + i * 0.22;
    const g = new THREE.ConeGeometry(0.045, h, 4, 1, true);
    g.translate(0, h / 2, 0);
    g.rotateZ((i - 1.5) * 0.14);
    g.rotateY(i * 1.7);
    g.translate(Math.cos(i * 2.1) * 0.1, 0, Math.sin(i * 2.1) * 0.1);
    partes.push(sinIndice(g));
  }
  const g = mergeGeometries(partes);
  g.computeVertexNormals();
  return g;
}

export class Vegetacion {
  readonly grupo = new THREE.Group();
  private readonly mallas = new Map<Especie, THREE.InstancedMesh>();
  private readonly cuentas = new Map<Especie, number>();
  /** Plantas por celda, para despejar la huella de los edificios. */
  private readonly porCelda = new Map<number, Planta[]>();
  private readonly ocultas = new Map<string, Planta[]>();
  private readonly libres: Record<'caduco' | 'pino', number[]> = { caduco: [], pino: [] };
  private readonly troncos: Record<'caduco' | 'pino', THREE.InstancedMesh>;
  private readonly cuadricula: Cuadricula;
  private readonly altura: (x: number, z: number) => number;
  private readonly azar: Azar;
  private paleta: PaletaEstacion;
  private readonly matMata: THREE.MeshLambertMaterial;
  private readonly colorBase = new Map<Especie, Float32Array>();

  constructor(cuadricula: Cuadricula, altura: (x: number, z: number) => number, bib: Biblioteca, texturaMata: THREE.Texture, paleta: PaletaEstacion, clave: string) {
    this.cuadricula = cuadricula;
    this.altura = altura;
    this.paleta = paleta;
    this.azar = crearAzar(semillaDe(`vegetacion:${clave}`));
    this.grupo.name = 'vegetacion';

    const matCopa = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
    conNieve(matCopa);
    conViento(matCopa, 0.012, 1);
    const matTronco = new THREE.MeshStandardMaterial({ color: 0x6b4a32, flatShading: true, roughness: 1 });
    const matPino = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
    conNieve(matPino);
    conViento(matPino, 0.006, 1);
    const matArbusto = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
    conNieve(matArbusto);
    texturaMata.colorSpace = THREE.SRGBColorSpace;
    this.matMata = new THREE.MeshLambertMaterial({ map: texturaMata, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xffffff });
    conViento(this.matMata, 0.16, 0.8);
    // Las matas se iluminan como el suelo (normal hacia arriba), se miren por la cara que se miren.
    const previoMata = this.matMata.onBeforeCompile;
    this.matMata.onBeforeCompile = (shader, renderer) => {
      previoMata.call(this.matMata, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
      );
    };
    const matFlor = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const matJunco = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    conViento(matJunco, 0.1, 1.2);

    const crear = (e: Especie, g: THREE.BufferGeometry, m: THREE.Material, n: number, sombra: boolean) => {
      const malla = new THREE.InstancedMesh(g, m, n);
      malla.count = 0;
      malla.castShadow = sombra;
      malla.receiveShadow = true;
      malla.frustumCulled = false;
      malla.name = e;
      this.mallas.set(e, malla);
      this.cuentas.set(e, 0);
      this.colorBase.set(e, new Float32Array(n * 3));
      this.grupo.add(malla);
      return malla;
    };
    crear('caduco', geoCopa(), matCopa, 900, true);
    crear('pino', geoPino(), matPino, 500, true);
    crear('arbusto', geoArbusto(), matArbusto, 500, true);
    crear('mata', geoMata(), this.matMata, 7000, false);
    crear('flor', geoFlor(), matFlor, 1400, false);
    crear('junco', geoJunco(), matJunco, 500, false);
    const roca = bib.modelos.get('rock02');
    const geoRoca = roca ? roca.piezas[0].geometria : new THREE.DodecahedronGeometry(0.8, 0);
    const matRoca = roca ? roca.piezas[0].material : new THREE.MeshStandardMaterial({ color: 0x9a948a, flatShading: true });
    crear('roca', geoRoca, matRoca, 260, true);
    const pedrusco = deformar(new THREE.DodecahedronGeometry(0.5, 0), 0.5, 9);
    pedrusco.scale(1.2, 0.7, 1);
    pedrusco.computeVertexNormals();
    const matPedrusco = new THREE.MeshStandardMaterial({ color: 0x9a948a, flatShading: true, roughness: 1 });
    conNieve(matPedrusco);
    crear('pedrusco', pedrusco, matPedrusco, 260, true);

    this.troncos = {
      caduco: new THREE.InstancedMesh(geoTronco(2.6, 0.3), matTronco, 900),
      pino: new THREE.InstancedMesh(geoTronco(2.0, 0.22), matTronco, 500),
    };
    for (const t of Object.values(this.troncos)) {
      t.count = 0;
      t.castShadow = true;
      t.receiveShadow = true;
      t.frustumCulled = false;
      this.grupo.add(t);
    }
    this.sembrar();
    this.fijarEstacion(paleta);
  }

  private poner(e: Especie, x: number, z: number, escala: number | [number, number, number], giro: number, tinte: number, inclinacion = 0, yExtra = 0): Planta | null {
    const malla = this.mallas.get(e);
    if (!malla) return null;
    let indice: number;
    const libres = e === 'caduco' || e === 'pino' ? this.libres[e] : undefined;
    if (libres && libres.length) indice = libres.pop() as number;
    else {
      indice = this.cuentas.get(e) ?? 0;
      if (indice >= malla.instanceMatrix.count) return null;
      this.cuentas.set(e, indice + 1);
      malla.count = indice + 1;
    }
    const y = this.altura(x, z) + yExtra;
    _e.set(inclinacion * Math.cos(giro * 3), giro, inclinacion * Math.sin(giro * 3));
    if (typeof escala === 'number') _s.setScalar(escala);
    else _s.set(escala[0], escala[1], escala[2]);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s);
    malla.setMatrixAt(indice, _m);
    malla.instanceMatrix.needsUpdate = true;
    const base = this.colorBase.get(e);
    if (base) base[indice] = tinte;
    if (e === 'caduco' || e === 'pino') {
      const t = this.troncos[e];
      t.count = Math.max(t.count, indice + 1);
      t.setMatrixAt(indice, _m);
      t.instanceMatrix.needsUpdate = true;
    }
    const planta: Planta = { especie: e, indice, matriz: _m.clone(), oculta: 0 };
    const c = this.cuadricula.mundoACelda(x, z);
    const k = this.cuadricula.indice(c.cx, c.cz);
    const lista = this.porCelda.get(k);
    if (lista) lista.push(planta);
    else this.porCelda.set(k, [planta]);
    return planta;
  }

  /** ¿Se puede plantar aquí? Ni agua, ni camino, ni puente, ni el claro inicial. */
  private libre(cxf: number, czf: number, margenRio: number, conClaro: boolean): boolean {
    const c = this.cuadricula;
    const p = c.paisaje;
    if (cxf < 0.2 || czf < 0.2 || cxf > c.n - 1.2 || czf > c.n - 1.2) return false;
    if (c.distRio(cxf, czf) < p.rio.anchura / 2 + margenRio) return false;
    if (c.distCaminoReal(cxf, czf) < 1.25) return false;
    if (c.enPuente(Math.round(cxf), Math.round(czf))) return false;
    if (conClaro && Math.hypot(cxf - p.claro.centro[0], czf - p.claro.centro[1]) < p.claro.radio) return false;
    return true;
  }

  private sembrar(): void {
    const c = this.cuadricula;
    const p = c.paisaje;
    const az = this.azar;
    const mundo = (cxf: number, czf: number) => c.celdaAMundo(cxf, czf);

    const arbol = (cxf: number, czf: number, pPino: number) => {
      if (!this.libre(cxf, czf, 1.6, true)) return;
      const { x, z } = mundo(cxf, czf);
      const esPino = fbm(cxf * 0.13 + 40, czf * 0.13 + 7, 2, 3) * 0.6 + az() * 0.4 < pPino;
      const esc = entre(az, 0.72, 1.3);
      this.poner(esPino ? 'pino' : 'caduco', x, z, [esc * entre(az, 0.9, 1.1), esc * entre(az, 0.9, 1.25), esc * entre(az, 0.9, 1.1)], az() * 6.28, az(), 0.05);
    };
    // Bosques del paisaje.
    for (const [bx, bz, radio, densidad] of p.bosques) {
      const paso = 1.35;
      for (let dz = -radio; dz <= radio; dz += paso) {
        for (let dx = -radio; dx <= radio; dx += paso) {
          const d = Math.hypot(dx, dz) / radio;
          if (d > 1) continue;
          if (az() > densidad * (1 - d * d * 0.55)) continue;
          arbol(bx + dx + (az() - 0.5) * paso * 0.9, bz + dz + (az() - 0.5) * paso * 0.9, 0.42);
        }
      }
    }
    // Arbolado suelto en las laderas del borde.
    for (let cz = 0; cz < c.n; cz += 2) {
      for (let cx = 0; cx < c.n; cx += 2) {
        const r = Math.max(Math.abs(cx - c.n / 2), Math.abs(cz - c.n / 2)) / (c.n / 2);
        if (r < 0.78 || az() > 0.42) continue;
        arbol(cx + az() * 2, cz + az() * 2, 0.55);
      }
    }
    // Arbustos: orlas de los bosques y manchas sueltas.
    for (let i = 0; i < 420; i++) {
      const cxf = az() * (c.n - 1);
      const czf = az() * (c.n - 1);
      const cercaBosque = p.bosques.some(([bx, bz, r]) => Math.abs(Math.hypot(cxf - bx, czf - bz) - r) < 2.2);
      if (!cercaBosque && az() > 0.22) continue;
      if (!this.libre(cxf, czf, 1.2, !cercaBosque && az() < 0.8)) continue;
      const { x, z } = mundo(cxf, czf);
      this.poner('arbusto', x, z, entre(az, 0.7, 1.5), az() * 6.28, az());
    }
    // Rocas: canchales del paisaje y pedruscos sueltos.
    for (const [rx, rz, radio, densidad] of p.rocas) {
      const n = Math.round(radio * radio * densidad * 2.2);
      for (let i = 0; i < n; i++) {
        const a = az() * 6.28;
        const d = Math.sqrt(az()) * radio;
        const cxf = rx + Math.cos(a) * d;
        const czf = rz + Math.sin(a) * d;
        if (!this.libre(cxf, czf, 0.9, false)) continue;
        const { x, z } = mundo(cxf, czf);
        const grande = az() < 0.35;
        const e = entre(az, 0.5, 1) * (grande ? 2.4 : 1);
        this.poner(az() < 0.6 ? 'roca' : 'pedrusco', x, z, [e, e * entre(az, 0.8, 1.9), e], az() * 6.28, az(), 0.15, -0.08 * e);
      }
    }
    for (let i = 0; i < 90; i++) {
      const cxf = az() * (c.n - 1);
      const czf = az() * (c.n - 1);
      if (!this.libre(cxf, czf, 0.2, false)) continue;
      const { x, z } = mundo(cxf, czf);
      this.poner('pedrusco', x, z, entre(az, 0.3, 0.8), az() * 6.28, az(), 0.2, -0.05);
    }
    // Piedras y juncos en el río y sus orillas.
    const medio = p.rio.anchura / 2;
    for (let i = 0; i < 1400; i++) {
      const cxf = az() * (c.n - 1);
      const czf = az() * (c.n - 1);
      const d = c.distRio(cxf, czf);
      if (d > medio + 1.2 || c.enPuente(Math.round(cxf), Math.round(czf)) || c.distCaminoReal(cxf, czf) < 1.2) continue;
      const { x, z } = mundo(cxf, czf);
      const h = this.altura(x, z);
      if (h > NIVEL_AGUA - 0.12 && h < NIVEL_AGUA + 0.35 && az() < 0.55) {
        this.poner('junco', x, z, entre(az, 0.7, 1.3), az() * 6.28, az(), 0.08);
      } else if (h < NIVEL_AGUA - 0.1 && d > medio - 0.9 && az() < 0.1) {
        const e = entre(az, 0.5, 1.1);
        this.poner('pedrusco', x, z, [e, e * 1.3, e], az() * 6.28, az(), 0.1, NIVEL_AGUA - h - 0.18 * e);
      }
    }
    // Matas de hierba y flores por todo el prado.
    for (let i = 0; i < 6500; i++) {
      const cxf = az() * (c.n - 1);
      const czf = az() * (c.n - 1);
      if (!this.libre(cxf, czf, 0.35, false)) continue;
      const mancha = fbm(cxf * 0.16, czf * 0.16, 2, 12);
      if (mancha < 0.4 && az() < 0.75) continue;
      const { x, z } = mundo(cxf, czf);
      const e = entre(az, 0.45, 0.95);
      this.poner('mata', x, z, [e * entre(az, 0.9, 1.4), e, e * entre(az, 0.9, 1.4)], az() * 6.28, az());
    }
    for (let i = 0; i < 2600; i++) {
      const cxf = az() * (c.n - 1);
      const czf = az() * (c.n - 1);
      if (!this.libre(cxf, czf, 0.5, false)) continue;
      if (fbm(cxf * 0.21 + 9, czf * 0.21 + 3, 2, 4) < 0.52) continue;
      const { x, z } = mundo(cxf, czf);
      this.poner('flor', x, z, entre(az, 0.8, 1.4), az() * 6.28, az());
    }
  }

  /** Cambia los colores a los de la estación. */
  fijarEstacion(paleta: PaletaEstacion): void {
    this.paleta = paleta;
    const pintar = (e: Especie, tonos: number[], claridad: [number, number]) => {
      const malla = this.mallas.get(e);
      const base = this.colorBase.get(e);
      if (!malla || !base) return;
      for (let i = 0; i < malla.count; i++) {
        const t = base[i];
        _c.setHex(tonos[Math.floor(t * tonos.length) % tonos.length]);
        _c.multiplyScalar(claridad[0] + (claridad[1] - claridad[0]) * ((t * 7.13) % 1));
        malla.setColorAt(i, _c);
      }
      if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
    };
    pintar('caduco', paleta.copas, [0.85, 1.12]);
    pintar('pino', paleta.pinos, [0.85, 1.1]);
    pintar('arbusto', [...paleta.copas.slice(0, 3), paleta.pinos[0]], [0.8, 1.05]);
    pintar('flor', paleta.floresColores, [0.95, 1.05]);
    pintar('junco', [0x8a9a4e, 0xa39a52, 0x7a8f4a], [0.85, 1.1]);
    pintar('roca', [0xffffff], [0.85, 1.05]);
    pintar('pedrusco', [0xa39c8f, 0x8f897d, 0xb3ab9c], [0.85, 1.1]);
    pintar('mata', [0xffffff], [0.8, 1.15]);
    // La textura de la mata es verde oliva: se lleva al tono de la estación.
    // (su color medio, en lineal, es 0,15 · 0,19 · 0,03), un punto más oscuro que el prado.
    this.matMata.color.setRGB((paleta.hierbaA.r / 0.15) * 0.8, (paleta.hierbaA.g / 0.19) * 0.8, (paleta.hierbaA.b / 0.03) * 0.8);
    const flores = this.mallas.get('flor');
    if (flores) flores.count = Math.round((this.cuentas.get('flor') ?? 0) * paleta.flores);
    // En invierno las copas quedan ralas.
    const copas = this.mallas.get('caduco');
    if (copas) {
      for (const lista of this.porCelda.values()) {
        for (const pl of lista) {
          if (pl.especie !== 'caduco' || pl.oculta > 0) continue;
          copas.setMatrixAt(pl.indice, this.matrizCopa(pl.matriz));
        }
      }
      copas.instanceMatrix.needsUpdate = true;
    }
  }

  private matrizCopa(m: THREE.Matrix4): THREE.Matrix4 {
    const k = this.paleta.copaEscala;
    if (k === 1) return m;
    // Encoge la copa hacia su centro (a unos 3 m del suelo) sin mover el tronco.
    m.decompose(_p, _q, _s);
    _p.y += 3 * _s.y * (1 - k);
    _s.multiplyScalar(k);
    return _m.compose(_p, _q, _s);
  }

  private mostrar(pl: Planta, visible: boolean): void {
    const malla = this.mallas.get(pl.especie);
    if (!malla) return;
    const m = visible ? (pl.especie === 'caduco' ? this.matrizCopa(pl.matriz.clone()) : pl.matriz) : CERO;
    malla.setMatrixAt(pl.indice, m);
    malla.instanceMatrix.needsUpdate = true;
    if (pl.especie === 'caduco' || pl.especie === 'pino') {
      const t = this.troncos[pl.especie];
      t.setMatrixAt(pl.indice, visible ? pl.matriz : CERO);
      t.instanceMatrix.needsUpdate = true;
    }
  }

  /** Oculta lo que crece dentro del rectángulo (huella de un edificio o una celda de camino). */
  despejar(id: string, r: Rect): void {
    const lista: Planta[] = [];
    for (let cz = r.cz; cz < r.cz + r.fondo; cz++) {
      for (let cx = r.cx; cx < r.cx + r.ancho; cx++) {
        if (!this.cuadricula.dentro(cx, cz)) continue;
        for (const pl of this.porCelda.get(this.cuadricula.indice(cx, cz)) ?? []) {
          pl.oculta++;
          if (pl.oculta === 1) this.mostrar(pl, false);
          lista.push(pl);
        }
      }
    }
    if (lista.length) this.ocultas.set(id, lista);
  }

  /** Devuelve lo que se ocultó con `despejar`. */
  restaurar(id: string): void {
    const lista = this.ocultas.get(id);
    if (!lista) return;
    for (const pl of lista) {
      pl.oculta = Math.max(0, pl.oculta - 1);
      if (pl.oculta === 0) this.mostrar(pl, true);
    }
    this.ocultas.delete(id);
  }

  /** Planta un árbol suelto (edificio «arbol» del catálogo). */
  plantar(x: number, z: number, semilla: number): ArbolPlantado | null {
    const az = crearAzar(semilla);
    const especie = az() < 0.8 ? 'caduco' : 'pino';
    const esc = entre(az, 0.85, 1.2);
    const pl = this.poner(especie, x, z, esc, az() * 6.28, az(), 0.04);
    if (!pl) return null;
    const malla = this.mallas.get(especie);
    const tonos = especie === 'caduco' ? this.paleta.copas : this.paleta.pinos;
    if (malla) {
      malla.setColorAt(pl.indice, _c.setHex(tonos[Math.floor(az() * tonos.length)]));
      if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
      if (especie === 'caduco') malla.setMatrixAt(pl.indice, this.matrizCopa(pl.matriz.clone()));
    }
    // Los árboles plantados no se registran por celda: los gestiona quien los plantó.
    const c = this.cuadricula.mundoACelda(x, z);
    const lista = this.porCelda.get(this.cuadricula.indice(c.cx, c.cz));
    if (lista) lista.splice(lista.indexOf(pl), 1);
    return { especie, indice: pl.indice };
  }

  talar(a: ArbolPlantado): void {
    const malla = this.mallas.get(a.especie);
    if (!malla) return;
    malla.setMatrixAt(a.indice, CERO);
    malla.instanceMatrix.needsUpdate = true;
    this.troncos[a.especie].setMatrixAt(a.indice, CERO);
    this.troncos[a.especie].instanceMatrix.needsUpdate = true;
    this.libres[a.especie].push(a.indice);
  }

  dispose(): void {
    for (const m of [...this.mallas.values(), ...Object.values(this.troncos)]) {
      if (!m.geometry.userData['compartida']) m.geometry.dispose();
      m.dispose();
    }
  }
}
