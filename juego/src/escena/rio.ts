// El río: una lámina de agua a nivel constante que solo asoma donde el terreno queda por debajo
// (el cauce). La corriente sale de un mapa de flujo calculado con la polilínea del paisaje.
import * as THREE from 'three';
import type { Cuadricula } from '../juego/cuadricula';
import { GLOBALES, RUIDO_GLSL } from './glsl';
import { NIVEL_AGUA } from './terreno';

export class Rio {
  readonly malla: THREE.Mesh;
  private readonly flujo: THREE.DataTexture;
  private readonly material: THREE.MeshStandardMaterial;
  readonly uniformes: {
    uFlujo: THREE.IUniform<THREE.DataTexture>;
    uLado: THREE.IUniform<number>;
    uTiempo: THREE.IUniform<number>;
    uLluvia: THREE.IUniform<number>;
    uProfundo: THREE.IUniform<THREE.Color>;
    uSomero: THREE.IUniform<THREE.Color>;
    uCielo: THREE.IUniform<THREE.Color>;
    uHielo: THREE.IUniform<number>;
  };

  constructor(cuadricula: Cuadricula) {
    const lado = cuadricula.mitad * 2;
    this.flujo = this.mapaDeFlujo(cuadricula);
    this.uniformes = {
      uFlujo: { value: this.flujo },
      uLado: { value: lado },
      uTiempo: GLOBALES.uTiempo,
      uLluvia: GLOBALES.uLluvia,
      uProfundo: { value: new THREE.Color(0x2b7385) },
      uSomero: { value: new THREE.Color(0x67b3b0) },
      uCielo: { value: new THREE.Color(0xbfd9ea) },
      uHielo: { value: 0 },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPosM;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosM = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vPosM;
          uniform sampler2D uFlujo;
          uniform float uLado;
          uniform float uTiempo;
          uniform float uLluvia;
          uniform vec3 uProfundo;
          uniform vec3 uSomero;
          uniform vec3 uCielo;
          uniform float uHielo;
          ${RUIDO_GLSL}
          float aldeaOndas(vec2 p) {
            return aldeaRuido(p) * 0.6 + aldeaRuido(p * 2.3 + 7.1) * 0.4;
          }
          // Altura de la superficie con dos fases de flujo que se relevan (evita que el ruido se estire).
          float aldeaAgua(vec2 p, vec2 dir, float vel) {
            float f0 = fract(uTiempo * 0.22);
            float f1 = fract(uTiempo * 0.22 + 0.5);
            float a = aldeaOndas(p - dir * f0 * vel);
            float b = aldeaOndas(p - dir * f1 * vel + 4.7);
            return mix(a, b, abs(f0 * 2.0 - 1.0));
          }
          vec3 aldeaNormalAgua;
          vec3 aldeaReflejo;
          float aldeaEspuma;`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          {
            vec4 fl = texture2D(uFlujo, vPosM.xz / uLado + 0.5);
            vec2 dir = normalize(fl.rg * 2.0 - 1.0 + vec2(0.0001));
            float d = fl.b;
            float vel = 3.2 * (1.0 - 0.55 * d) * (1.0 - uHielo);
            vec2 p = vPosM.xz * 0.75;
            float e = 0.18;
            float h0 = aldeaAgua(p, dir, vel);
            float hx = aldeaAgua(p + vec2(e, 0.0), dir, vel);
            float hz = aldeaAgua(p + vec2(0.0, e), dir, vel);
            float fuerza = 0.24 + 0.5 * uLluvia;
            aldeaNormalAgua = normalize(vec3((h0 - hx) * fuerza, e, (h0 - hz) * fuerza));
            // Espuma: hilos que bajan con la corriente y un ribete en las orillas.
            vec2 q = vec2(dot(vPosM.xz, vec2(-dir.y, dir.x)) * 1.7, dot(vPosM.xz, dir) * 0.35 - uTiempo * 0.55 * (1.0 - uHielo));
            float hilos = smoothstep(0.72, 0.9, aldeaRuido(q) * 0.7 + h0 * 0.4);
            float ribete = smoothstep(0.52, 0.66, d) * smoothstep(0.45, 0.75, aldeaRuido(vPosM.xz * 1.6 + uTiempo * 0.25) + (d - 0.6));
            // Gotas de lluvia: anillos que nacen y mueren.
            vec2 g = vPosM.xz * 1.3;
            vec2 gi = floor(g);
            float gt = fract(uTiempo * 0.9 + aldeaHash(gi) * 7.0);
            float anillo = smoothstep(0.06, 0.0, abs(length(fract(g) - 0.5) - gt * 0.42)) * (1.0 - gt) * uLluvia;
            aldeaEspuma = clamp(hilos * 0.4 + ribete * 0.6 + anillo * 0.6, 0.0, 1.0);
            vec3 agua = mix(uProfundo, uSomero, smoothstep(0.3, 0.72, d) * 0.85 + h0 * 0.15);
            vec3 vista = normalize(cameraPosition - vPosM);
            float fres = pow(1.0 - max(dot(aldeaNormalAgua, vista), 0.0), 3.0);
            agua = mix(agua, vec3(0.86, 0.92, 0.96), uHielo * 0.75);
            diffuseColor.rgb = mix(agua, vec3(0.97), aldeaEspuma);
            // El cielo se refleja en el agua con independencia del sol: de día azul, al ocaso dorado.
            aldeaReflejo = uCielo * (0.1 + 0.55 * fres) * (1.0 - aldeaEspuma) * (1.0 - 0.6 * uHielo);
          }`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          /* glsl */ `#include <normal_fragment_begin>
          normal = normalize((viewMatrix * vec4(aldeaNormalAgua, 0.0)).xyz);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += aldeaReflejo;')
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.9, max(aldeaEspuma, uHielo * 0.6));`,
        );
    };
    this.material.customProgramCacheKey = () => 'aldea-rio';

    const g = new THREE.PlaneGeometry(lado - 0.02, lado - 0.02, 1, 1);
    g.rotateX(-Math.PI / 2);
    this.malla = new THREE.Mesh(g, this.material);
    this.malla.position.y = NIVEL_AGUA;
    this.malla.receiveShadow = true;
    this.malla.name = 'rio';
  }

  /** RG: dirección de la corriente. B: distancia al eje (0) hasta el límite de la orilla (1). */
  private mapaDeFlujo(c: Cuadricula): THREE.DataTexture {
    const res = c.n * 2;
    const datos = new Uint8Array(res * res * 4);
    const limite = c.paisaje.rio.anchura / 2 + 1.2;
    const { rueda, toma } = c.sitioMolino();
    const vx = toma[0] - rueda[0];
    const vz = toma[1] - rueda[1];
    const largo = Math.hypot(vx, vz) || 1;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const cx = (i + 0.5) / 2 - 0.5;
        const cz = (j + 0.5) / 2 - 0.5;
        const r = c.rio(cx, cz);
        // En el caz del molino el agua corre de la rueda hacia el río.
        const t = Math.min(1, Math.max(0, ((cx - rueda[0]) * vx + (cz - rueda[1]) * vz) / (vx * vx + vz * vz || 1)));
        const dCaz = Math.hypot(cx - (rueda[0] + vx * t), cz - (rueda[1] + vz * t));
        if (dCaz < 1.2 && r.dist > limite * 0.75) {
          r.tx = vx / largo;
          r.tz = vz / largo;
          r.dist = limite * (0.55 + 0.3 * Math.min(1, dCaz / 0.8));
        }
        const k = (j * res + i) * 4;
        datos[k] = Math.round((r.tx * 0.5 + 0.5) * 255);
        datos[k + 1] = Math.round((r.tz * 0.5 + 0.5) * 255);
        datos[k + 2] = Math.round(Math.min(1, r.dist / limite) * 255);
        datos[k + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(datos, res, res, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  dispose(): void {
    this.malla.geometry.dispose();
    this.material.dispose();
    this.flujo.dispose();
  }
}
