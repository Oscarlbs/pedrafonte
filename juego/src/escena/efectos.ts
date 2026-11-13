// Efectos: humo de chimeneas y hogueras, llamas, halos y charcos de luz de faroles y ventanas,
// unas pocas luces puntuales que parpadean, y el posprocesado (oclusión ambiental, resplandor,
// desenfoque de maqueta, viñeta y mapeo de tonos).
import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect, EffectComposer, EffectPass, KernelSize, RenderPass, SMAAEffect, SMAAPreset, TiltShiftEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { crearAzar } from '../util/azar';
import type { Ambiente } from './cielo';
import { texturaHalo } from './cielo';
import { GLOBALES } from './glsl';
import type { Marca } from './taller';

function cuadro(): { pos: THREE.BufferAttribute; uv: THREE.BufferAttribute; idx: number[] } {
  return {
    pos: new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    uv: new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
    idx: [0, 1, 2, 0, 2, 3],
  };
}

/** Penachos de partículas (humo o llamas) animados enteramente en la gráfica. */
class Penachos {
  readonly malla: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly porEmisor: number;
  private readonly max: number;
  private readonly origen: THREE.InstancedBufferAttribute;
  private readonly datos: THREE.InstancedBufferAttribute;
  readonly color = new THREE.Color(0xffffff);

  constructor(tipo: 'humo' | 'fuego', maxEmisores: number, porEmisor: number) {
    this.porEmisor = porEmisor;
    this.max = maxEmisores * porEmisor;
    const c = cuadro();
    this.geo.setAttribute('position', c.pos);
    this.geo.setAttribute('uv', c.uv);
    this.geo.setIndex(c.idx);
    this.origen = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.datos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    this.geo.setAttribute('origen', this.origen);
    this.geo.setAttribute('datos', this.datos);
    this.geo.instanceCount = 0;
    const humo = tipo === 'humo';
    const material = new THREE.ShaderMaterial({
      uniforms: { uTiempo: GLOBALES.uTiempo, uViento: GLOBALES.uViento, uColor: { value: this.color } },
      transparent: true,
      depthWrite: false,
      blending: humo ? THREE.NormalBlending : THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 origen;
        attribute vec2 datos;
        uniform float uTiempo;
        uniform float uViento;
        varying vec2 vUv;
        varying float vVida;
        varying float vAlfa;
        void main() {
          float semilla = datos.x;
          float fuerza = datos.y;
          vUv = uv;
          ${
            humo
              ? /* glsl */ `
          float vida = fract(uTiempo * (0.085 + 0.03 * fract(semilla * 5.7)) + semilla);
          vec3 p = origen;
          p.y += vida * (4.2 + 2.6 * fract(semilla * 7.3)) * sqrt(fuerza);
          float deriva = vida * vida * (1.2 + 5.0 * uViento);
          p.x += deriva + sin(semilla * 40.0 + uTiempo * 0.6) * 0.35 * vida;
          p.z += deriva * 0.35 + cos(semilla * 31.0 + uTiempo * 0.5) * 0.35 * vida;
          float tam = (0.3 + 1.5 * vida) * fuerza;
          vAlfa = smoothstep(0.0, 0.08, vida) * (1.0 - smoothstep(0.3, 1.0, vida)) * 0.3;`
              : /* glsl */ `
          float vida = fract(uTiempo * (0.75 + 0.5 * fract(semilla * 5.7)) + semilla);
          vec3 p = origen;
          float ang = semilla * 60.0;
          p.x += cos(ang) * 0.22 * fuerza * (1.0 - vida) + sin(uTiempo * 7.0 + semilla * 30.0) * 0.04;
          p.z += sin(ang) * 0.22 * fuerza * (1.0 - vida);
          p.y += vida * (0.9 + 0.7 * fract(semilla * 3.1)) * fuerza;
          float tam = (0.55 * (1.0 - vida) + 0.1) * fuerza;
          vAlfa = smoothstep(0.0, 0.08, vida) * (1.0 - vida);`
          }
          vVida = vida;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * tam;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vVida;
        varying float vAlfa;
        void main() {
          float d = length(vUv - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vAlfa;
          if (a < 0.004) discard;
          ${
            humo
              ? 'gl_FragColor = vec4(uColor * (0.8 + 0.25 * (1.0 - vVida)), a);'
              : 'vec3 c = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.32, 0.05), smoothstep(0.0, 0.7, vVida)); gl_FragColor = vec4(c * 1.6 * uColor, a);'
          }
        }`,
    });
    this.malla = new THREE.Mesh(this.geo, material);
    this.malla.frustumCulled = false;
    this.malla.renderOrder = humo ? 6 : 7;
    this.malla.name = tipo;
  }

  fijar(emisores: { pos: THREE.Vector3; valor: number }[]): void {
    const azar = crearAzar(99);
    let n = 0;
    for (const e of emisores) {
      for (let i = 0; i < this.porEmisor && n < this.max; i++, n++) {
        this.origen.setXYZ(n, e.pos.x, e.pos.y, e.pos.z);
        this.datos.setXY(n, (i + azar()) / this.porEmisor, e.valor);
      }
    }
    this.geo.instanceCount = n;
    this.origen.needsUpdate = true;
    this.datos.needsUpdate = true;
  }
}

/** Halos (de cara a la cámara) y charcos de luz (tumbados en el suelo), aditivos. */
class Destellos {
  readonly malla: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly centro: THREE.InstancedBufferAttribute;
  private readonly datos: THREE.InstancedBufferAttribute;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
    const c = cuadro();
    this.geo.setAttribute('position', c.pos);
    this.geo.setAttribute('uv', c.uv);
    this.geo.setIndex(c.idx);
    this.centro = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.datos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.geo.setAttribute('centro', this.centro);
    this.geo.setAttribute('datos', this.datos);
    this.geo.instanceCount = 0;
    this.malla = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: { uTiempo: GLOBALES.uTiempo, uLuces: GLOBALES.uLuces, uMapa: { value: texturaHalo() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 centro;
          attribute vec4 datos; // tamaño, tumbado (0/1), siempre encendido (0/1), fase
          uniform float uTiempo;
          uniform float uLuces;
          varying vec2 vUv;
          varying float vFuerza;
          void main() {
            vUv = uv;
            float titila = 0.86 + 0.14 * sin(uTiempo * (5.0 + datos.w * 4.0) + datos.w * 50.0) * sin(uTiempo * 2.3 + datos.w * 9.0);
            vFuerza = mix(uLuces, 0.35 + 0.65 * uLuces, datos.z) * titila;
            vec4 mv;
            if (datos.y > 0.5) {
              vec3 p = centro + vec3(position.x, 0.0, position.y) * datos.x * titila;
              mv = viewMatrix * vec4(p, 1.0);
            } else {
              mv = viewMatrix * vec4(centro, 1.0);
              mv.xy += position.xy * datos.x;
            }
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMapa;
          varying vec2 vUv;
          varying float vFuerza;
          void main() {
            float a = texture2D(uMapa, vUv).a * vFuerza;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vec3(1.0, 0.62, 0.26) * a, a);
          }`,
      }),
    );
    this.malla.frustumCulled = false;
    this.malla.renderOrder = 5;
    this.malla.name = 'destellos';
  }

  fijar(lista: { pos: THREE.Vector3; tam: number; tumbado: boolean; siempre: boolean }[]): void {
    const n = Math.min(lista.length, this.max);
    for (let i = 0; i < n; i++) {
      const d = lista[i];
      this.centro.setXYZ(i, d.pos.x, d.pos.y, d.pos.z);
      this.datos.setXYZW(i, d.tam, d.tumbado ? 1 : 0, d.siempre ? 1 : 0, (i * 0.618) % 1);
    }
    this.geo.instanceCount = n;
    this.centro.needsUpdate = true;
    this.datos.needsUpdate = true;
  }
}

interface MarcaMundo extends Marca {
  suelo: number;
}

const LUCES_REALES = 4;

export class Efectos {
  readonly grupo = new THREE.Group();
  private readonly humo = new Penachos('humo', 160, 16);
  private readonly fuego = new Penachos('fuego', 40, 16);
  private readonly destellos = new Destellos(600);
  private readonly porDueno = new Map<string, MarcaMundo[]>();
  private readonly luces: { luz: THREE.PointLight; marca: MarcaMundo | null; nivel: number }[] = [];
  private sucio = false;
  private tiempo = 0;

  constructor() {
    this.grupo.name = 'efectos';
    this.grupo.add(this.humo.malla, this.fuego.malla, this.destellos.malla);
    for (let i = 0; i < LUCES_REALES; i++) {
      const luz = new THREE.PointLight(0xff9a45, 0, 17, 1.4);
      luz.castShadow = false;
      this.grupo.add(luz);
      this.luces.push({ luz, marca: null, nivel: 0 });
    }
  }

  /** Apunta las marcas (ya en coordenadas de mundo) de un edificio. `suelo` es la altura del terreno bajo él. */
  registrar(id: string, marcas: Marca[], suelo: number): void {
    const utiles = marcas.filter((m) => m.tipo !== 'puerta').map((m) => ({ ...m, suelo }));
    if (!utiles.length) return;
    this.porDueno.set(id, utiles);
    this.sucio = true;
  }

  quitar(id: string): void {
    if (this.porDueno.delete(id)) this.sucio = true;
  }

  vaciar(): void {
    this.porDueno.clear();
    this.sucio = true;
  }

  private reconstruir(): void {
    const humos: { pos: THREE.Vector3; valor: number }[] = [];
    const fuegos: { pos: THREE.Vector3; valor: number }[] = [];
    const destellos: { pos: THREE.Vector3; tam: number; tumbado: boolean; siempre: boolean }[] = [];
    for (const lista of this.porDueno.values()) {
      for (const m of lista) {
        if (m.tipo === 'humo') humos.push({ pos: m.pos, valor: m.valor });
        else if (m.tipo === 'fuego') {
          fuegos.push({ pos: m.pos, valor: m.valor });
          destellos.push({ pos: m.pos.clone().setY(m.pos.y + 0.4), tam: 5.5 * m.valor, tumbado: false, siempre: true });
          destellos.push({ pos: new THREE.Vector3(m.pos.x, m.suelo + 0.12, m.pos.z), tam: 13 * m.valor, tumbado: true, siempre: true });
        } else if (m.tipo === 'luz') {
          destellos.push({ pos: m.pos, tam: 2.6 * m.valor, tumbado: false, siempre: false });
          destellos.push({ pos: new THREE.Vector3(m.pos.x, m.suelo + 0.1, m.pos.z), tam: 8.5 * m.valor, tumbado: true, siempre: false });
        }
      }
    }
    this.humo.fijar(humos);
    this.fuego.fijar(fuegos);
    this.destellos.fijar(destellos);
  }

  actualizar(dt: number, ambiente: Ambiente, objetivo: THREE.Vector3): void {
    this.tiempo += dt;
    if (this.sucio) {
      this.sucio = false;
      this.reconstruir();
    }
    // El humo toma el color de la luz del momento; de noche apenas se ve.
    this.humo.color.copy(ambiente.ambiente).multiplyScalar(0.95).addScalar(0.12 + 0.2 * ambiente.dia);
    this.fuego.color.setScalar(1);

    // Luces de verdad: las hogueras primero y luego los faroles más cercanos a donde mira la cámara.
    const candidatas: { m: MarcaMundo; peso: number }[] = [];
    for (const lista of this.porDueno.values()) {
      for (const m of lista) {
        if (m.tipo !== 'fuego' && m.tipo !== 'luz') continue;
        const d = m.pos.distanceTo(objetivo);
        candidatas.push({ m, peso: d - (m.tipo === 'fuego' ? 60 : 0) });
      }
    }
    candidatas.sort((a, b) => a.peso - b.peso);
    const elegidas = candidatas.slice(0, LUCES_REALES).map((c) => c.m);
    for (const l of this.luces) {
      if (l.marca && !elegidas.includes(l.marca)) {
        l.nivel -= dt * 3;
        if (l.nivel <= 0) l.marca = null;
      }
    }
    for (const m of elegidas) {
      if (this.luces.some((l) => l.marca === m)) continue;
      const libre = this.luces.find((l) => l.marca === null);
      if (libre) {
        libre.marca = m;
        libre.nivel = 0;
      }
    }
    for (let i = 0; i < this.luces.length; i++) {
      const l = this.luces[i];
      if (!l.marca) {
        l.luz.intensity = 0;
        continue;
      }
      if (elegidas.includes(l.marca)) l.nivel = Math.min(1, l.nivel + dt * 3);
      const fuego = l.marca.tipo === 'fuego';
      const t = this.tiempo * (fuego ? 9 : 4) + i * 3.7;
      const titila = 0.8 + 0.13 * Math.sin(t) + 0.07 * Math.sin(t * 2.7 + 1.3);
      const base = fuego ? 26 * (0.3 + 0.7 * ambiente.luces) : 12 * ambiente.luces;
      l.luz.intensity = base * l.marca.valor * titila * l.nivel;
      l.luz.position.copy(l.marca.pos);
      if (fuego) l.luz.position.y += 0.7;
      l.luz.color.setHex(fuego ? 0xff8a3a : 0xffb060);
    }
  }
}

/** Cadena de posprocesado. Si la gráfica no da para tanto, se puede ir apagando por partes. */
export class Posproceso {
  readonly compositor: EffectComposer;
  private readonly ao: N8AOPostPass;
  private readonly desenfoque: TiltShiftEffect;
  private readonly resplandor: BloomEffect;

  constructor(renderer: THREE.WebGLRenderer, escena: THREE.Scene, camara: THREE.PerspectiveCamera) {
    this.compositor = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.compositor.addPass(new RenderPass(escena, camara));

    this.ao = new N8AOPostPass(escena, camara);
    this.ao.configuration.aoRadius = 1.6;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.intensity = 2.6;
    this.ao.configuration.color = new THREE.Color(0x1c1a2e);
    this.ao.configuration.halfRes = true;
    this.ao.configuration.depthAwareUpsampling = true;
    this.ao.configuration.gammaCorrection = false;
    this.ao.setQualityMode('Low');
    this.compositor.addPass(this.ao);

    this.resplandor = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.25, intensity: 0.75, radius: 0.72, levels: 6 });
    this.desenfoque = new TiltShiftEffect({ offset: 0.03, focusArea: 0.62, feather: 0.42, kernelSize: KernelSize.SMALL, resolutionScale: 0.5 });
    const tonos = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    const vineta = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.compositor.addPass(new EffectPass(camara, this.resplandor));
    this.compositor.addPass(new EffectPass(camara, this.desenfoque, vineta, tonos));
    this.compositor.addPass(new EffectPass(camara, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  }

  /** De noche las luces deben resplandecer más. */
  ajustar(ambiente: Ambiente): void {
    this.resplandor.intensity = 0.55 + 0.75 * ambiente.luces;
  }

  tamano(ancho: number, alto: number): void {
    this.compositor.setSize(ancho, alto);
  }

  dibujar(dt: number): void {
    this.compositor.render(dt);
  }

  dispose(): void {
    this.compositor.dispose();
  }
}
