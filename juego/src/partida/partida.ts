// La partida: la aldea de verdad, la que vive en el servidor del mundo. Esta vista sincroniza la escena
// (edificios, figuras, animales, hora y clima) con el estado del mundo y monta la interfaz del señor.
// Solo usa la fachada `Mundo` (docs/ESCENA.md) y la API (docs/API.md).
import './partida.css';
import { edificioDeCatalogo, huella } from '../datos';
import type { Mundo, TipoClima } from '../mundo';
import type { Vista } from '../vistas/vista';
import { api, ErrorMundo, escuchar, type Aldeano, type Comarca, type Config, type EscenaEstado, type Estado, type Evento, type RespuestaComarca } from './api';
import { Constructor } from './construir';
import { h } from './dom';
import { Hud, tituloDe } from './hud';
import { MapaComarca } from './mapa';
import { Paneles } from './paneles';
import { TarjetaTutorial } from './tutorial';
import { Sonido } from '../sonido/sonido';

const CLAVE_ALDEA = 'pedrafonte.aldea';
const REFRESCO_MS = 45_000;
const PAUSA_FRASE_MS = 3800;
const DESPLAZAMIENTOS: [number, number][] = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2]];

export interface OpcionesPartida {
  /**
   * Panel que se abre al entrar (para las capturas): construir, consejo, leyes, cartas, mercader, pergamino, bitacora,
   * aldeas, ficha, hueste o mapa. El mapa admite un territorio y un objetivo: `mapa:meiras` abre su ficha y
   * `mapa:meiras:someter`, el compositor de campaña.
   */
  panel?: string | null;
  /** No abrir el pergamino solo al entrar. */
  sinPergamino?: boolean;
  /** Entrar en esta aldea en vez de en la última visitada. */
  aldea?: number | null;
}

export class Partida {
  readonly raiz = h('div', { class: 'partida' });
  readonly hud: Hud;
  readonly paneles: Paneles;
  readonly constructor_: Constructor;
  readonly tutorial: TarjetaTutorial;
  readonly mapa: MapaComarca;
  readonly sonido = new Sonido();
  config: Config | null = null;
  estado: Estado | null = null;
  /** El mapa de la comarca tal como se pidió la última vez (lo usan el mapa y el panel «Hueste»). */
  comarca: Comarca | null = null;
  aldeaId = 0;

  private readonly lienzo = document.getElementById('lienzo') as HTMLCanvasElement;
  private readonly avisos = h('div', { class: 'avisos', role: 'status', 'aria-live': 'polite' });
  private dejarDeEscuchar: (() => void) | null = null;
  private relojRefresco = 0;
  private relojAmbiente = 0;
  private relojPendiente = 0;
  private desmontada = false;
  private readonly destinos = new Map<string, string>();
  private readonly figuras = new Set<string>();
  private firmaAnimales = '';
  private desfasePuesto = -1;
  private climaPuesto = '';
  private colaFrases: { id: string; texto: string }[] = [];
  private hablando = false;
  private readonly limpiar: (() => void)[] = [];

  constructor(readonly mundo: Mundo, private readonly interfaz: HTMLElement, private readonly opciones: OpcionesPartida = {}) {
    this.hud = new Hud(this);
    this.paneles = new Paneles(this);
    this.constructor_ = new Constructor(this);
    this.tutorial = new TarjetaTutorial(this);
    this.mapa = new MapaComarca(this);
    this.raiz.append(this.hud.el, this.constructor_.el, this.tutorial.el, this.paneles.el, this.mapa.el, this.avisos);
    this.interfaz.append(this.raiz);
    this.escucharPuntero();
    let ultimaHora = Math.floor(mundo.hora());
    this.limpiar.push(mundo.alCambiar('hora', ({ hora }) => {
      if (Math.floor(hora) === ultimaHora) return;
      ultimaHora = Math.floor(hora);
      this.refrescarPronto();
    }));
    void this.arrancar();
  }

  // ───────────── arranque y cierre ─────────────

  private async arrancar(): Promise<void> {
    try {
      this.config = await api.config();
      const aldeas = await api.aldeas();
      const guardada = this.opciones.aldea ?? Number(localStorage.getItem(CLAVE_ALDEA));
      this.aldeaId = aldeas.find((a) => a.id === guardada)?.id ?? aldeas[0].id;
      await this.entrar(this.aldeaId, true);
    } catch (e) {
      this.avisar(mensajeDe(e), 'mal', 12);
    }
  }

  /** Entra en una aldea (al arrancar o al cambiar de aldea). */
  async entrar(id: number, primera = false): Promise<void> {
    this.dejarDeEscuchar?.();
    this.aldeaId = id;
    localStorage.setItem(CLAVE_ALDEA, String(id));
    this.comarca = null;
    this.tutorial.reiniciar();
    this.mapa.cerrar();
    this.mundo.vaciar();
    this.figuras.clear();
    this.destinos.clear();
    this.firmaAnimales = '';
    this.desfasePuesto = -1;
    this.climaPuesto = '';
    this.colaFrases = [];
    let estado = await api.estado(id);
    if (this.desmontada) return;
    // Si la hora que se ve no es la real (deslizador o capturas), se piden los vecinos de esa hora.
    const vista = Math.floor(this.mundo.hora()) % 24;
    if (vista !== estado.tiempo.hora) estado = await api.estado(id, vista);
    if (this.mundo.paisaje() !== estado.aldea.paisaje) {
      this.mundo.cargarPaisaje(estado.aldea.paisaje);
      const ini = this.mundo.datosPaisaje().inicio;
      this.mundo.camara.fijar({ ...this.mundo.celdaAMundo(ini.hoguera[0], ini.hoguera[1]), distancia: 52 }, true);
    }
    this.aplicar(estado, true);
    this.dejarDeEscuchar = escuchar(id, (eventos) => this.alLlegar(eventos));
    window.clearInterval(this.relojRefresco);
    this.relojRefresco = window.setInterval(() => void this.refrescar(), REFRESCO_MS);
    window.clearInterval(this.relojAmbiente);
    this.relojAmbiente = window.setInterval(() => this.ambiente(), 30_000);
    const panel = primera ? this.opciones.panel : null;
    if (panel) {
      this.paneles.abrirPorNombre(panel);
    } else if (estado.gobierno.perdida) {
      this.paneles.abrirFin();
    } else if (estado.pergamino.pendiente && !this.opciones.sinPergamino) {
      void this.paneles.abrirPergamino();
    }
    if (estado.escenas.length) window.setTimeout(() => this.representar(estado.escenas[estado.escenas.length - 1]), 2500);
  }

  desmontar(): void {
    this.desmontada = true;
    this.dejarDeEscuchar?.();
    window.clearInterval(this.relojRefresco);
    window.clearInterval(this.relojAmbiente);
    window.clearTimeout(this.relojPendiente);
    for (const fn of this.limpiar) fn();
    this.mapa.cerrar();
    this.hud.desmontar();
    this.constructor_.cancelar();
    this.sonido.parar();
    this.mundo.fijarFecha(null);
    this.mundo.fijarClima(null);
    this.titular('Pedrafonte');
    this.raiz.remove();
  }

  // ───────────── estado ─────────────

  async refrescar(): Promise<void> {
    if (this.desmontada || !this.aldeaId) return;
    try {
      this.aplicar(await api.estado(this.aldeaId, this.horaVista()));
    } catch (e) {
      if (e instanceof ErrorMundo && e.codigo === 0) this.avisar(e.message, 'mal');
    }
  }

  /** Si el jugador ha movido el deslizador de hora, los vecinos se enseñan donde estarían a esa hora. */
  private horaVista(): number | undefined {
    const vista = Math.floor(this.mundo.hora()) % 24;
    return this.estado && vista !== this.estado.tiempo.hora ? vista : undefined;
  }

  /** Refresco aplazado: junta varios eventos seguidos en una sola petición. */
  refrescarPronto(): void {
    window.clearTimeout(this.relojPendiente);
    this.relojPendiente = window.setTimeout(() => void this.refrescar(), 350);
  }

  /** Pinta el estado del mundo en la escena y en la interfaz. */
  aplicar(estado: Estado, primera = false): void {
    if (this.desmontada) return;
    const antes = this.estado;
    this.estado = estado;
    this.sincronizarEdificios(estado);
    this.sincronizarGente(estado, primera);
    this.sincronizarAnimales(estado);
    // La fecha del juego es la real más los días adelantados; la hora, siempre la real.
    // Solo se toca cuando cambia: así la previsualización de hora y clima del panel no se pisa a cada refresco.
    const desfase = estado.tiempo.desfase_dias;
    if (desfase !== this.desfasePuesto) {
      this.desfasePuesto = desfase;
      this.mundo.fijarFecha(desfase ? new Date(Date.now() + desfase * 86_400_000) : null);
    }
    if (estado.clima.tipo !== this.climaPuesto) {
      this.climaPuesto = estado.clima.tipo;
      this.mundo.fijarClima(estado.clima.tipo as TipoClima);
    }
    this.sonido.ambientar({ clima: estado.clima.tipo, noche: ['noche', 'anochecer'].includes(estado.tiempo.franja), vecinos: estado.poblacion.vecinos });
    this.titular(estado.aldea.nombre, estado.guerra.titulo);
    this.hud.pintar(estado);
    this.constructor_.pintar();
    this.tutorial.pintar(estado, antes);
    this.paneles.alCambiarEstado(estado);
    this.mapa.alCambiarEstado();
    if (estado.gobierno.perdida && !antes?.gobierno.perdida && !primera) this.paneles.abrirFin();
  }

  private sincronizarEdificios(estado: Estado): void {
    const quiero = new Map(estado.edificios.map((e) => [`e${e.id}`, e]));
    for (const puesto of this.mundo.edificios()) {
      const e = quiero.get(puesto.id);
      if (!e || e.clave !== puesto.clave || e.cx !== puesto.cx || e.cz !== puesto.cz || e.rot !== puesto.rot) {
        this.mundo.quitarEdificio(puesto.id);
      } else {
        quiero.delete(puesto.id);
      }
    }
    for (const [id, e] of quiero) this.mundo.ponerEdificio({ id, clave: e.clave, cx: e.cx, cz: e.cz, rot: e.rot });
  }

  private sincronizarGente(estado: Estado, primera: boolean): void {
    const ocupadas = new Map<string, number>();
    const presentes = new Set<string>();
    const entrada = this.mundo.datosPaisaje().camino[0]?.[0] ?? [0, 28];
    for (const a of estado.aldeanos) {
      const id = `v${a.id}`;
      // De noche, quien tiene casa duerme dentro: la figura desaparece y se enciende la ventana.
      if (a.sitio?.actividad === 'dormir' && a.casa_id !== null) continue;
      presentes.add(id);
      const [cx, cz] = this.hueco(a.sitio?.cx ?? entrada[0], a.sitio?.cz ?? entrada[1], ocupadas);
      const destino = `${cx},${cz}`;
      if (!this.figuras.has(id)) {
        this.mundo.ponerFigura({ id, nombre: a.nombre, oficio: a.oficio });
        this.figuras.add(id);
        if (primera || a.sitio?.actividad === 'casa') {
          this.mundo.colocarFigura(id, cx, cz);
        } else {
          // Recién llegado (o recién levantado): aparece por el camino y viene andando.
          const casa = estado.edificios.find((e) => e.id === a.casa_id);
          const [ox, oz] = casa ? [casa.cx, casa.cz + 3] : entrada;
          this.mundo.colocarFigura(id, ox, oz);
          if (!this.mundo.moverFigura(id, cx, cz)) this.mundo.colocarFigura(id, cx, cz);
        }
      } else if (this.destinos.get(id) !== destino) {
        if (!this.mundo.moverFigura(id, cx, cz)) this.mundo.colocarFigura(id, cx, cz);
      }
      this.destinos.set(id, destino);
    }
    // El señor: delante de su casona si la tiene; si no, junto a la lumbre.
    const casona = estado.edificios.find((e) => e.clave === 'casa_senor');
    const ini = this.mundo.datosPaisaje().inicio;
    const ficha = casona ? edificioDeCatalogo('casa_senor') : undefined;
    const [ancho, fondo] = ficha && casona ? huella(ficha, casona.rot) : [0, 0];
    const [sx, sz] = casona ? [casona.cx + Math.floor(ancho / 2), casona.cz + fondo] : ini.senor;
    presentes.add('senor');
    if (!this.figuras.has('senor')) {
      this.mundo.ponerFigura({ id: 'senor', nombre: 'El señor', oficio: 'senor', esSenor: true });
      this.figuras.add('senor');
      this.mundo.colocarFigura('senor', sx, sz);
    } else if (this.destinos.get('senor') !== `${sx},${sz}`) {
      if (!this.mundo.moverFigura('senor', sx, sz)) this.mundo.colocarFigura('senor', sx, sz);
    }
    this.destinos.set('senor', `${sx},${sz}`);
    // Mercaderes y viajeros de paso.
    for (const v of estado.visitantes) {
      const id = `vis${v.id}`;
      presentes.add(id);
      if (this.figuras.has(id)) continue;
      const [cx, cz] = this.hueco(v.cx ?? ini.senor[0] + 2, v.cz ?? ini.senor[1] + 2, ocupadas);
      this.mundo.ponerFigura({ id, nombre: v.nombre, oficio: v.tipo === 'juglar' ? 'juglar' : 'forastero' });
      this.figuras.add(id);
      if (primera) {
        this.mundo.colocarFigura(id, cx, cz);
      } else {
        this.mundo.colocarFigura(id, entrada[0], entrada[1]);
        if (!this.mundo.moverFigura(id, cx, cz)) this.mundo.colocarFigura(id, cx, cz);
      }
    }
    for (const id of [...this.figuras]) {
      if (!presentes.has(id)) {
        this.mundo.quitarFigura(id);
        this.figuras.delete(id);
        this.destinos.delete(id);
      }
    }
  }

  /** La cartela de arriba lleva el nombre de la aldea en la que se está y, encima, el título que se ha ganado el señor. */
  private titular(nombre: string, rango = ''): void {
    const titulo = document.querySelector('.cartela .pergamino-titulo');
    const completo = rango ? tituloDe(rango, nombre) : nombre;
    if (titulo && titulo.getAttribute('data-titulo') !== completo) {
      titulo.setAttribute('data-titulo', completo);
      titulo.replaceChildren(...(rango ? [h('span', { class: 'rango' }, / de /.test(rango) ? rango : `${rango} de`), nombre] : [nombre]));
    }
    document.title = completo;
  }

  // ───────────── la comarca (mapa y hueste) ─────────────

  /** Pide el mapa de la comarca al mundo y lo reparte entre quien lo esté enseñando. */
  async cargarComarca(): Promise<Comarca | null> {
    const id = this.aldeaId;
    const comarca = await this.orden(() => api.comarca(id, this.mapa.abierto));
    if (!comarca || this.desmontada || id !== this.aldeaId) return null;
    this.comarca = comarca;
    this.mapa.alCambiarComarca();
    this.paneles.alCambiarComarca();
    return comarca;
  }

  /** Lo que devuelve una orden de la comarca (alistar, embajada, campaña): mapa y estado ya cambiados. */
  aplicarComarca(r: RespuestaComarca): void {
    this.comarca = r.mundo;
    this.aplicar(r.estado); // de paso repinta el mapa y el panel «Hueste», que ya ven la comarca nueva
  }

  /** Al cerrarse el mapa, vuelve a marcarse en la botonera lo que siguiera abierto debajo. */
  remarcar(): void {
    this.hud.marcarActivo(this.constructor_.abierto ? 'construir' : this.paneles.nombreAbierto);
  }

  /** Al abrirse o cerrarse el panel lateral: el tutorial se aparta para no pisarlo. */
  alCambiarPanel(abierto: boolean): void {
    this.raiz.classList.toggle('con-panel', abierto);
    this.tutorial.alCambiarPanel(abierto);
  }

  /** Busca una celda libre junto a la pedida para que las figuras no se monten unas sobre otras. */
  private hueco(cx: number, cz: number, ocupadas: Map<string, number>): [number, number] {
    const n = this.mundo.datosPaisaje().celdas;
    for (const [dx, dz] of DESPLAZAMIENTOS) {
      const x = cx + dx;
      const z = cz + dz;
      const clave = `${x},${z}`;
      if (ocupadas.has(clave) || x < 0 || z < 0 || x >= n || z >= n) continue;
      if (dx || dz) {
        const tipo = this.mundo.tipoCelda(x, z);
        if (tipo === 'agua' || this.mundo.ocupante(x, z)) continue;
      }
      ocupadas.set(clave, 1);
      return [x, z];
    }
    return [cx, cz];
  }

  private sincronizarAnimales(estado: Estado): void {
    const corrales = estado.edificios.filter((e) => e.clave === 'redil' || e.clave === 'gallinero');
    const firma = corrales.map((e) => `${e.id}:${e.cx},${e.cz},${e.rot}`).join('|') + `#${estado.aldea.id}`;
    if (firma === this.firmaAnimales) return;
    this.firmaAnimales = firma;
    this.mundo.vaciarAnimales();
    for (const e of corrales) {
      const ficha = edificioDeCatalogo(e.clave);
      if (!ficha) continue;
      const [ancho, fondo] = huella(ficha, e.rot);
      const cx = e.cx + (ancho - 1) / 2;
      const cz = e.cz + (fondo - 1) / 2;
      if (e.clave === 'redil') this.mundo.ponerAnimales('oveja', cx, cz, 5, 1.6);
      else this.mundo.ponerAnimales('gallina', cx, cz, 4, 0.9);
    }
    const ini = this.mundo.datosPaisaje().inicio;
    this.mundo.ponerAnimales('perro', ini.hoguera[0] + 2, ini.hoguera[1] + 2, 1, 4);
  }

  // ───────────── lo que pasa en directo ─────────────

  private alLlegar(eventos: Evento[]): void {
    let refrescar = false;
    let comarca = false;
    for (const e of eventos) {
      if (e.tipo === 'escena') {
        this.representar(e as unknown as EscenaEstado);
      } else if (e.tipo === 'suceso') {
        const clase = String(e['clase'] ?? '');
        // Las lecciones aprendidas las anuncia el tutorial, con su premio.
        // Lo que se acaba de ordenar desde el mapa (embajada, salida de la hueste) ya se lee en el propio mapa.
        const yaDicho = this.mapa.reciente && (clase === 'guerra' || clase === 'vecinos');
        if (!yaDicho && !['obra', 'consejo', 'comercio', 'tutorial'].includes(clase)) this.avisar(String(e['texto'] ?? ''), clase === 'amenaza' || clase === 'revuelta' ? 'mal' : '', 9);
        this.paneles.alLlegarSuceso();
        refrescar = true;
      } else if (e.tipo === 'tutorial') {
        this.tutorial.alLlegarEvento(e);
        refrescar = true;
      } else if (e.tipo === 'guerra' || e.tipo === 'amenaza' || e.tipo === 'cierre') {
        // Lo que cambia el mapa: si alguien lo está mirando (mapa o hueste), se vuelve a pedir.
        comarca = true;
        refrescar = true;
      } else if (e.tipo !== 'hora' || Number(e['hora']) !== this.estado?.tiempo.hora) {
        refrescar = true;
      }
    }
    if (refrescar) this.refrescarPronto();
    if (comarca && (this.mapa.abierto || this.paneles.enHueste)) void this.cargarComarca();
  }

  /** Pone en bocadillos el diálogo de una escena, frase a frase. */
  representar(escena: EscenaEstado): void {
    for (const linea of escena.dialogo) this.colaFrases.push({ id: `v${linea.quien}`, texto: linea.texto });
    if (!this.hablando) this.siguienteFrase();
  }

  private siguienteFrase(): void {
    const frase = this.colaFrases.shift();
    if (!frase || this.desmontada) {
      this.hablando = false;
      return;
    }
    this.hablando = true;
    if (this.figuras.has(frase.id)) {
      this.mundo.decir(frase.id, frase.texto, 5);
      this.sonido.efecto('voz');
    }
    window.setTimeout(() => this.siguienteFrase(), this.figuras.has(frase.id) ? PAUSA_FRASE_MS : 50);
  }

  /** De vez en cuando se repite alguna escena reciente, para que la aldea no esté muda entre horas. */
  private ambiente(): void {
    if (this.hablando || !this.estado?.escenas.length || document.hidden) return;
    const posibles = this.estado.escenas.filter((e) => e.participantes.every((p) => this.figuras.has(`v${p}`)));
    if (posibles.length) this.representar(posibles[Math.floor(Math.random() * posibles.length)]);
  }

  // ───────────── puntero ─────────────

  private escucharPuntero(): void {
    const mover = (ev: PointerEvent) => this.constructor_.alMover(ev);
    const soltar = (ev: PointerEvent) => {
      if (ev.button !== 0 || this.mundo.camara.huboArrastre()) return;
      if (this.constructor_.alPulsar(ev)) return;
      const objeto = this.mundo.objetoBajoPuntero(ev);
      if (!objeto) {
        this.paneles.cerrarSiEsFicha();
        return;
      }
      if (objeto.tipo === 'figura') {
        if (objeto.id.startsWith('vis')) this.paneles.abrirMercader();
        else if (objeto.id.startsWith('v')) void this.paneles.abrirFicha(Number(objeto.id.slice(1)));
        else this.avisar('Sois vos, el señor de la aldea. Buena planta, dicho sea sin adular.');
      } else if (objeto.id.startsWith('e')) {
        this.paneles.abrirEdificio(Number(objeto.id.slice(1)));
      }
    };
    const tecla = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (ev.key === 'Escape') {
        if (this.mapa.abierto) this.mapa.atras();
        else if (!this.constructor_.cancelar()) this.paneles.cerrar();
      } else if (this.mapa.abierto) {
        if (ev.key === 'm' || ev.key === 'M') this.mapa.cerrar();
      } else if ((ev.key === 'm' || ev.key === 'M') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        void this.mapa.abrir();
      } else {
        this.constructor_.alTeclear(ev);
      }
    };
    this.lienzo.addEventListener('pointermove', mover);
    this.lienzo.addEventListener('pointerup', soltar);
    window.addEventListener('keydown', tecla);
    this.limpiar.push(() => {
      this.lienzo.removeEventListener('pointermove', mover);
      this.lienzo.removeEventListener('pointerup', soltar);
      window.removeEventListener('keydown', tecla);
    });
  }

  // ───────────── utilidades para la interfaz ─────────────

  /** Aviso breve abajo (errores del motor, sucesos). */
  avisar(texto: string, clase = '', segundos = 6): void {
    if (!texto) return;
    const aviso = h('div', { class: `pergamino aviso-partida ${clase}` }, texto);
    this.avisos.append(aviso);
    while (this.avisos.children.length > 3) this.avisos.firstElementChild?.remove();
    window.setTimeout(() => aviso.remove(), segundos * 1000);
  }

  /** Ejecuta una orden al mundo; si el motor dice que no, lo enseña. Devuelve undefined si falló. */
  async orden<T>(accion: () => Promise<T>): Promise<T | undefined> {
    try {
      return await accion();
    } catch (e) {
      this.avisar(mensajeDe(e), 'mal');
      this.sonido.efecto('no');
      return undefined;
    }
  }

  aldeano(id: number): Aldeano | undefined {
    return this.estado?.aldeanos.find((a) => a.id === id);
  }
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** La vista «Aldea»: la partida conectada al mundo. */
export function crearVistaPartida(interfaz: HTMLElement, opciones: OpcionesPartida = {}): Vista {
  return {
    clave: 'partida',
    nombre: 'Aldea',
    montar(mundo) {
      mundo.vaciar();
      const partida = new Partida(mundo, interfaz, opciones);
      (window as unknown as { __partida?: Partida }).__partida = partida;
      return () => partida.desmontar();
    },
    camara(mundo) {
      const ini = mundo.datosPaisaje().inicio;
      const { x, z } = mundo.celdaAMundo(ini.hoguera[0] - 0.5, ini.hoguera[1] - 0.5);
      return { x, z, azimut: -28, elevacion: 34, distancia: 52 };
    },
  };
}
