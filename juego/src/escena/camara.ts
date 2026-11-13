// Cámara de maqueta: mira en diagonal desde arriba y se maneja con ratón, trackpad, dedos o teclado.
// Todo va amortiguado y con límites: ni se sale del valle ni se mete bajo el suelo.
//
//   arrastrar (botón izquierdo o un dedo)        desplazarse
//   botón derecho / central, o Mayús + arrastrar girar e inclinar
//   rueda o dos dedos en vertical, o pellizco    acercar y alejar
//   dos dedos en horizontal                      girar
//   flechas / WASD, Q y E, + y −                 lo mismo con el teclado
import * as THREE from 'three';
import { limitar } from '../util/azar';

export interface PoseCamara {
  x: number;
  z: number;
  /** Giro alrededor del valle, en grados (0 = cámara al sur mirando al norte). */
  azimut: number;
  /** Altura de la mirada sobre el horizonte, en grados. */
  elevacion: number;
  distancia: number;
}

const ELEV_MIN = 8;
const ELEV_MAX = 80;
const DIST_MIN = 12;
const DIST_MAX = 175;

export class CamaraValle {
  readonly camara: THREE.PerspectiveCamera;
  readonly objetivo = new THREE.Vector3();
  private pose: PoseCamara = { x: 0, z: 0, azimut: -32, elevacion: 37, distancia: 105 };
  private meta: PoseCamara = { ...this.pose };
  private readonly lienzo: HTMLElement;
  private readonly limite: number;
  private readonly altura: (x: number, z: number) => number;
  private readonly punteros = new Map<number, { x: number; y: number }>();
  private modo: 'nada' | 'mover' | 'girar' = 'nada';
  private recorrido = 0;
  private pellizco = 0;
  private anguloDedos = 0;
  private readonly teclas = new Set<string>();
  private readonly limpiar: (() => void)[] = [];

  constructor(lienzo: HTMLElement, limite: number, altura: (x: number, z: number) => number) {
    this.lienzo = lienzo;
    this.limite = limite;
    this.altura = altura;
    this.camara = new THREE.PerspectiveCamera(34, 1, 1, 3200);
    const oir = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, tipo: K, fn: (e: HTMLElementEventMap[K]) => void, opciones?: AddEventListenerOptions) => {
      el.addEventListener(tipo, fn as EventListener, opciones);
      this.limpiar.push(() => el.removeEventListener(tipo, fn as EventListener, opciones));
    };
    oir(lienzo, 'pointerdown', (e) => this.alBajar(e));
    oir(lienzo, 'pointermove', (e) => this.alMover(e));
    oir(lienzo, 'pointerup', (e) => this.alSubir(e));
    oir(lienzo, 'pointercancel', (e) => this.alSubir(e));
    oir(lienzo, 'wheel', (e) => this.alRodar(e), { passive: false });
    oir(lienzo, 'contextmenu', (e) => e.preventDefault());
    oir(window, 'keydown', (e) => {
      const en = e.target as HTMLElement | null;
      if (en && (en.tagName === 'INPUT' || en.tagName === 'TEXTAREA' || en.tagName === 'SELECT')) return;
      this.teclas.add(e.key.toLowerCase());
    });
    oir(window, 'keyup', (e) => this.teclas.delete(e.key.toLowerCase()));
    oir(window, 'blur', () => this.teclas.clear());
    this.colocar();
  }

  /** ¿El último gesto fue un arrastre? (para no confundirlo con un clic). */
  get huboArrastre(): boolean {
    return this.recorrido > 6;
  }

  get distancia(): number {
    return this.pose.distancia;
  }

  /** Lleva la cámara a una pose; con `yaMismo` salta sin transición. */
  fijar(pose: Partial<PoseCamara>, yaMismo = false): void {
    Object.assign(this.meta, pose);
    this.acotar();
    if (yaMismo) {
      this.pose = { ...this.meta };
      this.colocar();
    }
  }

  poseActual(): PoseCamara {
    return { ...this.pose };
  }

  private alBajar(e: PointerEvent): void {
    this.lienzo.setPointerCapture(e.pointerId);
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.recorrido = 0;
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.pellizco = Math.hypot(a.x - b.x, a.y - b.y);
      this.anguloDedos = Math.atan2(b.y - a.y, b.x - a.x);
      this.modo = 'nada';
    } else {
      this.modo = e.button !== 0 || e.shiftKey || e.altKey ? 'girar' : 'mover';
    }
  }

  private alMover(e: PointerEvent): void {
    const previo = this.punteros.get(e.pointerId);
    if (!previo) return;
    const dx = e.clientX - previo.x;
    const dy = e.clientY - previo.y;
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.recorrido += Math.abs(dx) + Math.abs(dy);
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (this.pellizco > 0) this.meta.distancia *= this.pellizco / Math.max(1, d);
      this.meta.azimut -= THREE.MathUtils.radToDeg(ang - this.anguloDedos);
      this.pellizco = d;
      this.anguloDedos = ang;
    } else if (this.modo === 'girar') {
      this.meta.azimut -= dx * 0.3;
      this.meta.elevacion += dy * 0.22;
    } else if (this.modo === 'mover') {
      this.desplazar(-dx, -dy);
    }
    this.acotar();
  }

  private alSubir(e: PointerEvent): void {
    this.punteros.delete(e.pointerId);
    if (this.punteros.size === 0) this.modo = 'nada';
    this.pellizco = 0;
  }

  private alRodar(e: WheelEvent): void {
    e.preventDefault();
    const paso = e.deltaMode === 1 ? 32 : 1;
    if (e.ctrlKey) {
      // Pellizco del trackpad.
      this.meta.distancia *= Math.exp(e.deltaY * paso * 0.012);
    } else {
      this.meta.distancia *= Math.exp(limitar(e.deltaY * paso, -120, 120) * 0.0022);
      this.meta.azimut += limitar(e.deltaX * paso, -80, 80) * 0.12;
    }
    this.acotar();
  }

  /** Mueve el objetivo sobre el suelo según píxeles de pantalla. */
  private desplazar(px: number, py: number): void {
    const alto = this.lienzo.clientHeight || 1;
    const porPixel = (2 * this.meta.distancia * Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2))) / alto;
    const az = THREE.MathUtils.degToRad(this.meta.azimut);
    const inclinado = 1 / Math.max(0.35, Math.sin(THREE.MathUtils.degToRad(this.meta.elevacion)));
    // Derecha de la pantalla y «hacia la cámara» proyectados en el suelo.
    const dx = Math.cos(az) * px + Math.sin(az) * py * inclinado;
    const dz = -Math.sin(az) * px + Math.cos(az) * py * inclinado;
    this.meta.x += dx * porPixel;
    this.meta.z += dz * porPixel;
  }

  private acotar(): void {
    const m = this.meta;
    m.distancia = limitar(m.distancia, DIST_MIN, DIST_MAX);
    m.elevacion = limitar(m.elevacion, ELEV_MIN, ELEV_MAX);
    const lim = this.limite * 0.86;
    m.x = limitar(m.x, -lim, lim);
    m.z = limitar(m.z, -lim, lim);
  }

  private colocar(): void {
    const p = this.pose;
    const az = THREE.MathUtils.degToRad(p.azimut);
    let el = THREE.MathUtils.degToRad(p.elevacion);
    this.objetivo.set(p.x, this.altura(p.x, p.z) + 1, p.z);
    const pos = this.camara.position;
    for (let intento = 0; intento < 8; intento++) {
      pos.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(p.distancia).add(this.objetivo);
      // Si la cámara quedara bajo una ladera, se levanta la mirada.
      const dentro = Math.abs(pos.x) < this.limite && Math.abs(pos.z) < this.limite;
      if (!dentro || pos.y > this.altura(pos.x, pos.z) + 3) break;
      el = Math.min(THREE.MathUtils.degToRad(ELEV_MAX), el + 0.06);
    }
    // Con la cámara muy tendida se levanta la mirada: entra más cielo (y la luna) y menos canto.
    const alza = (1 - Math.min(1, Math.max(0, (p.elevacion - ELEV_MIN) / (30 - ELEV_MIN)))) * p.distancia * 0.16;
    this.camara.lookAt(this.objetivo.x, this.objetivo.y + alza, this.objetivo.z);
  }

  actualizar(dt: number): void {
    // Teclado.
    const t = this.teclas;
    if (t.size) {
      const v = 520 * dt;
      let px = 0;
      let py = 0;
      if (t.has('arrowleft') || t.has('a')) px -= v;
      if (t.has('arrowright') || t.has('d')) px += v;
      if (t.has('arrowup') || t.has('w')) py -= v;
      if (t.has('arrowdown') || t.has('s')) py += v;
      if (px || py) this.desplazar(px, py);
      if (t.has('q')) this.meta.azimut += 70 * dt;
      if (t.has('e')) this.meta.azimut -= 70 * dt;
      if (t.has('+') || t.has('=')) this.meta.distancia *= Math.exp(-1.4 * dt);
      if (t.has('-')) this.meta.distancia *= Math.exp(1.4 * dt);
      this.acotar();
    }
    const k = 1 - Math.exp(-dt * 9);
    const p = this.pose;
    const m = this.meta;
    p.x += (m.x - p.x) * k;
    p.z += (m.z - p.z) * k;
    p.azimut += (m.azimut - p.azimut) * k;
    p.elevacion += (m.elevacion - p.elevacion) * k;
    p.distancia += (m.distancia - p.distancia) * k;
    this.colocar();
  }

  tamano(ancho: number, alto: number): void {
    this.camara.aspect = ancho / Math.max(1, alto);
    this.camara.updateProjectionMatrix();
  }

  dispose(): void {
    for (const fn of this.limpiar) fn();
  }
}
