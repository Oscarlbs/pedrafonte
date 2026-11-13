// Carga de los GLB del pack (juego/public/modelos) y materiales compartidos.
//
// Los 33 modelos del pack medieval repiten una veintena de materiales (WoodPlank03, StoneBrick1…) y los
// de EmaceArt (`ea_*`) comparten uno solo, «EA_Paleta». Se queda una sola copia de cada uno, por nombre,
// para que todas las piezas del mismo material vayan al mismo lote.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLOBALES, RUIDO_GLSL } from './glsl';

export interface PiezaGLB {
  geometria: THREE.BufferGeometry;
  material: THREE.Material;
  /** Transformación de la pieza dentro del modelo. */
  matriz: THREE.Matrix4;
}

export interface ModeloGLB {
  nombre: string;
  piezas: PiezaGLB[];
  min: THREE.Vector3;
  max: THREE.Vector3;
  tam: THREE.Vector3;
}

/** Cómo encajar un GLB en la huella de un edificio del catálogo. */
export interface AjusteGLB {
  /** Nombre del GLB en el manifiesto (sin extensión). */
  glb: string;
  /** Giro extra en cuartos de vuelta para que la fachada mire al sur (z positivo) con rot = 0. */
  cuartos?: number;
  /** Fracción de la huella que ocupa el modelo (1 = toca los bordes). */
  relleno?: number;
  /** Escala fija en lugar de ajustar a la huella. */
  escala?: number;
  /** Desplazamiento en metros tras centrar. */
  desplaza?: [number, number, number];
  /** Puntos con significado (humo, luz, fuego), en las coordenadas originales del modelo. */
  marcas?: { tipo: 'humo' | 'fuego' | 'luz'; pos: [number, number, number]; valor?: number }[];
}

/**
 * Mapa «modelo del catálogo → GLB». Si un `modelo` de edificios.yaml aparece aquí, se usa el GLB en
 * lugar del constructor procedural de edificios.ts. Para enchufar un pack nuevo: optimízalo con
 * herramientas/optimizar-modelos.mjs y añade aquí su entrada (ver docs/ESCENA.md).
 */
export const GLB_POR_MODELO: Record<string, AjusteGLB> = {
  choza: { glb: 'stylized_hut01', relleno: 0.98, marcas: [{ tipo: 'humo', pos: [1.13, 7.05, -0.59], valor: 0.8 }] },
};

/** Multiplicadores de color (lineales) para entonar algunos materiales del pack. */
const TINTES: Record<string, [number, number, number]> = {
  Roof01: [0.95, 0.72, 0.46],
  WoodPlank01: [0.72, 0.85, 0.8],
  WoodPlank04: [0.75, 0.82, 0.8],
  WoodDetails: [0.9, 0.9, 0.85],
  StoneBrick1: [1.25, 1.2, 1.12],
  // La paleta de EmaceArt es más apagada y fría que la de la aldea: se calienta un poco.
  EA_Paleta: [1.22, 1.1, 0.92],
};

/** Nieve sobre lo que mira al cielo y, si hace falta, posición de mundo. Vale para cualquier material estándar. */
export function conNieve(material: THREE.MeshStandardMaterial): void {
  const previo = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previo?.call(material, shader, renderer);
    shader.uniforms['uNieve'] = GLOBALES.uNieve;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNieve;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `{
          float arriba = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), uNieve * smoothstep(0.35, 0.8, arriba));
        }
        #include <emissivemap_fragment>`,
      );
  };
  const clave = material.customProgramCacheKey?.call(material) ?? '';
  material.customProgramCacheKey = () => `${clave}|nieve`;
}

/**
 * Material «pintura»: color por vértice, facetado, con un atributo `luz` que enciende ventanas y
 * faroles de noche. Lo usan todas las piezas procedurales.
 */
export function crearPintura(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
  m.name = 'pintura';
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uLuces'] = GLOBALES.uLuces;
    shader.uniforms['uTiempo'] = GLOBALES.uTiempo;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float luz;\nvarying float vLuz;\nvarying vec3 vPosM;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vLuz = luz;
        vec4 aldeaPos = vec4(position, 1.0);
        #ifdef USE_BATCHING
          aldeaPos = batchingMatrix * aldeaPos;
        #endif
        #ifdef USE_INSTANCING
          aldeaPos = instanceMatrix * aldeaPos;
        #endif
        vPosM = (modelMatrix * aldeaPos).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vLuz;\nvarying vec3 vPosM;\nuniform float uLuces;\nuniform float uTiempo;\n${RUIDO_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // Un poco de grano para que el color liso no parezca plástico.
        diffuseColor.rgb *= 0.93 + 0.14 * aldeaRuido(vPosM.xz * 2.3 + vPosM.y * 3.1);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          float titila = 0.9 + 0.1 * sin(uTiempo * 5.0 + vPosM.x * 3.0 + vPosM.z * 2.0);
          // luz > 1 marca fuego y brasas: lucen siempre; el resto solo de noche.
          float fijo = step(1.5, vLuz);
          totalEmissiveRadiance += vec3(1.0, 0.6, 0.26) * min(vLuz, 1.0) * mix(uLuces, 1.0, fijo) * 2.4 * titila;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'aldea-pintura';
  conNieve(m);
  return m;
}

export class Biblioteca {
  readonly modelos = new Map<string, ModeloGLB>();
  readonly materiales = new Map<string, THREE.MeshStandardMaterial>();
  readonly pintura = crearPintura();
  /** Material emisivo del pack (ventanas de la choza, farol): se enciende de noche. */
  readonly emisivos: THREE.MeshStandardMaterial[] = [];

  /** Carga todos los modelos del manifiesto. Si alguno falla, se sigue sin él. */
  async cargar(base = 'modelos/'): Promise<void> {
    let manifiesto: Record<string, { archivo: string }> = {};
    try {
      const r = await fetch(`${base}manifiesto.json`);
      if (r.ok) manifiesto = (await r.json()) as Record<string, { archivo: string }>;
    } catch {
      console.warn('Sin manifiesto de modelos: la escena usará solo geometría propia.');
    }
    const cargador = new GLTFLoader();
    await Promise.all(
      Object.entries(manifiesto).map(async ([nombre, m]) => {
        try {
          const gltf = await cargador.loadAsync(base + m.archivo);
          this.modelos.set(nombre, this.procesar(nombre, gltf.scene));
        } catch (e) {
          console.warn(`No se pudo cargar el modelo ${nombre}`, e);
        }
      }),
    );
  }

  private procesar(nombre: string, escena: THREE.Object3D): ModeloGLB {
    escena.updateMatrixWorld(true);
    const piezas: PiezaGLB[] = [];
    const caja = new THREE.Box3();
    escena.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = this.materialUnico(o.material as THREE.MeshStandardMaterial);
      const geometria = normalizarTexturada(o.geometry as THREE.BufferGeometry);
      geometria.userData['compartida'] = true;
      geometria.computeBoundingBox();
      if (geometria.boundingBox) caja.union(geometria.boundingBox.clone().applyMatrix4(o.matrixWorld));
      piezas.push({ geometria, material, matriz: o.matrixWorld.clone() });
    });
    const tam = new THREE.Vector3();
    caja.getSize(tam);
    return { nombre, piezas, min: caja.min.clone(), max: caja.max.clone(), tam };
  }

  private materialUnico(m: THREE.MeshStandardMaterial): THREE.Material {
    const nombre = m.name || 'sin-nombre';
    const ya = this.materiales.get(nombre);
    if (ya) {
      // La copia sobrante no llega a la gráfica, pero se sueltan sus texturas.
      if (m !== ya) {
        m.map?.dispose();
        m.normalMap?.dispose();
        m.dispose();
      }
      return ya;
    }
    // Sin mapa de entorno lo metálico sale negro (y las texturas del pack traen metal en su mapa):
    // se deja todo mate, con el hierro algo más pulido.
    const eraMetal = m.metalness > 0.5;
    m.metalnessMap = null;
    m.roughnessMap = null;
    m.aoMap = null;
    m.metalness = eraMetal ? 0.15 : 0;
    m.roughness = eraMetal ? 0.6 : 0.9;
    if (eraMetal) m.color.multiplyScalar(1.5);
    if (m.map) {
      const imagen = m.map.image as { width?: number } | undefined;
      if ((imagen?.width ?? 1024) <= 64) {
        // Paleta de colores (EmaceArt, 32 px): sin suavizar ni mipmaps, o los colores vecinos se mezclan.
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
        m.map.needsUpdate = true;
        m.flatShading = true;
      } else m.map.anisotropy = 4;
    }
    // Las texturas del pack son muy vivas; se entonan con la paleta cálida de la aldea.
    const tinte = TINTES[nombre];
    if (tinte) m.color.setRGB(tinte[0], tinte[1], tinte[2]);
    const esEmisivo = m.emissive.r + m.emissive.g + m.emissive.b > 0.01;
    if (nombre === 'Emission_Yellow') {
      m.emissive.setRGB(1, 0.62, 0.25);
      m.color.setRGB(0.45, 0.36, 0.22);
      this.emisivos.push(m);
    } else if (esEmisivo) {
      m.emissiveIntensity = 1.6;
    }
    if (!esEmisivo) conNieve(m);
    this.materiales.set(nombre, m);
    return m;
  }

  tiene(nombre: string): boolean {
    return this.modelos.has(nombre);
  }

  /** Copia ligera del modelo: mallas nuevas que comparten geometría y material. */
  grupo(nombre: string): THREE.Group {
    const g = new THREE.Group();
    g.name = nombre;
    const m = this.modelos.get(nombre);
    if (!m) return g;
    for (const p of m.piezas) {
      const malla = new THREE.Mesh(p.geometria, p.material);
      malla.applyMatrix4(p.matriz);
      malla.castShadow = true;
      malla.receiveShadow = true;
      g.add(malla);
    }
    return g;
  }

  /** Material del pack por nombre o, si no está, uno liso del color dado. */
  material(nombre: string, colorSiFalta: number): THREE.Material {
    const m = this.materiales.get(nombre);
    if (m) return m;
    const liso = new THREE.MeshStandardMaterial({ color: colorSiFalta, roughness: 0.95 });
    liso.name = nombre;
    conNieve(liso);
    this.materiales.set(nombre, liso);
    return liso;
  }
}

/** Deja la geometría con posición, normal y uv en coma flotante e índice: lo que piden los lotes texturados. */
export function normalizarTexturada(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const nombre of Object.keys(g.attributes)) {
    if (nombre !== 'position' && nombre !== 'normal' && nombre !== 'uv') g.deleteAttribute(nombre);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const nombre of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(nombre) as THREE.BufferAttribute;
    if (!(a.array instanceof Float32Array) || a.normalized || (a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
      const datos = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) {
        for (let k = 0; k < a.itemSize; k++) datos[i * a.itemSize + k] = a.getComponent(i, k);
      }
      g.setAttribute(nombre, new THREE.BufferAttribute(datos, a.itemSize));
    }
  }
  if (!g.getIndex()) {
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    g.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  g.morphAttributes = {};
  return g;
}
