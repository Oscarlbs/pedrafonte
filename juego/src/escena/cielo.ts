// Cielo y luz: cúpula con degradado, sol, luna con su fase, estrellas y nubes; y la iluminación de
// la escena (una sola luz con sombras, que es el sol de día y la luna de noche).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { crearAzar, entre, limitar, mezcla, ruido2, suave } from '../util/azar';
import type { Astros } from './astros';
import type { EstadoClima } from './clima';
import { GLOBALES } from './glsl';

const col = (hex: number) => new THREE.Color(hex);
const NOCHE_CENIT = col(0x0a1230);
const NOCHE_HORIZONTE = col(0x1d2c50);
const DIA_CENIT = col(0x3d86dc);
const DIA_HORIZONTE = col(0xc4e2f6);
const DORADO_CENIT = col(0x6f7fb5);
const DORADO_HORIZONTE = col(0xf6b877);
const GRIS_DIA = col(0xaab2ba);
const GRIS_NOCHE = col(0x222a38);
const NIEBLA_DIA = col(0xd9dde0);
const SOL_BAJO = col(0xffb273);
const SOL_ALTO = col(0xfff0d8);
const LUNA = col(0x9fb6ee);
const SUELO_DIA = col(0x9a8a62);
const SUELO_NOCHE = col(0x232c48);
const AMBIENTE_NOCHE = col(0x4d63a6);

/** Resumen de la luz del momento, para quien lo necesite (efectos, clima, interfaz). */
export interface Ambiente {
  /** 0 noche cerrada – 1 pleno día. */
  dia: number;
  /** 0–1: hora dorada. */
  dorado: number;
  /** 0–1: ventanas y faroles encendidos. */
  luces: number;
  horizonte: THREE.Color;
  /** Color medio de la luz ambiente (para teñir humo y partículas). */
  ambiente: THREE.Color;
}

function geoNube(semilla: number): THREE.BufferGeometry {
  const azar = crearAzar(semilla);
  const partes: THREE.BufferGeometry[] = [];
  const n = 4 + Math.floor(azar() * 3);
  for (let i = 0; i < n; i++) {
    const r = entre(azar, 5, 10);
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const f = 1 + (ruido2(p.getX(k) * 0.3 + i, p.getZ(k) * 0.3 + p.getY(k) * 0.2, semilla) - 0.5) * 0.35;
      p.setXYZ(k, p.getX(k) * f, Math.max(-r * 0.25, p.getY(k) * 0.55 * f), p.getZ(k) * f);
    }
    g.translate((i - n / 2) * 7 + entre(azar, -2, 2), entre(azar, -1.5, 2.5), entre(azar, -4, 4));
    partes.push(g);
  }
  const g = mergeGeometries(partes);
  g.computeVertexNormals();
  return g;
}

export class Cielo {
  readonly grupo = new THREE.Group();
  /** Lo que debe ir pegado a la cámara (cúpula, luna, estrellas). */
  readonly fondo = new THREE.Group();
  readonly luz: THREE.DirectionalLight;
  readonly hemisferio: THREE.HemisphereLight;
  readonly niebla = new THREE.Fog(0xcfe5f3, 150, 600);
  readonly ambiente: Ambiente = { dia: 1, dorado: 0, luces: 0, horizonte: new THREE.Color(), ambiente: new THREE.Color() };
  private readonly uniCielo: Record<string, THREE.IUniform>;
  private readonly luna: THREE.Mesh;
  private readonly uniLuna: { uSol: THREE.IUniform<THREE.Vector3>; uBrillo: THREE.IUniform<number> };
  private readonly haloLuna: THREE.Sprite;
  private readonly estrellas: THREE.Points;
  private readonly nubes: THREE.InstancedMesh[] = [];
  private readonly datosNubes: { x: number; y: number; z: number; esc: number; giro: number; malla: number; indice: number; orden: number }[] = [];
  private readonly matNube: THREE.MeshStandardMaterial;
  private readonly dirLuz = new THREE.Vector3(0.4, 0.8, 0.4);
  private relampago = 0;
  private proximoRayo = 6;
  private radioSombra = 0;
  /** Los relámpagos se pueden apagar (capturas). */
  rayos = true;

  constructor() {
    this.grupo.name = 'cielo';
    this.uniCielo = {
      uCenit: { value: new THREE.Color() },
      uHorizonte: { value: new THREE.Color() },
      uAbismo: { value: new THREE.Color() },
      uSolDir: { value: new THREE.Vector3(0, 1, 0) },
      uSolColor: { value: new THREE.Color() },
      uSolVisible: { value: 1 },
      uResplandor: { value: new THREE.Color(0xff9a55) },
      uDorado: { value: 0 },
    };
    const cupula = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: this.uniCielo,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          uniform vec3 uCenit;
          uniform vec3 uHorizonte;
          uniform vec3 uAbismo;
          uniform vec3 uSolDir;
          uniform vec3 uSolColor;
          uniform float uSolVisible;
          uniform vec3 uResplandor;
          uniform float uDorado;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 c = mix(uHorizonte, uCenit, pow(clamp(h, 0.0, 1.0), 0.5));
            c = mix(c, uAbismo, smoothstep(0.0, -0.85, h));
            float s = max(dot(d, uSolDir), 0.0);
            c = mix(c, uResplandor, pow(s, 4.0) * uDorado * (1.0 - smoothstep(0.0, 0.55, abs(h))));
            c += uSolColor * (pow(s, 900.0) * 8.0 + pow(s, 60.0) * 0.4 + pow(s, 8.0) * 0.1) * uSolVisible;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    cupula.renderOrder = -10;
    cupula.frustumCulled = false;
    this.fondo.add(cupula);

    // Luna: una esfera con la fase que le da la dirección real del sol.
    this.uniLuna = { uSol: { value: new THREE.Vector3(1, 0, 0) }, uBrillo: { value: 1 } };
    this.luna = new THREE.Mesh(
      new THREE.SphereGeometry(34, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniLuna,
        depthWrite: false,
        fog: false,
        transparent: true,
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vP;
          void main() {
            vN = normalize(mat3(modelMatrix) * normal);
            vP = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vP;
          uniform vec3 uSol;
          uniform float uBrillo;
          void main() {
            float l = smoothstep(-0.08, 0.2, dot(normalize(vN), uSol));
            float mares = 0.86 + 0.14 * sin(vP.x * 0.21) * sin(vP.y * 0.17 + 1.3) * sin(vP.z * 0.19);
            vec3 c = mix(vec3(0.06, 0.08, 0.14), vec3(1.25, 1.2, 1.05) * mares, l);
            gl_FragColor = vec4(c * uBrillo, mix(0.35, 1.0, l) * uBrillo);
          }`,
      }),
    );
    this.luna.renderOrder = -8;
    this.fondo.add(this.luna);
    this.haloLuna = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texturaHalo(), color: 0xaec4ff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
    );
    this.haloLuna.scale.setScalar(340);
    this.haloLuna.renderOrder = -9;
    this.fondo.add(this.haloLuna);

    // Estrellas.
    const azar = crearAzar(1234);
    const N = 1600;
    const pos = new Float32Array(N * 3);
    const brillo = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = azar() * 2 - 0.35;
      const y = Math.min(1, Math.max(-0.35, u));
      const a = azar() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 1400, y * 1400, Math.sin(a) * r * 1400], i * 3);
      const b = Math.pow(azar(), 2.2) * 0.9 + 0.1;
      brillo.set([b, b, b * entre(azar, 0.85, 1.15)], i * 3);
    }
    const ge = new THREE.BufferGeometry();
    ge.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ge.setAttribute('color', new THREE.BufferAttribute(brillo, 3));
    this.estrellas = new THREE.Points(
      ge,
      new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, opacity: 0 }),
    );
    this.estrellas.renderOrder = -9;
    this.estrellas.frustumCulled = false;
    this.fondo.add(this.estrellas);
    this.grupo.add(this.fondo);

    // Nubes: bancos algodonosos alrededor y por debajo de la maqueta, y un techo cuando se cubre.
    this.matNube = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, fog: false, emissive: 0x8fa3c0, emissiveIntensity: 0.25 });
    const porMalla = 24;
    for (let m = 0; m < 3; m++) {
      const malla = new THREE.InstancedMesh(geoNube(50 + m * 13), this.matNube, porMalla);
      malla.frustumCulled = false;
      malla.castShadow = false;
      malla.receiveShadow = false;
      this.nubes.push(malla);
      this.grupo.add(malla);
      for (let i = 0; i < porMalla; i++) {
        const orden = azar();
        // Las primeras forman el anillo bajo de buen tiempo; el resto, el techo de los días cubiertos.
        const techo = orden > 0.4;
        const a = azar() * Math.PI * 2;
        const r = techo ? entre(azar, 40, 330) : entre(azar, 120, 330);
        this.datosNubes.push({
          x: Math.cos(a) * r,
          y: techo ? entre(azar, 70, 130) : entre(azar, -60, 30),
          z: Math.sin(a) * r,
          esc: entre(azar, 0.9, 2.4) * (techo ? 1.5 : 1),
          giro: azar() * 6.28,
          malla: m,
          indice: i,
          orden,
        });
      }
    }

    this.luz = new THREE.DirectionalLight(0xffffff, 3);
    this.luz.castShadow = true;
    this.luz.shadow.mapSize.set(2048, 2048);
    this.luz.shadow.bias = -0.0005;
    this.luz.shadow.normalBias = 0.12;
    this.luz.shadow.radius = 2.2;
    this.luz.shadow.camera.near = 10;
    this.luz.shadow.camera.far = 420;
    this.grupo.add(this.luz);
    this.grupo.add(this.luz.target);
    this.hemisferio = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1);
    this.grupo.add(this.hemisferio);
  }

  /** Recalcula colores y luces. `objetivo` es adonde mira la cámara y `distancia` lo lejos que está. */
  actualizar(dt: number, astros: Astros, clima: EstadoClima, camara: THREE.Camera, objetivo: THREE.Vector3, distancia: number): void {
    const a = astros.solAltura;
    const dia = suave(-5, 12, a);
    const dorado = suave(-7, 1, a) * (1 - suave(5, 20, a));
    const noche = 1 - suave(-13, -3, a);
    const nub = clima.nubes;

    const cenit = this.uniCielo.uCenit.value as THREE.Color;
    const horizonte = this.uniCielo.uHorizonte.value as THREE.Color;
    cenit.copy(NOCHE_CENIT).lerp(DIA_CENIT, dia).lerp(DORADO_CENIT, dorado * 0.55);
    horizonte.copy(NOCHE_HORIZONTE).lerp(DIA_HORIZONTE, dia).lerp(DORADO_HORIZONTE, dorado * 0.85 * (1 - nub * 0.6));
    const gris = _t1.copy(GRIS_NOCHE).lerp(GRIS_DIA, dia);
    gris.multiplyScalar(1 - 0.38 * clima.lluvia - 0.25 * clima.tormenta);
    cenit.lerp(_t2.copy(gris).multiplyScalar(0.82), nub * 0.8);
    horizonte.lerp(_t2.copy(gris).multiplyScalar(1.08), nub * 0.72);
    // La niebla es clara en cuanto asoma el sol, y al alba se tiñe de su color.
    const blanco = _t2.copy(GRIS_NOCHE).lerp(NIEBLA_DIA, suave(-8, 5, a)).lerp(DORADO_HORIZONTE, dorado * 0.3);
    cenit.lerp(blanco, clima.niebla * 0.8);
    horizonte.lerp(blanco, clima.niebla * 0.92);

    // Relámpagos de tormenta.
    if (this.rayos && clima.tormenta > 0.6) {
      this.proximoRayo -= dt;
      if (this.proximoRayo <= 0) {
        this.relampago = 1;
        this.proximoRayo = 3 + Math.random() * 8;
      }
    }
    this.relampago = Math.max(0, this.relampago - dt * 3.5);
    const destello = this.relampago * this.relampago;
    cenit.lerp(_t2.setRGB(0.8, 0.85, 1), destello * 0.6);
    horizonte.lerp(_t2.setRGB(0.9, 0.93, 1), destello * 0.6);
    (this.uniCielo.uAbismo.value as THREE.Color).copy(horizonte).lerp(cenit, 0.32);

    (this.uniCielo.uSolDir.value as THREE.Vector3).copy(astros.dirSol);
    const colorSol = _t3.copy(SOL_BAJO).lerp(SOL_ALTO, suave(2, 26, a));
    (this.uniCielo.uSolColor.value as THREE.Color).copy(colorSol);
    this.uniCielo.uSolVisible.value = suave(-2.5, 0.5, a) * (1 - limitar(nub * 1.15 + clima.niebla, 0, 1) * 0.95);
    this.uniCielo.uDorado.value = dorado * (1 - nub * 0.7) * (1 - clima.niebla);

    // Luna y estrellas.
    const lunaVisible = suave(-3, 4, astros.lunaAltura) * (1 - nub * 0.9) * (1 - clima.niebla);
    this.luna.position.copy(astros.dirLuna).multiplyScalar(1200);
    this.luna.visible = lunaVisible > 0.01;
    this.uniLuna.uSol.value.copy(astros.dirSol);
    this.uniLuna.uBrillo.value = lunaVisible * mezcla(1, 0.45, dia);
    this.haloLuna.position.copy(this.luna.position);
    this.haloLuna.visible = this.luna.visible;
    (this.haloLuna.material as THREE.SpriteMaterial).opacity = 0.55 * lunaVisible * noche * astros.lunaFase;
    (this.estrellas.material as THREE.PointsMaterial).opacity = noche * (1 - nub) * (1 - clima.niebla);
    this.estrellas.visible = noche > 0.02;
    this.fondo.position.copy(camara.position);

    // La única luz con sombras: sol de día, luna (o un claror de estrellas) de noche.
    // Con el sol bajo la luz llega rasante: se refuerza para que la hora dorada no quede a oscuras.
    const fuerzaSol = 3.4 * suave(-5, 9, a) * (1 + 0.75 * dorado) * (1 - 0.62 * nub) * (1 - 0.6 * clima.lluvia) * (1 - 0.5 * clima.niebla);
    const lunaArriba = suave(-2, 8, astros.lunaAltura);
    // En el crepúsculo ya alumbra el claror del cielo: así no hay un rato a oscuras entre sol y luna.
    const fuerzaLuna = (0.85 + 0.9 * astros.lunaFase * lunaArriba) * (1 - suave(-9, 0, a)) * (1 - 0.45 * nub);
    if (fuerzaSol >= fuerzaLuna) {
      this.dirLuz.copy(astros.dirSol);
      this.luz.color.copy(colorSol).lerp(_t2.copy(gris).multiplyScalar(1.3), nub * 0.6);
      this.luz.intensity = fuerzaSol;
    } else {
      if (lunaArriba > 0.2) this.dirLuz.copy(astros.dirLuna);
      else this.dirLuz.set(-0.35, 0.8, 0.45);
      this.luz.color.copy(LUNA);
      this.luz.intensity = fuerzaLuna;
    }
    // Se levanta un poco la luz rasante para que las sombras no se alarguen sin fin.
    const minimo = fuerzaSol >= fuerzaLuna ? 0.24 : 0.5;
    if (this.dirLuz.y < minimo) {
      this.dirLuz.y = minimo;
      this.dirLuz.normalize();
    }
    this.luz.intensity += destello * 4;

    // La sombra sigue a la cámara y se ajusta por escalones al zum.
    const radio = distancia < 45 ? 42 : distancia < 80 ? 60 : 84;
    const camS = this.luz.shadow.camera;
    if (radio !== this.radioSombra) {
      this.radioSombra = radio;
      camS.left = -radio;
      camS.right = radio;
      camS.top = radio;
      camS.bottom = -radio;
      camS.updateProjectionMatrix();
    }
    const paso = (radio * 2) / 256;
    const ox = Math.round(objetivo.x / paso) * paso;
    const oz = Math.round(objetivo.z / paso) * paso;
    this.luz.target.position.set(ox, 0, oz);
    this.luz.position.set(ox, 0, oz).addScaledVector(this.dirLuz, 200);

    // Luz ambiente de cielo y rebote del suelo.
    const hemi = this.hemisferio;
    hemi.color.copy(cenit).lerp(horizonte, 0.55).lerp(_t2.setRGB(1, 1, 1), 0.5 * dia);
    // De noche el cielo es casi negro: la luz ambiente se toma de un azul de luna para que el valle se lea.
    hemi.color.lerp(AMBIENTE_NOCHE, 1 - dia).lerp(_t2.copy(DORADO_HORIZONTE), dorado * 0.45 * (1 - nub));
    hemi.groundColor.copy(SUELO_NOCHE).lerp(SUELO_DIA, dia).lerp(_t2.copy(DORADO_HORIZONTE), dorado * 0.3);
    hemi.intensity = mezcla(1.15, 1.2, dia) * (1 + 0.25 * nub * dia) * (1 + 0.45 * clima.niebla) * (1 - 0.22 * clima.lluvia) * (1 - 0.2 * clima.tormenta) + destello * 3;

    // Niebla: bruma lejana siempre, espesa con niebla, y la del amanecer con el cielo raso.
    const bruma = astros.manana ? limitar(1 - Math.abs(a - 2.5) / 9, 0, 1) * (1 - clima.lluvia) : 0;
    let lejos = 620;
    let cerca = 170;
    lejos = mezcla(lejos, 300, clima.lluvia);
    cerca = mezcla(cerca, 50, clima.lluvia);
    lejos = mezcla(lejos, 250, clima.nieve);
    cerca = mezcla(cerca, 40, clima.nieve);
    lejos = mezcla(lejos, 210, bruma * 0.85);
    cerca = mezcla(cerca, 18, bruma * 0.85);
    lejos = mezcla(lejos, 115, clima.niebla);
    cerca = mezcla(cerca, 4, clima.niebla);
    // Con la cámara lejos la niebla se abre un poco para que la maqueta no desaparezca.
    this.niebla.near = cerca + distancia * 0.25;
    this.niebla.far = lejos + distancia * 0.9;
    this.niebla.color.copy(horizonte).lerp(_t2.copy(horizonte).multiplyScalar(1.12).lerp(DORADO_HORIZONTE, 0.25), bruma * 0.6);

    // Nubes: cuántas se ven y de qué color.
    const visibles = 0.22 + nub * 0.78;
    for (const d of this.datosNubes) {
      const malla = this.nubes[d.malla];
      d.x += dt * (0.5 + clima.viento * 2.5);
      if (d.x > 340) d.x -= 680;
      const s = d.orden < visibles ? d.esc : 0;
      _m.compose(_p.set(d.x, d.y, d.z), _q.setFromAxisAngle(_y, d.giro), _s.set(s, s * 0.8, s));
      malla.setMatrixAt(d.indice, _m);
    }
    for (const malla of this.nubes) malla.instanceMatrix.needsUpdate = true;
    this.matNube.color.setRGB(1, 1, 1).lerp(_t2.copy(gris).multiplyScalar(0.9), nub * 0.75);
    this.matNube.emissive.copy(horizonte);
    this.matNube.emissiveIntensity = 0.3 + 0.25 * (1 - dia);

    const amb = this.ambiente;
    amb.dia = dia;
    amb.dorado = dorado;
    amb.luces = limitar(1 - suave(-6, 4, a) + clima.tormenta * 0.5 + clima.lluvia * 0.3 + clima.niebla * 0.45, 0, 1);
    amb.horizonte.copy(horizonte);
    amb.ambiente.copy(hemi.color).multiplyScalar(Math.min(1.2, hemi.intensity * 0.55 + this.luz.intensity * 0.18));
    GLOBALES.uLuces.value = amb.luces;
  }

  dispose(): void {
    this.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

const _t1 = new THREE.Color();
const _t2 = new THREE.Color();
const _t3 = new THREE.Color();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

/** Textura redonda y difusa para halos y destellos. */
export function texturaHalo(): THREE.Texture {
  const lado = 128;
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = lado;
  const ctx = lienzo.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(lado / 2, lado / 2, 0, lado / 2, lado / 2, lado / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, lado, lado);
  }
  const t = new THREE.CanvasTexture(lienzo);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
