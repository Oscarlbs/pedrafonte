// Fachada de la escena: `crearMundo(lienzo)` devuelve un objeto `Mundo` con todo lo que necesitan
// las fases siguientes (construir, mover figuras, hora, clima…). Documentado en docs/ESCENA.md.
import * as THREE from 'three';
import { PAISAJES, UBICACION, edificioDeCatalogo, huella, type Paisaje } from './datos';
import { type Astros, calcularAstros, enHuso, estacionDe, fechaConHora, horaDecimal } from './escena/astros';
import { CamaraValle, type PoseCamara } from './escena/camara';
import { Cielo } from './escena/cielo';
import { Clima, type TipoClima } from './escena/clima';
import { Efectos, Posproceso } from './escena/efectos';
import { GLOBALES } from './escena/glsl';
import { Lotes } from './escena/lotes';
import { Biblioteca } from './escena/modelos';
import { type Estacion, PALETAS } from './escena/paleta';
import { type DatosEdificio, type DatosVistaPrevia, Poblado } from './escena/poblado';
import { Rio } from './escena/rio';
import { NIVEL_AGUA, Terreno } from './escena/terreno';
import { Vegetacion } from './escena/vegetacion';
import { Animales, type TipoAnimal } from './juego/animales';
import { Cuadricula, type TipoCelda } from './juego/cuadricula';
import { type DatosFigura, Figuras } from './juego/figuras';

export type { DatosEdificio, DatosVistaPrevia } from './escena/poblado';
export type { DatosFigura } from './juego/figuras';
export type { TipoAnimal } from './juego/animales';
export type { TipoCelda } from './juego/cuadricula';
export type { TipoClima } from './escena/clima';
export type { Estacion } from './escena/paleta';
export type { PoseCamara } from './escena/camara';

export interface InfoMundo {
  fps: number;
  /** Llamadas de dibujo del último fotograma (incluye sombras y posprocesado). */
  llamadas: number;
  triangulos: number;
  geometrias: number;
  texturas: number;
  /** Relación de píxeles en uso (baja sola si la gráfica no llega). */
  pixeles: number;
  edificios: number;
  /** Altura del sol sobre el horizonte, en grados. */
  solAltura: number;
}

export interface EventosMundo {
  /** Cambió el minuto que marca el reloj del juego. */
  hora: { hora: number; fecha: Date };
  clima: { tipo: TipoClima; origen: 'real' | 'simulado' | 'fijado' };
  estacion: { estacion: Estacion };
  paisaje: { clave: string };
  /** Una figura llegó a la celda a la que se la mandó. */
  llegada: { id: string };
}

export interface Puntero {
  clientX: number;
  clientY: number;
}

export interface OpcionesMundo {
  /** Capa HTML sobre el lienzo para los bocadillos. Por defecto, #capa-mundo. */
  capa?: HTMLElement;
  /** Relación de píxeles fija (desactiva la calidad adaptativa). */
  pixeles?: number;
  /** Paisaje inicial (clave de paisajes.yaml). Por defecto, «valle». */
  paisaje?: string;
  /** Sin relámpagos ni transiciones suaves: para capturas repetibles. */
  quieto?: boolean;
}

export interface Mundo {
  cargarPaisaje(clave: string): void;
  paisaje(): string;
  datosPaisaje(): Paisaje;

  celdaAMundo(cx: number, cz: number): { x: number; z: number };
  mundoACelda(x: number, z: number): { cx: number; cz: number };
  alturaEn(x: number, z: number): number;
  tipoCelda(cx: number, cz: number): TipoCelda;
  /** Id del edificio que ocupa la celda, si lo hay. Los caminos no ocupan (véase `caminoEn`). */
  ocupante(cx: number, cz: number): string | undefined;
  /** Id de la celda de camino colocada ahí, si la hay. */
  caminoEn(cx: number, cz: number): string | undefined;
  /** Dónde poner el molino para que la rueda toque el agua: el solar del paisaje arrimado al río. */
  sitioMolino(): { cx: number; cz: number; rot: number };

  ponerEdificio(d: DatosEdificio): boolean;
  quitarEdificio(id: string): boolean;
  vaciarEdificios(): void;
  edificios(): Required<DatosEdificio>[];
  vistaPrevia(v: DatosVistaPrevia | null): void;
  /** Celda de delante de la fachada de un edificio (adonde van las figuras que «entran»). */
  celdaPuerta(id: string): [number, number] | null;
  celdaBajoPuntero(evento: Puntero): { cx: number; cz: number } | null;
  objetoBajoPuntero(evento: Puntero): { tipo: 'edificio' | 'figura'; id: string } | null;

  ponerFigura(d: DatosFigura): void;
  moverFigura(id: string, cx: number, cz: number): boolean;
  colocarFigura(id: string, cx: number, cz: number): void;
  mirarFigura(id: string, cx: number, cz: number): void;
  quitarFigura(id: string): void;
  vaciarFiguras(): void;
  posicionFigura(id: string): { x: number; y: number; z: number; cx: number; cz: number; andando: boolean } | null;
  decir(id: string, texto: string, segundos?: number): void;
  ponerAnimales(tipo: TipoAnimal, cx: number, cz: number, n: number, radio?: number): void;
  vaciarAnimales(): void;
  /** Quita edificios, figuras y animales. */
  vaciar(): void;

  fijarHora(hora: number | null): void;
  fijarClima(tipo: TipoClima | null): void;
  fijarFecha(fecha: Date | null): void;
  fijarEstacion(estacion: Estacion | null): void;
  hora(): number;
  fecha(): Date;
  estacion(): Estacion;
  clima(): { tipo: TipoClima; origen: 'real' | 'simulado' | 'fijado'; temperatura: number | null; fijado: TipoClima | null };
  /** Sol y luna del momento: alturas y rumbos en grados (0 = norte, 90 = este) y fase de la luna (0–1). */
  astros(): { solAltura: number; solRumbo: number; lunaAltura: number; lunaRumbo: number; lunaFase: number };

  alCambiar<K extends keyof EventosMundo>(evento: K, fn: (datos: EventosMundo[K]) => void): () => void;
  info(): InfoMundo;
  camara: {
    fijar(pose: Partial<PoseCamara>, yaMismo?: boolean): void;
    pose(): PoseCamara;
    /** ¿El último gesto del puntero fue un arrastre de cámara? */
    huboArrastre(): boolean;
  };
  /** Espera a que la escena esté dibujada y quieta (para capturas). */
  asentar(fotogramas?: number): Promise<void>;
  destruir(): void;
}

/** Todo lo que depende del paisaje cargado. */
interface Valle {
  clave: string;
  cuadricula: Cuadricula;
  terreno: Terreno;
  rio: Rio;
  vegetacion: Vegetacion;
  poblado: Poblado;
  figuras: Figuras;
  animales: Animales;
  camara: CamaraValle;
  puente: { x: number; z: number; ry: number; largo: number; ancho: number; y0: number; perfil: number[] } | null;
}

class MundoEscena implements Mundo {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly escena = new THREE.Scene();
  private readonly cielo = new Cielo();
  private readonly climaReal: Clima;
  private readonly efectos = new Efectos();
  private readonly lotes = new Lotes();
  private readonly post: Posproceso;
  private readonly camaraPost = new THREE.PerspectiveCamera();
  private valle!: Valle;
  private readonly oyentes = new Map<string, Set<(d: never) => void>>();
  private horaFijada: number | null = null;
  private fechaFijada: Date | null = null;
  private estacionFijada: Estacion | null = null;
  private estacionActual: Estacion;
  private astrosActuales: Astros;
  private fechaActual = new Date();
  private minutoAnunciado = -1;
  private fps = 60;
  private pixeles: number;
  private readonly pixelesMax: number;
  private readonly adaptativo: boolean;
  private lentos = 0;
  private contados = 0;
  private marco = 0;
  private ultimo = 0;
  private destruido = false;
  private fotogramas = 0;
  private brilloCapa = '';
  private readonly rayo = new THREE.Raycaster();
  private readonly capa: HTMLElement;
  private readonly limpiar: (() => void)[] = [];
  private ultimaInfo: InfoMundo = { fps: 60, llamadas: 0, triangulos: 0, geometrias: 0, texturas: 0, pixeles: 1, edificios: 0, solAltura: 0 };

  readonly camara = {
    fijar: (pose: Partial<PoseCamara>, yaMismo = false) => this.valle.camara.fijar(pose, yaMismo),
    pose: () => this.valle.camara.poseActual(),
    huboArrastre: () => this.valle.camara.huboArrastre,
  };

  constructor(
    private readonly lienzo: HTMLCanvasElement,
    private readonly bib: Biblioteca,
    private readonly texturas: { hierba: THREE.Texture; mata: THREE.Texture },
    opciones: OpcionesMundo,
  ) {
    this.capa = opciones.capa ?? document.getElementById('capa-mundo') ?? document.body;
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.pixelesMax = opciones.pixeles ?? Math.min(window.devicePixelRatio || 1, 2);
    this.pixeles = this.pixelesMax;
    this.adaptativo = opciones.pixeles === undefined;
    this.renderer.setPixelRatio(this.pixeles);

    this.climaReal = new Clima(UBICACION);
    this.climaReal.alCambiar = (tipo) => this.emitir('clima', { tipo, origen: this.climaReal.origen });
    this.cielo.rayos = !opciones.quieto;
    this.escena.fog = this.cielo.niebla;
    this.escena.add(this.cielo.grupo, this.lotes.grupo, this.efectos.grupo, this.climaReal.grupo);

    this.astrosActuales = calcularAstros(this.fechaActual, UBICACION.latitud, UBICACION.longitud);
    this.estacionActual = estacionDe(this.fechaActual, UBICACION.latitud, UBICACION.huso);

    this.post = new Posproceso(this.renderer, this.escena, this.camaraPost);
    this.cargarPaisaje(opciones.paisaje && PAISAJES[opciones.paisaje] ? opciones.paisaje : 'valle');

    const alCambiarTamano = () => this.ajustarTamano();
    window.addEventListener('resize', alCambiarTamano);
    this.limpiar.push(() => window.removeEventListener('resize', alCambiarTamano));
    this.ajustarTamano();
    this.ultimo = performance.now();
    this.marco = requestAnimationFrame((t) => this.fotograma(t));
  }

  // ───────────── paisaje ─────────────

  cargarPaisaje(clave: string): void {
    const paisaje = PAISAJES[clave];
    if (!paisaje) {
      console.warn(`Paisaje desconocido: ${clave}`);
      return;
    }
    const previo = this.valle as Valle | undefined;
    if (previo) {
      previo.poblado.vaciar();
      previo.figuras.vaciar();
      previo.animales.vaciar();
      this.efectos.vaciar();
      for (const f of this.fichasPuente) this.lotes.quitar(f);
      this.fichasPuente = [];
      this.escena.remove(previo.terreno.grupo, previo.rio.malla, previo.vegetacion.grupo, previo.poblado.grupo);
      previo.terreno.dispose();
      previo.rio.dispose();
      previo.vegetacion.dispose();
      previo.camara.dispose();
    }
    const paleta = PALETAS[this.estacionActual];
    const cuadricula = new Cuadricula(paisaje);
    const terreno = new Terreno(cuadricula, this.texturas.hierba);
    terreno.fijarEstacion(paleta);
    const rio = new Rio(cuadricula);
    const altura = (x: number, z: number) => terreno.alturaEn(x, z);
    const vegetacion = new Vegetacion(cuadricula, altura, this.bib, this.texturas.mata, paleta, clave);
    const poblado = new Poblado(this.lotes, this.bib, cuadricula, terreno, vegetacion, this.efectos, this.estacionActual, paleta);
    const alturaPaso = (x: number, z: number) => this.alturaPaso(x, z);
    const figuras = new Figuras(this.lotes, this.bib, cuadricula, alturaPaso, this.capa);
    figuras.alLlegar = (id) => this.emitir('llegada', { id });
    const animales = new Animales(this.lotes, this.bib, cuadricula, alturaPaso, (x, z) => terreno.alturaEn(x, z) < NIVEL_AGUA + 0.12);
    const camara = new CamaraValle(this.lienzo, cuadricula.mitad, altura);
    this.valle = { clave, cuadricula, terreno, rio, vegetacion, poblado, figuras, animales, camara, puente: null };
    this.escena.add(terreno.grupo, rio.malla, vegetacion.grupo, poblado.grupo);
    this.ponerPuente();
    const claro = cuadricula.celdaAMundo(paisaje.claro.centro[0], paisaje.claro.centro[1]);
    camara.fijar({ x: claro.x * 0.5, z: claro.z * 0.5 }, true);
    this.ajustarTamano();
    this.emitir('paisaje', { clave });
  }

  private fichasPuente: ReturnType<Poblado['hornearGrupo']> = [];

  /** Coloca el puente del paisaje y mide su tablero para que las figuras lo crucen por encima. */
  private ponerPuente(): void {
    const v = this.valle;
    const p = v.cuadricula.paisaje.puente;
    const modelo = this.bib.modelos.get(p.modelo);
    const [w, f] = p.tam;
    const centro = v.cuadricula.celdaAMundo(p.celda[0] + (w - 1) / 2, p.celda[1] + (f - 1) / 2);
    const aLoLargoDeX = w >= f;
    const largo = Math.max(w, f) * v.cuadricula.lado;
    const ancho = Math.min(w, f) * v.cuadricula.lado;
    const ry = aLoLargoDeX ? Math.PI / 2 : 0;
    if (!modelo) {
      v.puente = { x: centro.x, z: centro.z, ry, largo, ancho, y0: 0.35, perfil: [0, 0] };
      return;
    }
    // El modelo es largo en z; se estira para cubrir justo su rectángulo de celdas.
    const ez = largo / modelo.tam.z;
    const ex = ancho / modelo.tam.x;
    const ey = Math.min(1, (ex + ez) / 2);
    const suelto = this.bib.grupo(p.modelo);
    suelto.updateMatrixWorld(true);
    // Perfil del tablero: se lanza un rayo hacia abajo a lo largo del eje del puente.
    const rayo = new THREE.Raycaster();
    const perfil: number[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const z = modelo.min.z + ((modelo.max.z - modelo.min.z) * i) / N;
      let alto = 0;
      for (const dx of [-0.25, 0, 0.25]) {
        rayo.set(new THREE.Vector3((modelo.min.x + modelo.max.x) / 2 + dx, modelo.max.y + 5, z), new THREE.Vector3(0, -1, 0));
        const toques = rayo.intersectObject(suelto, true);
        // El tablero es lo más alto que hay en el eje, descontando barandillas.
        const candidatos = toques.map((t) => t.point.y).filter((y) => y < modelo.max.y - 0.6);
        if (candidatos.length) alto = Math.max(alto, candidatos[0]);
      }
      perfil.push(alto * ey);
    }
    // Los extremos del tablero quedan a ras del camino.
    const extremo = Math.min(perfil[1], perfil[N - 1]);
    const medio = aLoLargoDeX ? { dx: largo / 2 + 0.6, dz: 0 } : { dx: 0, dz: largo / 2 + 0.6 };
    const suelo = (v.terreno.alturaEn(centro.x - medio.dx, centro.z - medio.dz) + v.terreno.alturaEn(centro.x + medio.dx, centro.z + medio.dz)) / 2;
    const y0 = suelo - extremo + 0.02;
    const matriz = new THREE.Matrix4()
      .makeTranslation(centro.x, y0, centro.z)
      .multiply(new THREE.Matrix4().makeRotationY(ry))
      .multiply(new THREE.Matrix4().makeScale(ex, ey, ez))
      .multiply(new THREE.Matrix4().makeTranslation(-(modelo.min.x + modelo.max.x) / 2, 0, -(modelo.min.z + modelo.max.z) / 2));
    this.fichasPuente = v.poblado.hornearGrupo(suelto, matriz);
    v.puente = { x: centro.x, z: centro.z, ry, largo, ancho, y0, perfil };
  }

  /** Altura por la que se anda: el suelo o, sobre el puente, su tablero. */
  private alturaPaso(x: number, z: number): number {
    const v = this.valle;
    const suelo = v.terreno.alturaEn(x, z);
    const p = v.puente;
    if (!p) return suelo;
    const dx = x - p.x;
    const dz = z - p.z;
    const lo = p.ry ? dx : dz;
    const an = p.ry ? dz : dx;
    if (Math.abs(lo) > p.largo / 2 || Math.abs(an) > p.ancho / 2) return suelo;
    // El modelo girado un cuarto de vuelta lleva su eje z hacia +x.
    const t = (lo / p.largo + 0.5) * (p.perfil.length - 1);
    const i = Math.min(p.perfil.length - 2, Math.max(0, Math.floor(t)));
    const alto = p.perfil[i] + (p.perfil[i + 1] - p.perfil[i]) * (t - i);
    return Math.max(suelo, p.y0 + alto);
  }

  paisaje(): string {
    return this.valle.clave;
  }

  datosPaisaje(): Paisaje {
    return this.valle.cuadricula.paisaje;
  }

  // ───────────── cuadrícula ─────────────

  celdaAMundo(cx: number, cz: number): { x: number; z: number } {
    return this.valle.cuadricula.celdaAMundo(cx, cz);
  }

  mundoACelda(x: number, z: number): { cx: number; cz: number } {
    return this.valle.cuadricula.mundoACelda(x, z);
  }

  alturaEn(x: number, z: number): number {
    return this.alturaPaso(x, z);
  }

  tipoCelda(cx: number, cz: number): TipoCelda {
    return this.valle.cuadricula.tipoCelda(cx, cz);
  }

  ocupante(cx: number, cz: number): string | undefined {
    return this.valle.cuadricula.ocupante(cx, cz);
  }

  caminoEn(cx: number, cz: number): string | undefined {
    return this.valle.poblado.caminoEn(cx, cz);
  }

  sitioMolino(): { cx: number; cz: number; rot: number } {
    const { cx, cz, rot } = this.valle.cuadricula.sitioMolino();
    return { cx, cz, rot };
  }

  // ───────────── edificios ─────────────

  ponerEdificio(d: DatosEdificio): boolean {
    return this.valle.poblado.poner(d);
  }

  quitarEdificio(id: string): boolean {
    return this.valle.poblado.quitar(id);
  }

  vaciarEdificios(): void {
    this.valle.poblado.vaciar();
  }

  edificios(): Required<DatosEdificio>[] {
    return this.valle.poblado.lista();
  }

  vistaPrevia(v: DatosVistaPrevia | null): void {
    this.valle.poblado.vistaPrevia(v);
  }

  celdaPuerta(id: string): [number, number] | null {
    return this.valle.poblado.celdaPuerta(id);
  }

  private apuntar(evento: Puntero): void {
    const r = this.lienzo.getBoundingClientRect();
    const x = ((evento.clientX - r.left) / r.width) * 2 - 1;
    const y = -((evento.clientY - r.top) / r.height) * 2 + 1;
    this.rayo.setFromCamera(new THREE.Vector2(x, y), this.valle.camara.camara);
  }

  /** Punto del suelo bajo el puntero: se avanza por el rayo hasta cruzar el terreno. */
  private sueloBajoRayo(): THREE.Vector3 | null {
    const { origin, direction } = this.rayo.ray;
    if (direction.y >= -0.01) return null;
    const lim = this.valle.cuadricula.mitad;
    const p = new THREE.Vector3();
    let previo = 0;
    for (let t = 0; t < 600; t += 0.75) {
      p.copy(origin).addScaledVector(direction, t);
      if (p.y < -5) break;
      const dentro = Math.abs(p.x) <= lim && Math.abs(p.z) <= lim;
      if (dentro && p.y <= Math.max(NIVEL_AGUA, this.valle.terreno.alturaEn(p.x, p.z))) {
        // Se afina por bisección entre el paso anterior y este.
        let a = previo;
        let b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          p.copy(origin).addScaledVector(direction, m);
          if (p.y <= Math.max(NIVEL_AGUA, this.valle.terreno.alturaEn(p.x, p.z))) b = m;
          else a = m;
        }
        return p.copy(origin).addScaledVector(direction, b);
      }
      previo = t;
    }
    return null;
  }

  celdaBajoPuntero(evento: Puntero): { cx: number; cz: number } | null {
    this.apuntar(evento);
    const p = this.sueloBajoRayo();
    if (!p) return null;
    const c = this.valle.cuadricula.mundoACelda(p.x, p.z);
    return this.valle.cuadricula.dentro(c.cx, c.cz) ? c : null;
  }

  objetoBajoPuntero(evento: Puntero): { tipo: 'edificio' | 'figura'; id: string } | null {
    this.apuntar(evento);
    const v = this.valle;
    const suelo = this.sueloBajoRayo();
    const dSuelo = suelo ? suelo.distanceTo(this.rayo.ray.origin) : Infinity;
    let mejor: { tipo: 'edificio' | 'figura'; id: string } | null = null;
    let dMejor = dSuelo + 0.5;
    const lote = this.lotes.bajoRayo(this.rayo);
    if (lote && lote.distancia < dMejor && lote.etiqueta.tipo !== 'animal') {
      mejor = { tipo: lote.etiqueta.tipo, id: lote.etiqueta.id };
      dMejor = lote.distancia;
    }
    for (const t of this.rayo.intersectObjects(v.poblado.grupo.children, true)) {
      if (t.distance >= dMejor) break;
      const e = v.poblado.etiquetaDe(t.object);
      if (e && e.tipo === 'edificio') {
        mejor = { tipo: 'edificio', id: e.id };
        dMejor = t.distance;
        break;
      }
    }
    // Lo que no tiene bulto (caminos, campos) se reconoce por la celda.
    if (!mejor && suelo) {
      const c = v.cuadricula.mundoACelda(suelo.x, suelo.z);
      const id = v.cuadricula.ocupante(c.cx, c.cz) ?? v.poblado.caminoEn(c.cx, c.cz);
      if (id) mejor = { tipo: 'edificio', id };
    }
    return mejor;
  }

  // ───────────── figuras y animales ─────────────

  ponerFigura(d: DatosFigura): void {
    this.valle.figuras.poner(d);
  }

  moverFigura(id: string, cx: number, cz: number): boolean {
    return this.valle.figuras.mover(id, cx, cz);
  }

  colocarFigura(id: string, cx: number, cz: number): void {
    this.valle.figuras.colocar(id, cx, cz);
  }

  mirarFigura(id: string, cx: number, cz: number): void {
    this.valle.figuras.mirar(id, cx, cz);
  }

  quitarFigura(id: string): void {
    this.valle.figuras.quitar(id);
  }

  vaciarFiguras(): void {
    this.valle.figuras.vaciar();
  }

  posicionFigura(id: string): { x: number; y: number; z: number; cx: number; cz: number; andando: boolean } | null {
    return this.valle.figuras.posicion(id);
  }

  decir(id: string, texto: string, segundos = 5): void {
    this.valle.figuras.decir(id, texto, segundos);
  }

  ponerAnimales(tipo: TipoAnimal, cx: number, cz: number, n: number, radio?: number): void {
    this.valle.animales.poner(tipo, cx, cz, n, radio);
  }

  vaciarAnimales(): void {
    this.valle.animales.vaciar();
  }

  vaciar(): void {
    this.valle.poblado.vaciar();
    this.valle.figuras.vaciar();
    this.valle.animales.vaciar();
    this.valle.poblado.vistaPrevia(null);
  }

  // ───────────── tiempo y clima ─────────────

  fijarHora(hora: number | null): void {
    this.horaFijada = hora === null ? null : ((hora % 24) + 24) % 24;
    this.minutoAnunciado = -1;
  }

  fijarClima(tipo: TipoClima | null): void {
    this.climaReal.fijar(tipo);
  }

  fijarFecha(fecha: Date | null): void {
    this.fechaFijada = fecha;
    this.minutoAnunciado = -1;
  }

  fijarEstacion(estacion: Estacion | null): void {
    this.estacionFijada = estacion;
  }

  hora(): number {
    return horaDecimal(this.fechaActual, UBICACION.huso);
  }

  fecha(): Date {
    return new Date(this.fechaActual);
  }

  estacion(): Estacion {
    return this.estacionActual;
  }

  clima(): { tipo: TipoClima; origen: 'real' | 'simulado' | 'fijado'; temperatura: number | null; fijado: TipoClima | null } {
    const c = this.climaReal;
    return { tipo: c.tipo, origen: c.origen, temperatura: c.temperatura, fijado: c.fijadoAMano };
  }

  astros(): { solAltura: number; solRumbo: number; lunaAltura: number; lunaRumbo: number; lunaFase: number } {
    const a = this.astrosActuales;
    return { solAltura: a.solAltura, solRumbo: a.solRumbo, lunaAltura: a.lunaAltura, lunaRumbo: a.lunaRumbo, lunaFase: a.lunaFase };
  }

  private calcularFecha(): Date {
    const ahora = new Date();
    if (this.horaFijada !== null) return fechaConHora(this.fechaFijada ?? ahora, this.horaFijada, UBICACION.huso);
    if (this.fechaFijada) return fechaConHora(this.fechaFijada, horaDecimal(ahora, UBICACION.huso), UBICACION.huso);
    return ahora;
  }

  // ───────────── avisos ─────────────

  alCambiar<K extends keyof EventosMundo>(evento: K, fn: (datos: EventosMundo[K]) => void): () => void {
    let lista = this.oyentes.get(evento);
    if (!lista) {
      lista = new Set();
      this.oyentes.set(evento, lista);
    }
    const oyente = fn as (d: never) => void;
    lista.add(oyente);
    return () => lista.delete(oyente);
  }

  private emitir<K extends keyof EventosMundo>(evento: K, datos: EventosMundo[K]): void {
    for (const fn of this.oyentes.get(evento) ?? []) (fn as (d: EventosMundo[K]) => void)(datos);
  }

  info(): InfoMundo {
    return { ...this.ultimaInfo };
  }

  asentar(fotogramas = 6): Promise<void> {
    this.climaReal.actualizar(0, this.fechaActual, this.estacionActual, this.valle.camara.objetivo, this.lienzo.clientHeight, 1);
    this.climaReal.saltar();
    const meta = this.fotogramas + fotogramas;
    return new Promise((resolver) => {
      const mirar = () => {
        if (this.fotogramas >= meta || this.destruido) resolver();
        else requestAnimationFrame(mirar);
      };
      mirar();
    });
  }

  // ───────────── bucle ─────────────

  private ajustarTamano(): void {
    const ancho = this.lienzo.clientWidth || window.innerWidth;
    const alto = this.lienzo.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixeles);
    this.post.tamano(ancho, alto);
    this.valle.camara.tamano(ancho, alto);
  }

  private fotograma(ahora: number): void {
    if (this.destruido) return;
    this.marco = requestAnimationFrame((t) => this.fotograma(t));
    const dtReal = (ahora - this.ultimo) / 1000;
    this.ultimo = ahora;
    const dt = Math.min(0.1, Math.max(0, dtReal));
    GLOBALES.uTiempo.value += dt;
    const v = this.valle;

    // Hora, astros y estación.
    this.fechaActual = this.calcularFecha();
    this.astrosActuales = calcularAstros(this.fechaActual, UBICACION.latitud, UBICACION.longitud);
    const estacion = this.estacionFijada ?? estacionDe(this.fechaActual, UBICACION.latitud, UBICACION.huso);
    if (estacion !== this.estacionActual) {
      this.estacionActual = estacion;
      const paleta = PALETAS[estacion];
      v.terreno.fijarEstacion(paleta);
      v.vegetacion.fijarEstacion(paleta);
      v.poblado.fijarEstacion(estacion, paleta);
      this.emitir('estacion', { estacion });
    }
    const local = enHuso(this.fechaActual, UBICACION.huso);
    const minuto = local.hora * 60 + local.minuto;
    if (minuto !== this.minutoAnunciado) {
      this.minutoAnunciado = minuto;
      this.emitir('hora', { hora: local.hora + local.minuto / 60, fecha: new Date(this.fechaActual) });
    }

    v.camara.actualizar(dt);
    const camara = v.camara.camara;
    this.climaReal.actualizar(dt, this.fechaActual, estacion, v.camara.objetivo, this.lienzo.clientHeight * this.pixeles, this.cielo.ambiente.dia);
    this.cielo.actualizar(dt, this.astrosActuales, this.climaReal.estado, camara, v.camara.objetivo, v.camara.distancia);
    v.rio.uniformes.uCielo.value.copy(this.cielo.ambiente.horizonte);
    v.terreno.colorCascada.value.copy(this.cielo.ambiente.ambiente).multiplyScalar(0.55).lerp(v.rio.uniformes.uSomero.value, 0.45);
    for (const m of this.bib.emisivos) m.emissiveIntensity = 0.1 + 2.4 * this.cielo.ambiente.luces;
    v.rio.uniformes.uHielo.value = Math.max(0, this.climaReal.estado.nieve - 0.4) * 0.6;
    this.efectos.actualizar(dt, this.cielo.ambiente, v.camara.objetivo);
    v.poblado.actualizar(dt);
    v.figuras.actualizar(dt, camara, this.lienzo.clientWidth, this.lienzo.clientHeight);
    v.animales.actualizar(dt);
    v.terreno.actualizar();
    this.post.ajustar(this.cielo.ambiente);
    // De noche los bocadillos no deben deslumbrar.
    const brillo = (1 - 0.3 * this.cielo.ambiente.luces).toFixed(2);
    if (brillo !== this.brilloCapa) {
      this.brilloCapa = brillo;
      this.capa.style.filter = brillo === '1.00' ? '' : `brightness(${brillo})`;
    }

    // El compositor guarda la cámara con la que se creó: se le pasa la del valle en cada fotograma.
    this.camaraPost.copy(camara, false);
    this.camaraPost.updateMatrixWorld(true);
    this.renderer.info.reset();
    this.post.dibujar(dt);
    this.fotogramas++;

    // Medidas y calidad adaptativa: si no se llega a 50 fps, se baja la resolución un escalón.
    if (dtReal > 0 && dtReal < 1) this.fps += (1 / dtReal - this.fps) * 0.05;
    const inf = this.renderer.info;
    this.ultimaInfo = {
      fps: Math.round(this.fps),
      llamadas: inf.render.calls,
      triangulos: inf.render.triangles,
      geometrias: inf.memory.geometries,
      texturas: inf.memory.textures,
      pixeles: this.pixeles,
      edificios: v.poblado.lista().length,
      solAltura: Math.round(this.astrosActuales.solAltura * 10) / 10,
    };
    if (this.adaptativo && this.fotogramas > 90) {
      this.contados++;
      if (dtReal > 1 / 48) this.lentos++;
      if (this.contados >= 120) {
        if (this.lentos > 70 && this.pixeles > 1) {
          this.pixeles = Math.max(1, this.pixeles - 0.25);
          this.ajustarTamano();
        }
        this.contados = 0;
        this.lentos = 0;
      }
    }
  }

  destruir(): void {
    this.destruido = true;
    cancelAnimationFrame(this.marco);
    for (const fn of this.limpiar) fn();
    this.valle.camara.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}

/** Para saber de fuera qué huella ocupa un edificio ya girado. */
export function huellaDe(clave: string, rot = 0): [number, number] | null {
  const cat = edificioDeCatalogo(clave);
  return cat ? huella(cat, rot) : null;
}

/** Crea la escena sobre el lienzo y carga modelos y texturas. */
export async function crearMundo(lienzo: HTMLCanvasElement, opciones: OpcionesMundo = {}): Promise<Mundo> {
  const bib = new Biblioteca();
  const cargador = new THREE.TextureLoader();
  const textura = async (ruta: string, respaldo: number): Promise<THREE.Texture> => {
    try {
      return await cargador.loadAsync(ruta);
    } catch {
      // Sin la textura (los packs van fuera de git), un color liso.
      const datos = new Uint8Array([(respaldo >> 16) & 255, (respaldo >> 8) & 255, respaldo & 255, 255]);
      const t = new THREE.DataTexture(datos, 1, 1, THREE.RGBAFormat);
      t.needsUpdate = true;
      return t;
    }
  };
  const [hierba, mata] = await Promise.all([textura('texturas/hierba_flores.webp', 0x6a7833), textura('texturas/hierba_mata.webp', 0x6a7833), bib.cargar()]);
  return new MundoEscena(lienzo, bib, { hierba, mata }, opciones);
}
