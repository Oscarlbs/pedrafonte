// El valle-maqueta: campo de alturas generado desde paisajes.yaml, suelo pintado (hierba, camino,
// labrado, lecho del río) y la base flotante de tierra y roca que lo sostiene en el aire.
import * as THREE from 'three';
import type { Par } from '../datos';
import type { Cuadricula } from '../juego/cuadricula';
import { fbm, mezcla, ruido2, suave } from '../util/azar';
import { GLOBALES, RUIDO_GLSL } from './glsl';
import type { PaletaEstacion } from './paleta';

/** Altura de la lámina de agua del río, en metros. */
export const NIVEL_AGUA = -0.38;

export interface Rect {
  cx: number;
  cz: number;
  ancho: number;
  fondo: number;
}

/** Lo que el suelo debe pintar además de la hierba. Todo en celdas. */
export interface CapasSuelo {
  caminos: Par[];
  cultivos: Rect[];
  pisados: Rect[];
}

const PX_CELDA = 12;
const SUBDIVISION = 3;

export class Terreno {
  readonly grupo = new THREE.Group();
  readonly malla: THREE.Mesh;
  private readonly cuadricula: Cuadricula;
  private readonly res: number;
  private readonly alturas: Float32Array;
  private readonly lienzo: HTMLCanvasElement;
  private readonly mascara: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniformes: Record<string, THREE.IUniform>;
  private capas: CapasSuelo = { caminos: [], cultivos: [], pisados: [] };
  private mascaraSucia = true;
  private readonly caz: { rueda: Par; toma: Par };
  /** Color del agua en el corte y la cascada (lo tiñe el cielo). */
  readonly colorCascada: THREE.IUniform<THREE.Color> = { value: new THREE.Color(0x5fa3ad) };

  constructor(cuadricula: Cuadricula, hierba: THREE.Texture) {
    this.cuadricula = cuadricula;
    const n = cuadricula.n;
    const sitio = cuadricula.sitioMolino();
    this.caz = { rueda: sitio.rueda, toma: sitio.toma };
    this.res = n * SUBDIVISION + 1;
    this.alturas = new Float32Array(this.res * this.res);
    this.calcularAlturas();

    this.lienzo = document.createElement('canvas');
    this.lienzo.width = this.lienzo.height = n * PX_CELDA;
    this.mascara = new THREE.CanvasTexture(this.lienzo);
    this.mascara.flipY = false;
    this.mascara.colorSpace = THREE.NoColorSpace;
    this.mascara.generateMipmaps = false;
    this.mascara.minFilter = THREE.LinearFilter;

    hierba.wrapS = hierba.wrapT = THREE.RepeatWrapping;
    hierba.colorSpace = THREE.SRGBColorSpace;
    hierba.anisotropy = 4;

    this.uniformes = {
      uMascara: { value: this.mascara },
      uHierba: { value: hierba },
      uLado: { value: cuadricula.mitad * 2 },
      uNivelAgua: { value: NIVEL_AGUA },
      uHierbaA: { value: new THREE.Color(0x869443) },
      uHierbaB: { value: new THREE.Color(0xa99f4c) },
      uFlores: { value: 0.2 },
      uRoca: { value: new THREE.Color(0x8d8474) },
      uTierra: { value: new THREE.Color(0x9a7a52) },
      uLabrado: { value: new THREE.Color(0x6e4f33) },
      uCamino: { value: new THREE.Color(0xc09a66) },
      uArena: { value: new THREE.Color(0xb8a57a) },
      uNieve: GLOBALES.uNieve,
      uLluvia: GLOBALES.uLluvia,
    };

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPosM;\nvarying vec3 vNormalM;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvPosM = (modelMatrix * vec4(position, 1.0)).xyz;\nvNormalM = normalize(mat3(modelMatrix) * normal);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vPosM;
          varying vec3 vNormalM;
          uniform sampler2D uMascara;
          uniform sampler2D uHierba;
          uniform float uLado;
          uniform float uNivelAgua;
          uniform vec3 uHierbaA;
          uniform vec3 uHierbaB;
          uniform float uFlores;
          uniform vec3 uRoca;
          uniform vec3 uTierra;
          uniform vec3 uLabrado;
          uniform vec3 uCamino;
          uniform vec3 uArena;
          uniform float uNieve;
          uniform float uLluvia;
          ${RUIDO_GLSL}`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          vec2 pxz = vPosM.xz;
          vec4 capas = texture2D(uMascara, pxz / uLado + 0.5);
          vec3 tex = texture2D(uHierba, pxz * 0.085).rgb;
          float gris = dot(tex, vec3(0.3, 0.55, 0.15));
          float flor = smoothstep(0.45, 0.8, tex.b) * uFlores;
          float n1 = aldeaFbm(pxz * 0.045);
          float n2 = aldeaRuido(pxz * 0.9);
          float n3 = aldeaRuido(pxz * 3.7);
          vec3 hierba = mix(uHierbaA, uHierbaB, smoothstep(0.3, 0.7, n1));
          hierba *= (0.7 + 0.95 * gris) * (0.92 + 0.16 * n2);
          hierba = mix(hierba, vec3(0.95, 0.94, 0.86), flor);
          vec3 normalM = normalize(vNormalM);
          float pend = 1.0 - normalM.y;
          vec3 roca = uRoca * (0.82 + 0.3 * n2);
          vec3 col = mix(hierba, roca, smoothstep(0.2, 0.4, pend + (n3 - 0.5) * 0.1));
          float pis = smoothstep(0.3, 0.75, capas.b + (n2 - 0.5) * 0.5);
          col = mix(col, uTierra * (0.88 + 0.24 * n3), pis * 0.7);
          float cul = smoothstep(0.4, 0.6, capas.g + (n2 - 0.5) * 0.15);
          float surco = 0.8 + 0.2 * sin(pxz.x * 7.854);
          col = mix(col, uLabrado * surco * (0.9 + 0.2 * n3), cul);
          float cam = smoothstep(0.34, 0.6, capas.r + (n2 - 0.5) * 0.45);
          vec3 camino = uCamino * (0.84 + 0.2 * n2 + 0.12 * n3);
          col = mix(col, camino, cam);
          float bajo = smoothstep(uNivelAgua + 0.42, uNivelAgua + 0.06, vPosM.y);
          vec3 arena = mix(uArena, uArena * vec3(0.42, 0.5, 0.45), smoothstep(uNivelAgua, uNivelAgua - 0.9, vPosM.y));
          col = mix(col, arena * (0.88 + 0.24 * n3), bajo);
          float nv = uNieve * smoothstep(0.5, 0.9, normalM.y) * (0.75 + 0.35 * n2) * (1.0 - 0.45 * cam) * (1.0 - bajo);
          col = mix(col, vec3(0.9, 0.93, 0.98), clamp(nv, 0.0, 1.0));
          col *= 1.0 - 0.2 * uLluvia;
          diffuseColor.rgb = col;
          `,
        );
    };
    this.material.customProgramCacheKey = () => 'aldea-terreno';

    this.malla = new THREE.Mesh(this.geometriaSuelo(), this.material);
    this.malla.receiveShadow = true;
    this.malla.name = 'terreno';
    this.grupo.add(this.malla);
    this.grupo.add(this.crearBase());
    const cascada = this.crearCascada();
    if (cascada) this.grupo.add(cascada);
  }

  /** Altura sin malla de por medio: de aquí sale todo el relieve. */
  private alturaCruda(x: number, z: number): number {
    const c = this.cuadricula;
    const p = c.paisaje;
    const { cx, cz } = c.mundoACeldaReal(x, z);
    const dRio = c.distRio(cx, cz);
    const dCam = c.distCaminoReal(cx, cz);
    const medio = p.rio.anchura / 2;
    const rx = Math.abs(x) / c.mitad;
    const rz = Math.abs(z) / c.mitad;
    // Entre cuadrado y círculo: las laderas redondean las esquinas del valle.
    const r = mezcla(Math.max(rx, rz), Math.hypot(rx, rz) / 1.12, 0.45);

    let ladera = p.relieve.borde * Math.pow(suave(0.56, 1.03, r), 1.45);
    ladera *= 0.7 + 0.6 * fbm(x * 0.028 + 3.1, z * 0.028 + 9.7, 3, 11);
    // El río y el camino entran y salen por collados: junto a ellos la ladera se allana.
    ladera *= mezcla(0.06, 1, suave(medio + 1.5, medio + 11, dRio));
    ladera *= mezcla(0.28, 1, suave(0.8, 7, dCam));

    const centro = 1 - suave(0.3, 0.8, r);
    let ond = (fbm(x * 0.045 + 7.3, z * 0.045 + 2.9, 3, 5) - 0.5) * 2 * p.relieve.ondulacion;
    ond *= mezcla(1, 0.4, centro) * mezcla(0.3, 1, suave(0.5, 4, dCam));

    let h = 0.3 + ladera + ond;
    // Vega llana junto al río y cauce hundido.
    h = mezcla(h, 0.16, suave(medio + 5, medio + 1, dRio));
    // La orilla del agua cae justo por dentro de anchura/2: así ninguna celda que el contrato da por
    // «orilla» se ve mojada.
    const dentro = suave(medio + 0.55, medio - 0.85, dRio);
    const fondo = p.relieve.cauce * (0.55 + 0.45 * suave(medio - 0.5, 0, dRio));
    h = mezcla(h, fondo + (ruido2(x * 0.7, z * 0.7, 3) - 0.5) * 0.18, dentro);
    // Caz del molino: un canal corto que lleva el agua del río hasta donde gira la rueda.
    const { rueda, toma } = this.caz;
    const vx = toma[0] - rueda[0];
    const vz = toma[1] - rueda[1];
    const t = Math.min(1, Math.max(0, ((cx - rueda[0]) * vx + (cz - rueda[1]) * vz) / (vx * vx + vz * vz || 1)));
    const dCaz = Math.hypot(cx - (rueda[0] + vx * t), cz - (rueda[1] + vz * t));
    return mezcla(h, Math.min(h, NIVEL_AGUA - 0.4), suave(0.95, 0.4, dCaz));
  }

  private calcularAlturas(): void {
    const { res, alturas } = this;
    const lado = this.cuadricula.mitad * 2;
    for (let j = 0; j < res; j++) {
      const z = (j / (res - 1) - 0.5) * lado;
      for (let i = 0; i < res; i++) {
        const x = (i / (res - 1) - 0.5) * lado;
        alturas[j * res + i] = this.alturaCruda(x, z);
      }
    }
  }

  /** Altura del suelo en metros (interpolada sobre la malla). Fuera del valle devuelve el borde. */
  alturaEn(x: number, z: number): number {
    const { res, alturas } = this;
    const lado = this.cuadricula.mitad * 2;
    const fx = Math.min(res - 1.001, Math.max(0, (x / lado + 0.5) * (res - 1)));
    const fz = Math.min(res - 1.001, Math.max(0, (z / lado + 0.5) * (res - 1)));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = alturas[j * res + i];
    const b = alturas[j * res + i + 1];
    const c = alturas[(j + 1) * res + i];
    const d = alturas[(j + 1) * res + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  private geometriaSuelo(): THREE.BufferGeometry {
    const { res, alturas } = this;
    const lado = this.cuadricula.mitad * 2;
    const pos = new Float32Array(res * res * 3);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = (j * res + i) * 3;
        pos[k] = (i / (res - 1) - 0.5) * lado;
        pos[k + 1] = alturas[j * res + i];
        pos[k + 2] = (j / (res - 1) - 0.5) * lado;
      }
    }
    const indices = new Uint32Array((res - 1) * (res - 1) * 6);
    let q = 0;
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = j * res + i;
        const b = a + 1;
        const c = a + res;
        const d = c + 1;
        indices[q++] = a;
        indices[q++] = c;
        indices[q++] = b;
        indices[q++] = b;
        indices[q++] = c;
        indices[q++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    return g;
  }

  /** Columnas del borde del valle, en orden, recorriendo los cuatro lados. */
  private borde(): { x: number; z: number }[] {
    const mitad = this.cuadricula.mitad;
    const porLado = Math.round(mitad * 2);
    const columnas: { x: number; z: number }[] = [];
    for (let i = 0; i < porLado; i++) columnas.push({ x: -mitad + i, z: -mitad });
    for (let i = 0; i < porLado; i++) columnas.push({ x: mitad, z: -mitad + i });
    for (let i = 0; i < porLado; i++) columnas.push({ x: mitad - i, z: mitad });
    for (let i = 0; i < porLado; i++) columnas.push({ x: -mitad, z: mitad - i });
    return columnas;
  }

  /** Bloque de tierra y roca bajo el valle: un faldón que sigue el perfil del terreno y acaba en punta. */
  private crearBase(): THREE.Mesh {
    const columnas = this.borde();
    const FILAS = 16;
    const nCol = columnas.length;
    const pos = new Float32Array(nCol * FILAS * 3);
    const col = new Float32Array(nCol * FILAS * 3);
    const tierra = new THREE.Color(0x94693f);
    const tierraOscura = new THREE.Color(0x6e4e32);
    const roca = new THREE.Color(0xa89e8c);
    const rocaOscura = new THREE.Color(0x6f685d);
    const tmp = new THREE.Color();
    const PROFUNDIDAD = 31;

    for (let c = 0; c < nCol; c++) {
      const { x, z } = columnas[c];
      const h = this.alturaEn(x, z);
      const r1 = ruido2(c * 0.21, 1.7, 7);
      const r2 = ruido2(c * 0.07, 5.1, 9);
      for (let f = 0; f < FILAS; f++) {
        let px = x;
        let py: number;
        let pz = z;
        if (f === 0) {
          py = h;
          tmp.copy(tierra);
        } else if (f === 1) {
          py = h - 0.7 - r1 * 0.4;
          tmp.copy(tierraOscura);
        } else if (f === 2) {
          // Capa de tierra y, debajo, roca. Hasta la fila 3 la pared cae a plomo: así la lámina de
          // agua nunca asoma por el canto.
          py = h - 1.7 - r1 * 0.9;
          tmp.copy(roca).lerp(tierraOscura, 0.35);
        } else if (f === 3) {
          py = Math.min(h - 3.4, -2.6) - r2 * 1.4;
          tmp.copy(roca).lerp(rocaOscura, 0.25 + r1 * 0.35);
        } else {
          // Roca que se va cerrando en punta, con vetas horizontales.
          const d = (f - 3) / (FILAS - 4);
          const mella = 1 - 0.06 * d * ruido2(c * 0.16, f * 0.9, 4);
          const k = (1 - 0.99 * Math.pow(d, 2.2)) * mella;
          px = x * k;
          pz = z * k;
          const bulto = 0.7 + 0.6 * fbm(px * 0.05 + 20, pz * 0.05 + 40, 3, 21);
          py = Math.min(h - 3.4, -2.6) - r2 * 1.4 - PROFUNDIDAD * Math.pow(d, 0.85) * bulto;
          const veta = 0.5 + 0.5 * Math.sin(py * 0.8 + r2 * 4 + ruido2(c * 0.05, py * 0.2, 6) * 3);
          tmp.copy(roca).lerp(rocaOscura, Math.min(1, d * 0.6 + veta * 0.45));
          tmp.multiplyScalar(0.86 + 0.28 * ruido2(c * 0.5, f * 2.1, 2));
        }
        const k3 = (c * FILAS + f) * 3;
        pos[k3] = px;
        pos[k3 + 1] = py;
        pos[k3 + 2] = pz;
        col[k3] = tmp.r;
        col[k3 + 1] = tmp.g;
        col[k3 + 2] = tmp.b;
      }
    }
    const indices: number[] = [];
    for (let c = 0; c < nCol; c++) {
      const c2 = (c + 1) % nCol;
      for (let f = 0; f < FILAS - 1; f++) {
        const a = c * FILAS + f;
        const b = c2 * FILAS + f;
        const d = c * FILAS + f + 1;
        const e = c2 * FILAS + f + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide });
    const base = new THREE.Mesh(g, material);
    base.name = 'base';
    return base;
  }

  /**
   * Corte del río en el borde de la maqueta: una cara de agua donde el cauce toca el canto y, por
   * donde el río sale del valle, una cascada que cae al vacío.
   */
  private crearCascada(): THREE.Mesh | null {
    const c = this.cuadricula;
    const columnas = this.borde();
    const puntos = c.paisaje.rio.puntos;
    const fin = puntos[puntos.length - 1];
    const pos: number[] = [];
    const uv: number[] = [];
    const caida: number[] = [];
    const idx: number[] = [];
    const ALTO = 26;
    for (let i = 0; i < columnas.length; i++) {
      const a = columnas[i];
      const b = columnas[(i + 1) % columnas.length];
      const ha = this.alturaEn(a.x, a.z);
      const hb = this.alturaEn(b.x, b.z);
      if (ha > NIVEL_AGUA && hb > NIVEL_AGUA) continue;
      // ¿Es la salida del río? (el final de la polilínea).
      const celda = c.mundoACeldaReal(a.x, a.z);
      const salida = Math.hypot(celda.cx - fin[0], celda.cz - fin[1]) < c.n * 0.3;
      const fuera = 1.003;
      const base = pos.length / 3;
      // Cara del corte: del lecho a la lámina de agua.
      pos.push(a.x * fuera, Math.min(ha, NIVEL_AGUA), a.z * fuera, b.x * fuera, Math.min(hb, NIVEL_AGUA), b.z * fuera, b.x * fuera, NIVEL_AGUA, b.z * fuera, a.x * fuera, NIVEL_AGUA, a.z * fuera);
      uv.push(i, 0, i + 1, 0, i + 1, 0, i, 0);
      caida.push(0, 0, 0, 0);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      if (salida) {
        const lejos = 1.012;
        const b2 = pos.length / 3;
        pos.push(a.x * lejos, NIVEL_AGUA - ALTO, a.z * lejos, b.x * lejos, NIVEL_AGUA - ALTO, b.z * lejos, b.x * fuera, NIVEL_AGUA, b.z * fuera, a.x * fuera, NIVEL_AGUA, a.z * fuera);
        uv.push(i, 1, i + 1, 1, i + 1, 0, i, 0);
        caida.push(1, 1, 1, 1);
        idx.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('caida', new THREE.Float32BufferAttribute(caida, 1));
    g.setIndex(idx);
    const material = new THREE.ShaderMaterial({
      uniforms: { uTiempo: GLOBALES.uTiempo, uColor: this.colorCascada, uAlto: { value: ALTO } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float caida;
        varying vec2 vUv;
        varying float vCaida;
        void main() {
          vUv = uv;
          vCaida = caida;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTiempo;
        uniform vec3 uColor;
        uniform float uAlto;
        varying vec2 vUv;
        varying float vCaida;
        ${RUIDO_GLSL}
        void main() {
          if (vCaida < 0.5) {
            gl_FragColor = vec4(uColor * 0.8, 0.92);
            return;
          }
          float y = vUv.y * uAlto;
          float hilos = aldeaRuido(vec2(vUv.x * 2.6, y * 0.35 - uTiempo * 2.6)) * 0.6 + aldeaRuido(vec2(vUv.x * 7.0, y * 0.8 - uTiempo * 4.0)) * 0.4;
          vec3 c = mix(uColor, vec3(1.0), smoothstep(0.35, 0.75, hilos) * 0.85 + 0.1);
          // La cascada se deshace en bruma según cae.
          float a = (1.0 - smoothstep(0.25, 1.0, vUv.y)) * (0.55 + 0.45 * hilos);
          gl_FragColor = vec4(c, a);
        }`,
    });
    const malla = new THREE.Mesh(g, material);
    malla.name = 'cascada';
    malla.renderOrder = 2;
    return malla;
  }

  fijarCapas(capas: CapasSuelo): void {
    this.capas = capas;
    this.mascaraSucia = true;
  }

  fijarEstacion(paleta: PaletaEstacion): void {
    (this.uniformes.uHierbaA.value as THREE.Color).copy(paleta.hierbaA);
    (this.uniformes.uHierbaB.value as THREE.Color).copy(paleta.hierbaB);
    this.uniformes.uFlores.value = paleta.flores;
  }

  /** Repinta la máscara del suelo si ha cambiado algo. Se llama una vez por fotograma. */
  actualizar(): void {
    if (!this.mascaraSucia) return;
    this.mascaraSucia = false;
    this.pintarMascara();
  }

  private pintarMascara(): void {
    const ctx = this.lienzo.getContext('2d');
    if (!ctx) return;
    const c = this.cuadricula;
    const P = PX_CELDA;
    const px = (v: number) => (v + 0.5) * P;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.lienzo.width, this.lienzo.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = `blur(${Math.round(P * 0.28)}px)`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Rojo: caminos. Primero el camino real del paisaje, como trazo suave.
    ctx.strokeStyle = 'rgb(255,0,0)';
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.lineWidth = P * 1.25;
    for (const tramo of c.paisaje.camino) {
      if (tramo.length < 2) continue;
      // Los extremos que tocan el borde se alargan para que el camino salga del valle.
      const pts = tramo.map(([x, z]) => {
        const fuera = (v: number) => (v <= 0 ? -1.5 : v >= c.n - 1 ? c.n + 0.5 : v);
        return [px(fuera(x)), px(fuera(z))] as Par;
      });
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const mz = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, mz);
      }
      const fin = pts[pts.length - 1];
      ctx.lineTo(fin[0], fin[1]);
      ctx.stroke();
    }
    // Después las celdas de camino puestas, enlazadas con sus vecinas.
    const puestas = new Set(this.capas.caminos.map(([x, z]) => `${x},${z}`));
    ctx.lineWidth = P * 1.05;
    for (const [x, z] of this.capas.caminos) {
      ctx.beginPath();
      ctx.arc(px(x), px(z), P * 0.56, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        if (puestas.has(`${x + dx},${z + dz}`) || c.esCamino(x + dx, z + dz)) {
          ctx.beginPath();
          ctx.moveTo(px(x), px(z));
          ctx.lineTo(px(x + dx), px(z + dz));
          ctx.stroke();
        }
      }
    }

    // Verde: tierra labrada. Azul: suelo pisado alrededor de las casas.
    const rect = (r: Rect, margen: number, radio: number) => {
      ctx.beginPath();
      ctx.roundRect((r.cx - margen) * P, (r.cz - margen) * P, (r.ancho + margen * 2) * P, (r.fondo + margen * 2) * P, radio * P);
      ctx.fill();
    };
    ctx.fillStyle = 'rgb(0,255,0)';
    for (const r of this.capas.cultivos) rect(r, -0.12, 0.3);
    ctx.fillStyle = 'rgb(0,0,200)';
    for (const r of this.capas.pisados) rect(r, 0.1, 0.9);

    ctx.filter = 'none';
    this.mascara.needsUpdate = true;
  }

  dispose(): void {
    this.malla.geometry.dispose();
    this.material.dispose();
    this.mascara.dispose();
    this.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.malla) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
