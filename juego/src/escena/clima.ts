// Clima: el real de Open-Meteo (gratis y sin clave) o, si no responde, uno simulado verosímil para
// la estación. También dibuja la lluvia y la nieve.
import * as THREE from 'three';
import type { Ubicacion } from '../datos';
import { crearAzar, mezcla } from '../util/azar';
import { GLOBALES } from './glsl';
import type { Estacion } from './paleta';

export type TipoClima = 'despejado' | 'nubes' | 'lluvia' | 'niebla' | 'tormenta' | 'nieve';

export const CLIMAS: TipoClima[] = ['despejado', 'nubes', 'lluvia', 'niebla', 'tormenta', 'nieve'];

export const NOMBRE_CLIMA: Record<TipoClima, string> = {
  despejado: 'Despejado',
  nubes: 'Nubes',
  lluvia: 'Lluvia',
  niebla: 'Niebla',
  tormenta: 'Tormenta',
  nieve: 'Nieve',
};

/** Lo que el clima le pide a la escena, todo entre 0 y 1. */
export interface EstadoClima {
  nubes: number;
  lluvia: number;
  nieve: number;
  niebla: number;
  tormenta: number;
  viento: number;
}

const OBJETIVOS: Record<TipoClima, EstadoClima> = {
  despejado: { nubes: 0.12, lluvia: 0, nieve: 0, niebla: 0, tormenta: 0, viento: 0.25 },
  nubes: { nubes: 0.7, lluvia: 0, nieve: 0, niebla: 0, tormenta: 0, viento: 0.4 },
  lluvia: { nubes: 0.9, lluvia: 0.8, nieve: 0, niebla: 0.15, tormenta: 0, viento: 0.55 },
  niebla: { nubes: 0.5, lluvia: 0, nieve: 0, niebla: 1, tormenta: 0, viento: 0.1 },
  tormenta: { nubes: 1, lluvia: 1, nieve: 0, niebla: 0.2, tormenta: 1, viento: 1 },
  nieve: { nubes: 0.85, lluvia: 0, nieve: 1, niebla: 0.25, tormenta: 0, viento: 0.3 },
};

/** Código meteorológico de la OMM (el que da Open-Meteo) → tipo de clima del juego. */
export function climaDeCodigo(codigo: number): TipoClima {
  if (codigo <= 1) return 'despejado';
  if (codigo <= 3) return 'nubes';
  if (codigo === 45 || codigo === 48) return 'niebla';
  if ((codigo >= 71 && codigo <= 77) || codigo === 85 || codigo === 86) return 'nieve';
  if (codigo >= 95) return 'tormenta';
  if (codigo >= 51) return 'lluvia';
  return 'nubes';
}

/** Clima inventado pero creíble: cambia cada tres horas y depende de la estación. */
export function climaSimulado(fecha: Date, estacion: Estacion): TipoClima {
  const tramo = Math.floor(fecha.getTime() / (3 * 3600 * 1000));
  const r = crearAzar(tramo)();
  const tabla: Record<Estacion, [TipoClima, number][]> = {
    primavera: [['despejado', 0.4], ['nubes', 0.3], ['lluvia', 0.22], ['niebla', 0.05], ['tormenta', 0.03]],
    verano: [['despejado', 0.62], ['nubes', 0.25], ['lluvia', 0.06], ['tormenta', 0.07]],
    otono: [['despejado', 0.25], ['nubes', 0.32], ['lluvia', 0.28], ['niebla', 0.1], ['tormenta', 0.05]],
    invierno: [['despejado', 0.25], ['nubes', 0.33], ['lluvia', 0.25], ['niebla', 0.1], ['nieve', 0.05], ['tormenta', 0.02]],
  };
  let suma = 0;
  for (const [tipo, p] of tabla[estacion]) {
    suma += p;
    if (r < suma) return tipo;
  }
  return 'nubes';
}

export class Clima {
  readonly grupo = new THREE.Group();
  /** Estado suavizado que lee el cielo. */
  readonly estado: EstadoClima = { ...OBJETIVOS.despejado };
  /** Tipo en vigor (el fijado a mano o el real/simulado). */
  tipo: TipoClima = 'despejado';
  /** De dónde sale: 'real' (Open-Meteo), 'simulado' o 'fijado'. */
  origen: 'real' | 'simulado' | 'fijado' = 'simulado';
  temperatura: number | null = null;
  private fijado: TipoClima | null = null;
  private real: TipoClima | null = null;
  private ultimaConsulta = 0;
  private consultando = false;
  private readonly ubicacion: Ubicacion;
  private readonly lluvia: THREE.LineSegments;
  private readonly nieve: THREE.Points;
  private readonly uniLluvia: { uTiempo: THREE.IUniform<number>; uCentro: THREE.IUniform<THREE.Vector3>; uFuerza: THREE.IUniform<number>; uColor: THREE.IUniform<THREE.Color> };
  private readonly uniNieve: { uTiempo: THREE.IUniform<number>; uCentro: THREE.IUniform<THREE.Vector3>; uFuerza: THREE.IUniform<number>; uColor: THREE.IUniform<THREE.Color>; uEscala: THREE.IUniform<number> };
  alCambiar: ((tipo: TipoClima) => void) | null = null;

  constructor(ubicacion: Ubicacion) {
    this.ubicacion = ubicacion;
    this.grupo.name = 'clima';
    const azar = crearAzar(77);

    // Lluvia: trazos que caen dentro de una caja que sigue a la cámara; todo se mueve en la gráfica.
    const N = 5000;
    const pos = new Float32Array(N * 2 * 3);
    const cola = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = azar();
      const y = azar();
      const z = azar();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        cola[i * 2 + k] = k;
      }
    }
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gl.setAttribute('cola', new THREE.BufferAttribute(cola, 1));
    this.uniLluvia = { uTiempo: GLOBALES.uTiempo, uCentro: { value: new THREE.Vector3() }, uFuerza: { value: 0 }, uColor: { value: new THREE.Color(0xc8d8e8) } };
    this.lluvia = new THREE.LineSegments(
      gl,
      new THREE.ShaderMaterial({
        uniforms: this.uniLluvia,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          attribute float cola;
          uniform float uTiempo;
          uniform vec3 uCentro;
          uniform float uFuerza;
          varying float vAlfa;
          void main() {
            vec3 caja = vec3(130.0, 60.0, 130.0);
            vec3 p = position;
            float vel = 0.55 + fract(p.x * 91.7) * 0.25;
            p.y = fract(p.y - uTiempo * vel);
            vec3 m = (p - 0.5) * caja;
            m.xz = mod(m.xz - uCentro.xz + caja.xz * 0.5, caja.xz) - caja.xz * 0.5 + uCentro.xz;
            m.y += 22.0;
            m += vec3(0.25, 1.0, 0.1) * cola * 1.4;
            vAlfa = (0.25 + 0.3 * cola) * step(fract(position.z * 57.3 + position.x * 13.1), uFuerza);
            gl_Position = projectionMatrix * viewMatrix * vec4(m, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vAlfa;
          void main() {
            if (vAlfa < 0.01) discard;
            gl_FragColor = vec4(uColor, vAlfa);
          }`,
      }),
    );
    this.lluvia.frustumCulled = false;
    this.lluvia.visible = false;
    this.lluvia.renderOrder = 10;
    this.grupo.add(this.lluvia);

    // Nieve: copos redondos que caen despacio y se mecen.
    const M = 6000;
    const posN = new Float32Array(M * 3);
    for (let i = 0; i < M * 3; i++) posN[i] = azar();
    const gn = new THREE.BufferGeometry();
    gn.setAttribute('position', new THREE.BufferAttribute(posN, 3));
    this.uniNieve = {
      uTiempo: GLOBALES.uTiempo,
      uCentro: { value: new THREE.Vector3() },
      uFuerza: { value: 0 },
      uColor: { value: new THREE.Color(0xffffff) },
      uEscala: { value: 600 },
    };
    this.nieve = new THREE.Points(
      gn,
      new THREE.ShaderMaterial({
        uniforms: this.uniNieve,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          uniform float uTiempo;
          uniform vec3 uCentro;
          uniform float uFuerza;
          uniform float uEscala;
          varying float vAlfa;
          void main() {
            vec3 caja = vec3(130.0, 55.0, 130.0);
            vec3 p = position;
            float vel = 0.035 + fract(p.x * 37.1) * 0.03;
            p.y = fract(p.y - uTiempo * vel);
            vec3 m = (p - 0.5) * caja;
            m.x += sin(uTiempo * 0.7 + position.z * 40.0) * 1.2;
            m.z += cos(uTiempo * 0.5 + position.x * 40.0) * 1.2;
            m.xz = mod(m.xz - uCentro.xz + caja.xz * 0.5, caja.xz) - caja.xz * 0.5 + uCentro.xz;
            m.y += 20.0;
            vAlfa = step(fract(position.z * 57.3 + position.x * 13.1), uFuerza);
            vec4 mv = viewMatrix * vec4(m, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(uEscala * (0.1 + 0.1 * fract(position.y * 71.3)) / -mv.z, 1.5, 9.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vAlfa;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.2, d) * vAlfa * 0.9;
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.nieve.frustumCulled = false;
    this.nieve.visible = false;
    this.nieve.renderOrder = 10;
    this.grupo.add(this.nieve);
  }

  /** Fija el clima a mano; null vuelve al real (o simulado). */
  fijar(tipo: TipoClima | null): void {
    this.fijado = tipo;
  }

  get fijadoAMano(): TipoClima | null {
    return this.fijado;
  }

  /** Salta al estado del clima en vigor sin transición (para capturas). */
  saltar(): void {
    Object.assign(this.estado, OBJETIVOS[this.tipo]);
  }

  private async consultar(): Promise<void> {
    if (this.consultando || this.ubicacion.clima !== 'open-meteo') return;
    this.consultando = true;
    this.ultimaConsulta = Date.now();
    try {
      const url =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${this.ubicacion.latitud}&longitude=${this.ubicacion.longitud}` +
        '&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto';
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), 6000);
      const r = await fetch(url, { signal: control.signal });
      clearTimeout(reloj);
      if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
      const datos = (await r.json()) as { current?: { weather_code?: number; temperature_2m?: number } };
      const codigo = datos.current?.weather_code;
      if (typeof codigo !== 'number') throw new Error('Respuesta de Open-Meteo sin código de tiempo');
      this.real = climaDeCodigo(codigo);
      this.temperatura = datos.current?.temperature_2m ?? null;
    } catch (e) {
      console.info('Sin clima real; se usa el simulado.', e);
      this.real = null;
    } finally {
      this.consultando = false;
    }
  }

  actualizar(dt: number, fecha: Date, estacion: Estacion, centro: THREE.Vector3, altoPx: number, luz: number): void {
    // El clima real se refresca cada veinte minutos; mientras llega, vale el simulado.
    if (this.fijado === null && Date.now() - this.ultimaConsulta > 20 * 60 * 1000) void this.consultar();
    const previo = this.tipo;
    if (this.fijado) {
      this.tipo = this.fijado;
      this.origen = 'fijado';
    } else if (this.real) {
      this.tipo = this.real;
      this.origen = 'real';
    } else {
      this.tipo = climaSimulado(fecha, estacion);
      this.origen = 'simulado';
    }
    if (previo !== this.tipo) this.alCambiar?.(this.tipo);

    const meta = OBJETIVOS[this.tipo];
    const k = 1 - Math.exp(-dt * 0.9);
    for (const clave of Object.keys(meta) as (keyof EstadoClima)[]) {
      this.estado[clave] = mezcla(this.estado[clave], meta[clave], k);
    }
    GLOBALES.uLluvia.value = this.estado.lluvia;
    GLOBALES.uViento.value = this.estado.viento;
    GLOBALES.uNieve.value = this.estado.nieve;

    this.lluvia.visible = this.estado.lluvia > 0.03;
    this.uniLluvia.uFuerza.value = this.estado.lluvia;
    this.uniLluvia.uCentro.value.copy(centro);
    this.uniLluvia.uColor.value.setRGB(0.55 + 0.35 * luz, 0.62 + 0.33 * luz, 0.7 + 0.3 * luz);
    this.nieve.visible = this.estado.nieve > 0.03;
    this.uniNieve.uFuerza.value = this.estado.nieve;
    this.uniNieve.uCentro.value.copy(centro);
    this.uniNieve.uEscala.value = altoPx;
    this.uniNieve.uColor.value.setScalar(0.55 + 0.45 * luz);
  }
}
