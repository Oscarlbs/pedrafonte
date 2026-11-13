// El mapa de la comarca: un pergamino grande con los ocho territorios vecinos, los caminos, vuestra hueste
// y la que venga. Al pinchar un territorio sale su ficha, con las embajadas y el compositor de campaña.
// Todo lo que se pinta y se puede hacer viene del mundo (`GET /mundo`, docs/API.md); aquí no se decide nada.
import { api, ErrorMundo, type AccionEmbajada, type Comarca, type ObjetivoCampana, type Territorio, type Tropas } from './api';
import { cifra, dias, h, mayuscula, textoCoste, vaciar } from './dom';
import { tituloDe } from './hud';
import type { Partida } from './partida';
import { fuerzaTropas, NOMBRE_OBJETIVO, textoTropas, totalTropas } from './tropa';

type P = [number, number];
type Situacion = 'vuestro' | 'aliado' | 'hostil' | 'neutral';

// Las coordenadas del mundo van de 0 a 100 en los dos ejes. El lienzo mide siempre 100 de alto y de ancho lo
// que pida el hueco que haya (entre 115 y 160): la x se estira para que el mapa llene el pergamino.
const ALTO = 100;
const n = (v: number) => String(Math.round(v * 100) / 100);
/** El terreno está dibujado pensando en un lienzo de 140 de ancho; así se guarda en coordenadas del mundo. */
const deBoceto = (puntos: P[]): P[] => puntos.map(([x, y]) => [x / 1.4, y]);

const NOMBRE_TIPO: Record<Territorio['tipo'], string> = {
  aldea: 'Aldea', torre: 'Torre', abadia: 'Abadía', villa: 'Villa', puerto: 'Puerto', castillo: 'Castillo', burgo: 'Burgo',
};
const OBJETIVOS: ObjetivoCampana[] = ['saquear', 'someter', 'conquistar'];
const LEYENDA: [Situacion, string][] = [['vuestro', 'Vuestro'], ['aliado', 'Aliado'], ['hostil', 'Hostil'], ['neutral', 'Ni fu ni fa']];

function situacion(t: Territorio): { clase: Situacion; texto: string } {
  if (t.estado === 'conquistado') return { clase: 'vuestro', texto: 'Plaza vuestra, con guarnición' };
  if (t.estado === 'vasallo') return { clase: 'vuestro', texto: 'Vasallo vuestro' };
  if (t.aliado) return { clase: 'aliado', texto: 'Aliado' };
  if (t.hostil) return { clase: 'hostil', texto: 'Hostil: os tiene ojeriza' };
  return { clase: 'neutral', texto: 'Señor libre' };
}

function lanzas(t: Territorio): string {
  return t.fuerza_exacta ? `${t.fuerza} lanzas` : `unas ${t.fuerza} lanzas`;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/**
 * Un rótulo del mapa. El lienzo mide 100 de alto, así que las letras medirían dos o tres unidades: con cuerpos
 * tan pequeños Chrome se lía con los glifos (pinta una letra por otra). Por eso cada texto va en su propio
 * sistema diez veces menor y el cuerpo se da en la hoja de estilos diez veces mayor.
 */
function rotulo(clase: string, x: number, y: number, texto: string): string {
  return `<text class="${clase}" transform="translate(${n(x)},${n(y)}) scale(0.1)">${escapar(texto)}</text>`;
}

// ───────────────────────── geometría ─────────────────────────

/** Curva suave que pasa por todos los puntos (Catmull-Rom pasada a Bézier). */
function curva(p: P[]): string {
  let d = `M${n(p[0][0])},${n(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)},${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)},${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])},${n(p2[1])}`;
  }
  return d;
}

/** Un camino entre dos lugares: algo torcido, como los de verdad. Devuelve los puntos por los que pasa. */
function tramo(a: P, b: P, indice: number): P[] {
  const k = (indice % 2 ? 1 : -1) * 0.09;
  const c: P = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * k, (a[1] + b[1]) / 2 + (b[0] - a[0]) * k];
  const puntos: P[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const u = 1 - t;
    puntos.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return puntos;
}

function largo(puntos: P[]): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += Math.hypot(puntos[i][0] - puntos[i - 1][0], puntos[i][1] - puntos[i - 1][1]);
  return total;
}

/** El punto que queda a la fracción `f` (0–1) del recorrido. */
function puntoEn(puntos: P[], f: number): P {
  let falta = largo(puntos) * Math.min(1, Math.max(0, f));
  for (let i = 1; i < puntos.length; i++) {
    const paso = Math.hypot(puntos[i][0] - puntos[i - 1][0], puntos[i][1] - puntos[i - 1][1]);
    if (falta <= paso && paso > 0) {
      const t = falta / paso;
      return [puntos[i - 1][0] + (puntos[i][0] - puntos[i - 1][0]) * t, puntos[i - 1][1] + (puntos[i][1] - puntos[i - 1][1]) * t];
    }
    falta -= paso;
  }
  return puntos[puntos.length - 1];
}

/** Los caminos de la comarca, ya dibujables, y la ruta más corta de la aldea a cada lugar. */
class Red {
  private readonly tramos = new Map<string, P[]>();
  private readonly vecinos = new Map<string, string[]>();

  constructor(readonly sitios: Map<string, P>, caminos: [string, string][]) {
    caminos.forEach(([a, b], i) => {
      const pa = sitios.get(a);
      const pb = sitios.get(b);
      if (!pa || !pb) return;
      this.tramos.set(`${a}|${b}`, tramo(pa, pb, i));
      this.vecinos.set(a, [...(this.vecinos.get(a) ?? []), b]);
      this.vecinos.set(b, [...(this.vecinos.get(b) ?? []), a]);
    });
  }

  dibujos(): P[][] {
    return [...this.tramos.values()];
  }

  private entre(a: string, b: string): P[] {
    const ida = this.tramos.get(`${a}|${b}`);
    if (ida) return ida;
    return [...(this.tramos.get(`${b}|${a}`) ?? [])].reverse();
  }

  /** Por dónde se va de la aldea a `destino` siguiendo los caminos (en línea recta si no hay camino). */
  ruta(destino: string): P[] {
    const coste = new Map<string, number>([['aldea', 0]]);
    const previo = new Map<string, string>();
    const pendientes = new Set(this.sitios.keys());
    while (pendientes.size) {
      let actual: string | null = null;
      for (const s of pendientes) if (coste.has(s) && (actual === null || coste.get(s)! < coste.get(actual)!)) actual = s;
      if (actual === null || actual === destino) break;
      pendientes.delete(actual);
      for (const otro of this.vecinos.get(actual) ?? []) {
        const nuevo = coste.get(actual)! + largo(this.entre(actual, otro));
        if (nuevo < (coste.get(otro) ?? Infinity)) {
          coste.set(otro, nuevo);
          previo.set(otro, actual);
        }
      }
    }
    const origen = this.sitios.get('aldea');
    const fin = this.sitios.get(destino);
    if (!origen || !fin) return [];
    if (!previo.has(destino)) return [origen, fin];
    const nodos = [destino];
    while (nodos[0] !== 'aldea') nodos.unshift(previo.get(nodos[0])!);
    const puntos: P[] = [];
    for (let i = 1; i < nodos.length; i++) puntos.push(...this.entre(nodos[i - 1], nodos[i]).slice(i === 1 ? 0 : 1));
    return puntos;
  }
}

// ───────────────────────── dibujo: terreno ─────────────────────────

const RIO = deBoceto([[78, -3], [73, 10], [69, 20], [69.5, 29], [73, 40], [77, 51], [80, 60], [77, 68], [68, 75], [55, 81], [42, 86], [30, 91.5]]);
const COSTA = deBoceto([[-3, 58], [6, 66], [10, 74], [13, 80], [17, 86], [24, 90], [33, 93], [44, 103]]);
const MONTES: [number, number, number][] = ([
  [104, 10, 1.1], [110.5, 7, 1.35], [124, 8, 1.2], [131, 13, 1], [134, 26, 0.9], [86, 11, 0.9], [92, 15, 0.75],
  [12, 38, 1.2], [18.5, 33, 1], [7, 47, 1], [14, 53, 0.85], [45, 38, 0.8], [6, 8, 1], [44, 8, 0.9],
] as [number, number, number][]).map(([x, y, s]) => [x / 1.4, y, s]);
const BOSQUES = deBoceto([
  [36, 62], [39, 59.5], [42, 62.5], [33, 65.5], [37.5, 66],
  [85, 59.5], [88, 62.5], [91, 59.5], [88.5, 57],
  [108, 84], [111, 87], [114, 83.5], [105, 88], [118, 88], [112, 91],
  [51, 9], [54, 12], [48, 12.5], [57, 8],
  [22, 60], [25, 63], [19, 63.5], [28, 59.5],
  [126, 52], [129, 55], [123, 56], [131, 49.5], [127, 60],
  [58, 44], [55, 47], [59, 49],
]);
const OLAS = deBoceto([[4, 77], [9, 88], [3, 93], [17, 95], [28, 97.5], [11, 98], [20, 92]]);

function monte([x, y, s]: [number, number, number]): string {
  const cara = `M${n(x - 3.2 * s)},${n(y)} L${n(x)},${n(y - 4.4 * s)} L${n(x + 3.2 * s)},${n(y)}`;
  const sombra = `M${n(x)},${n(y - 4.4 * s)} L${n(x + 0.9 * s)},${n(y - 2 * s)} L${n(x + 0.3 * s)},${n(y - 1.5 * s)} L${n(x + 1.1 * s)},${n(y)}`;
  const rayas = [0.9, 1.7, 2.5].map((dx) => `M${n(x + dx * s)},${n(y - (3.2 - dx) * 1.2 * s)} L${n(x + (dx + 0.5) * s)},${n(y - 0.2 * s)}`).join(' ');
  return `<path class="monte" d="${cara}"/><path class="monte-raya" d="${sombra} ${rayas}"/>`;
}

function arbol([x, y]: P, i: number): string {
  if (i % 3 === 2) return `<path class="arbol" d="M${n(x)},${n(y)} v-0.9 M${n(x - 1.1)},${n(y - 0.8)} L${n(x)},${n(y - 3.4)} L${n(x + 1.1)},${n(y - 0.8)} Z"/>`;
  return `<path class="arbol" d="M${n(x)},${n(y)} v-1.2"/><circle class="arbol" cx="${n(x)}" cy="${n(y - 2.1)}" r="${i % 2 ? 1.25 : 1.05}"/>`;
}

const definiciones = (ancho: number) => `
  <defs>
    <clipPath id="mapa-marco"><rect x="0" y="0" width="${n(ancho)}" height="${ALTO}"/></clipPath>
    <filter id="mapa-mano" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="ruido"/>
      <feDisplacementMap in="SourceGraphic" in2="ruido" scale="0.55"/>
    </filter>
    <radialGradient id="mapa-papel" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#fbf1d6"/><stop offset="0.7" stop-color="#f0deb4"/><stop offset="1" stop-color="#dcc38e"/>
    </radialGradient>
  </defs>`;

/** Lo que no cambia: papel, mar, río, montes, bosques y rosa de los vientos. `fx` es cuánto se estira la x. */
function terreno(fx: number): string {
  const ancho = 100 * fx;
  const x = (puntos: P[]): P[] => puntos.map(([px, py]) => [px * fx, py]);
  const costa = curva(x(COSTA));
  const rio = curva(x(RIO));
  const mar = `${costa} L-3,103 Z`;
  const olas = x(OLAS).map(([ox, oy]) => `M${n(ox)},${n(oy)} q0.8,-0.8 1.6,0 t1.6,0`).join(' ');
  const rosa = `<g class="rosa" transform="translate(${n(ancho - 12)},86)">
    <circle r="5.2"/><circle r="3.6"/>
    <path class="rosa-punta" d="M0,-7.2 L1.1,-1.1 L7.2,0 L1.1,1.1 L0,7.2 L-1.1,1.1 L-7.2,0 L-1.1,-1.1 Z"/>
    <path class="rosa-media" d="M0,-7.2 L0,7.2 M-7.2,0 L7.2,0"/>
    ${rotulo('rosa-norte', 0, -8.2, 'N')}
  </g>`;
  return `${definiciones(ancho)}
    <rect class="papel" x="0" y="0" width="${n(ancho)}" height="${ALTO}"/>
    <g clip-path="url(#mapa-marco)"><g filter="url(#mapa-mano)">
      <path class="mar" d="${mar}"/>
      <path class="orilla" d="${costa}"/>
      <path class="ola" d="${olas}"/>
      <path class="rio-borde" d="${rio}"/>
      <path class="rio" d="${rio}"/>
      ${MONTES.map(([mx, my, ms]) => monte([mx * fx, my, ms])).join('')}
      ${x(BOSQUES).map(arbol).join('')}
    </g></g>
    ${rotulo('rotulo-agua', 3.2 * fx, 96.2, 'La mar')}
    ${rotulo('rotulo-agua', 56.5 * fx, 37, 'río Ouro')}
    ${rosa}
    <rect class="orla" x="1.2" y="1.2" width="${n(ancho - 2.4)}" height="${ALTO - 2.4}"/>
    <rect class="orla fina" x="2.1" y="2.1" width="${n(ancho - 4.2)}" height="${ALTO - 4.2}"/>`;
}

// ───────────────────────── dibujo: lugares ─────────────────────────

const casita = (x: number, w: number, pared: number, tejado: number) =>
  `M${n(x - w / 2)},0 v${n(-pared)} l${n(w / 2)},${n(-tejado)} l${n(w / 2)},${n(tejado)} v${n(pared)} z`;
const torreon = (x: number, w: number, alto: number) =>
  `M${n(x - w / 2)},0 V${n(-alto)} H${n(x - w / 2 - 0.3)} V${n(-alto - 1.2)} H${n(x - w / 6)} V${n(-alto - 0.6)} H${n(x + w / 6)} V${n(-alto - 1.2)} H${n(x + w / 2 + 0.3)} V${n(-alto)} H${n(x + w / 2)} V0 Z`;
const almenas = (x0: number, x1: number, y: number) => {
  let d = '';
  for (let x = x0; x <= x1 + 0.01; x += 1.2) d += `M${n(x)},${n(y)} v0.6 `;
  return d;
};
const PUERTA = 'M-0.5,0 v-1.1 a0.5,0.5 0 0 1 1,0 v1.1';

/** Un dibujito por tipo de lugar, apoyado en y = 0 y centrado en x = 0. */
const GLIFOS: Record<Territorio['tipo'] | 'propia', string> = {
  aldea: `<path d="${casita(-1.9, 2.8, 1.5, 1.4)}"/><path d="${casita(1.6, 3.2, 1.9, 1.6)}"/><path class="trazo" d="M1.2,0 v-1.1 h0.8 v1.1"/>`,
  torre: `<path d="${torreon(0, 2.8, 4.9)}"/><path class="trazo" d="${PUERTA} M0,-3.7 v0.9"/>`,
  abadia: `<path d="M-3.1,0 V-2 L-1.05,-3.7 L1,-2 V0 Z"/><path d="M1,0 V-4.6 L1.9,-6.2 L2.8,-4.6 V0 Z"/>
    <path class="trazo" d="M1.9,-6.2 V-8 M1.25,-7.35 H2.55 M-1.5,0 v-1 a0.45,0.45 0 0 1 0.9,0 v1"/><circle class="trazo" cx="-1.05" cy="-2.35" r="0.38"/>`,
  villa: `<path d="${casita(-2.5, 2.3, 1.7, 1.3)}"/><path d="${casita(2.5, 2.3, 1.9, 1.3)}"/><path d="${casita(0, 2.8, 2.6, 1.7)}"/>
    <path d="M-4.3,0.2 V-1 H4.3 V0.2 Z"/><path class="trazo" d="${almenas(-3.6, 3.6, -1)} M-0.5,0.2 v-0.8 a0.5,0.4 0 0 1 1,0 v0.8"/>`,
  puerto: `<path d="${casita(-2.4, 2.8, 1.7, 1.5)}"/><path d="M0.1,-0.5 H4.5 L3.7,0.8 H0.9 Z"/><path d="M2.3,-4.4 L4.3,-1.3 H2.3 Z"/>
    <path class="trazo" d="M2.3,-0.5 V-4.6 M-0.6,1.7 q0.65,-0.6 1.3,0 t1.3,0 t1.3,0 t1.3,0"/>`,
  castillo: `<path d="M-3.4,0 V-2.3 H3.4 V0 Z"/><path d="${torreon(-3.8, 1.9, 3.3)}"/><path d="${torreon(3.8, 1.9, 3.3)}"/><path d="${torreon(0, 2.5, 4.8)}"/>
    <path class="trazo" d="${PUERTA} M0,-6 V-8.3 M-2.2,-2.3 v0.6 M-1.6,-2.3 v0.6 M1.6,-2.3 v0.6 M2.2,-2.3 v0.6"/><path class="pendoncillo" d="M0,-8.3 L1.9,-7.75 L0,-7.2 Z"/>`,
  burgo: `<path d="${casita(-2.7, 2.4, 2.7, 1.4)}"/><path d="${casita(2.7, 2.4, 2.9, 1.4)}"/><path d="M-0.95,0 V-4.7 L0,-6.9 L0.95,-4.7 V0 Z"/>
    <path d="M-5.3,0 V-1.9 H5.3 V0 Z"/><path d="${torreon(-5.3, 1.7, 2.7)}"/><path d="${torreon(5.3, 1.7, 2.7)}"/>
    <path class="trazo" d="${PUERTA} ${almenas(-3.6, 3.6, -1.9)} M0,-6.9 V-8.5 M-0.6,-7.9 H0.6"/>`,
  propia: `<path d="${casita(-2, 2.8, 1.6, 1.4)}"/><path d="${casita(1.9, 3, 1.9, 1.5)}"/><path class="trazo" d="M1.5,0 v-1.1 h0.8 v1.1 M0,0 V-8.6"/>
    <path class="pendon" d="M0,-8.6 L4.2,-7.5 L0,-6.3 Z"/>`,
};

// ───────────────────────── el mapa ─────────────────────────

interface Compositor {
  objetivo: ObjetivoCampana;
  envio: Tropas;
}

export class MapaComarca {
  readonly el = h('div', { class: 'velo velo-mapa oculto' });
  private readonly titulo = h('span', { class: 'mapa-titulo' });
  private readonly dominios = h('span', { class: 'etiqueta mapa-dominios' });
  private readonly avisos = h('div', { class: 'fila mapa-avisos' });
  private readonly dibujo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly resultadoEl = h('div', { class: 'mapa-resultado oculto', role: 'status', 'aria-live': 'polite' });
  private readonly lado = h('aside', { class: 'mapa-lado' });
  private elegido: string | null = null;
  private compositor: Compositor | null = null;
  private resultado: { texto: string; clase: string } | null = null;
  private ocupado = false;
  private ultimaOrden = 0;
  /** Lo que hay que abrir en cuanto llegue el mapa (capturas y enlaces): territorio y, si acaso, objetivo. */
  private pendiente: { territorio?: string; objetivo?: string } | null = null;
  /** Cuánto se estira la x del mundo en el lienzo, según el hueco que haya. */
  private fx = 1.4;
  private readonly alRedimensionar = () => {
    if (this.abierto && this.medir()) this.pintar();
  };

  constructor(private readonly partida: Partida) {
    this.dibujo.setAttribute('class', 'mapa-dibujo');
    this.dibujo.setAttribute('role', 'img');
    this.dibujo.setAttribute('aria-label', 'Mapa de la comarca');
    const leyenda = h('div', { class: 'fila mapa-leyenda', 'aria-label': 'Leyenda' },
      LEYENDA.map(([clase, texto]) => h('span', { class: 'fila' }, h('span', { class: `mapa-muestra ${clase}` }), texto)),
      h('span', { class: 'fila' }, h('span', { class: 'mapa-muestra hueste-propia' }), 'Vuestra hueste'),
      h('span', { class: 'fila' }, h('span', { class: 'mapa-muestra hueste-enemiga' }), 'Hueste enemiga'));
    this.el.append(h('section', { class: 'pergamino mapa-hoja', role: 'dialog', 'aria-label': 'Mapa de la comarca' },
      h('header', { class: 'fila mapa-cabecera' },
        h('h2', { class: 'titulo' }, 'La comarca'), this.titulo, h('span', { class: 'hueco' }), this.dominios,
        h('button', { class: 'boton cerrar', type: 'button', onclick: () => this.cerrar(), 'aria-label': 'Cerrar el mapa' }, '×')),
      this.avisos,
      h('div', { class: 'mapa-cuerpo' },
        h('div', { class: 'mapa-lienzo' }, this.dibujo, this.resultadoEl, leyenda),
        this.lado)));
    this.el.addEventListener('pointerdown', (ev) => {
      if (ev.target === this.el) this.cerrar();
    });
    this.dibujo.addEventListener('click', (ev) => {
      const lugar = (ev.target as Element).closest('[data-clave]');
      if (lugar) this.elegir(lugar.getAttribute('data-clave'));
    });
    this.dibujo.addEventListener('keydown', (ev) => {
      const lugar = (ev.target as Element).closest('[data-clave]');
      if (lugar && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        this.elegir(lugar.getAttribute('data-clave'));
      }
    });
  }

  get abierto(): boolean {
    return !this.el.classList.contains('oculto');
  }

  /** ¿Acaba de darse una orden desde el mapa? Entonces lo que pasó ya se lee aquí y no hace falta otro aviso. */
  get reciente(): boolean {
    return this.abierto && Date.now() - this.ultimaOrden < 4000;
  }

  alternar(): void {
    if (this.abierto) this.cerrar();
    else void this.abrir();
  }

  /** Abre el mapa y pide la comarca al mundo. Con `territorio` sale su ficha; con `objetivo`, el compositor de campaña. */
  async abrir(territorio?: string, objetivo?: string): Promise<void> {
    this.el.classList.remove('oculto');
    this.partida.raiz.classList.add('con-mapa');
    window.addEventListener('resize', this.alRedimensionar);
    this.partida.hud.marcarActivo('mapa');
    this.pendiente = territorio ? { territorio, objetivo } : null;
    this.medir();
    this.pintar();
    this.partida.sonido.efecto('pergamino');
    await this.partida.cargarComarca();
  }

  cerrar(): void {
    if (!this.abierto) return;
    window.removeEventListener('resize', this.alRedimensionar);
    this.partida.raiz.classList.remove('con-mapa');
    this.el.classList.add('oculto');
    this.compositor = null;
    this.resultado = null;
    this.partida.remarcar();
  }

  /** Escape: deshace lo último (compositor, ficha) y, si no hay nada, cierra el mapa. */
  atras(): void {
    if (this.compositor) this.compositor = null;
    else if (this.elegido) this.elegido = null;
    else {
      this.cerrar();
      return;
    }
    this.pintar();
  }

  alCambiarComarca(): void {
    const c = this.partida.comarca;
    if (c && this.pendiente) {
      const { territorio, objetivo } = this.pendiente;
      this.pendiente = null;
      const t = c.territorios.find((x) => x.clave === territorio);
      this.elegido = t?.clave ?? null;
      this.compositor = t && OBJETIVOS.includes(objetivo as ObjetivoCampana) && t.acciones.includes(objetivo as ObjetivoCampana)
        ? { objetivo: objetivo as ObjetivoCampana, envio: { ...c.tropas } }
        : null;
    }
    if (this.abierto) this.pintar();
  }

  /** Cambian los recursos o la lección: lo que depende de ellos (botones, tira del tutorial) se repinta. */
  alCambiarEstado(): void {
    if (this.abierto) this.pintar();
  }

  /** Ajusta la proporción del lienzo al hueco del pergamino. Devuelve true si ha cambiado. */
  private medir(): boolean {
    const { clientWidth: ancho, clientHeight: alto } = this.dibujo;
    const fx = ancho > 0 && alto > 0 ? Math.round(Math.min(1.6, Math.max(1.15, ancho / alto)) * 50) / 50 : this.fx;
    if (fx === this.fx) return false;
    this.fx = fx;
    return true;
  }

  private elegir(clave: string | null): void {
    const nueva = clave === 'aldea' ? null : clave;
    if (nueva !== this.elegido) this.compositor = null;
    this.elegido = nueva;
    this.pintar();
  }

  // ───────────── pintar ─────────────

  private pintar(): void {
    const c = this.partida.comarca;
    const e = this.partida.estado;
    if (!c || !e) {
      this.titulo.textContent = '';
      this.dominios.textContent = '';
      vaciar(this.avisos);
      this.dibujo.setAttribute('viewBox', `0 0 ${n(100 * this.fx)} ${ALTO}`);
      this.dibujo.innerHTML = terreno(this.fx);
      vaciar(this.lado);
      this.lado.append(h('p', { class: 'nota' }, 'Desenrollando el mapa…'));
      return;
    }
    if (this.elegido && !c.territorios.some((t) => t.clave === this.elegido)) this.elegido = null;
    this.titulo.textContent = tituloDe(c.aldea.titulo, c.aldea.nombre);
    this.dominios.textContent = `Dominios: ${c.aldea.dominios} de ${c.territorios.length}`;
    this.dominios.title = 'Vasallos y plazas conquistadas. Con cada uno crece vuestro título; con todos, la comarca es vuestra.';
    this.pintarAvisos(c);
    this.pintarDibujo(c);
    this.pintarResultado();
    this.pintarLado(c);
  }

  private pintarAvisos(c: Comarca): void {
    vaciar(this.avisos);
    const aviso = (texto: string, clase = '', titulo = '') => this.avisos.append(h('span', { class: `hud-etiqueta ${clase}`, title: titulo }, texto));
    const senor = (clave: string | null) => c.territorios.find((t) => t.clave === clave)?.senor ?? 'un señor de fuera';
    if (c.asedio) {
      aviso(`Estáis cercados por ${senor(c.asedio.vecino)}: ${c.asedio.fuerza} lanzas, ${dias(c.asedio.dias)} de cerco`, 'mal',
        'Nadie entra, nadie sale y el grano mengua. Cada noche el enemigo pierde gente (más si tenéis arqueros en el muro): si llega a ser menos que vuestra defensa, levanta el real.');
    }
    if (c.amenaza) {
      aviso(`Viene ${c.amenaza.nombre}: unas ${c.amenaza.fuerza} lanzas, ${c.amenaza.dias <= 0 ? 'esta noche' : `en ${dias(c.amenaza.dias)}`}`, 'mal',
        `Vuestra defensa vale ${cifra(c.aldea.defensa)}. Si no llega a sus lanzas, entran; con muros y pan, os cercan.`);
    }
    if (c.aldea.vasallo_de) aviso(`Sois vasallo de ${senor(c.aldea.vasallo_de)}`, 'mal', 'Le pagáis tributo cada noche. Podéis comprar la libertad en su ficha, o ganarla venciéndole.');
    if (c.campana) {
      const cuando = c.campana.dias <= 0 ? 'esta noche' : `en ${dias(c.campana.dias)}`;
      aviso(c.campana.fase === 'ida'
        ? `Vuestra hueste va camino de ${c.campana.nombre}, ${NOMBRE_OBJETIVO[c.campana.objetivo]}: llega ${cuando}`
        : `Vuestra hueste vuelve de ${c.campana.nombre}${c.campana.victoria ? ' con la victoria' : ', vencida'}: entra ${cuando}`, c.campana.fase === 'vuelta' && !c.campana.victoria ? 'mal' : 'bien');
    }
    // Si ya viene alguien (las mesnadas de la frontera no entienden de treguas), la nota de paz sobra.
    if (c.paz_hasta > 0 && !c.amenaza && !c.asedio) {
      aviso(`Paz de recién llegado: ${dias(c.paz_hasta)} más`, '', 'Hasta entonces nadie os mandará una hueste. Después, quien os tenga ojeriza y gusto por la guerra acabará viniendo.');
    } else if (!c.amenaza && !c.asedio) {
      aviso('Se acabó la paz de recién llegado', '', 'Quien os tenga ojeriza (los que salen en rojo) y gusto por la guerra puede mandaros una hueste. Llega antes el aviso.');
    }
  }

  private pintarDibujo(c: Comarca): void {
    const aLienzo = (p: [number, number]): P => [p[0] * this.fx, p[1]];
    this.dibujo.setAttribute('viewBox', `0 0 ${n(100 * this.fx)} ${ALTO}`);
    const sitios = new Map<string, P>([['aldea', aLienzo(c.aldea.pos)]]);
    for (const t of c.territorios) sitios.set(t.clave, aLienzo(t.pos));
    const red = new Red(sitios, c.caminos);
    const caminos = red.dibujos().map((p) => `<path class="camino" d="${curva(p.filter((_, i) => i % 3 === 0))}"/>`).join('');

    const lugar = (clave: string, [x, y]: P, glifo: string, clase: string, nombre: string, nota: string, ayuda: string) => `
      <g class="lugar ${clase} ${clave === (this.elegido ?? '') ? 'elegido' : ''}" data-clave="${clave}" transform="translate(${n(x)},${n(y)})" tabindex="0" role="button" aria-label="${escapar(ayuda)}">
        <title>${escapar(ayuda)}</title>
        <rect class="lugar-zona" x="-11" y="-9.5" width="22" height="18.5"/>
        <ellipse class="lugar-suelo" cx="0" cy="0.5" rx="6.6" ry="2.3"/>
        <ellipse class="lugar-aro" cx="0" cy="0.5" rx="8.4" ry="3.3"/>
        <g class="lugar-glifo">${glifo}</g>
        ${rotulo('lugar-nombre', 0, 5.3, nombre)}
        ${rotulo('lugar-nota', 0, 7.7, nota)}
      </g>`;
    const lugares = c.territorios.map((t) => {
      const s = situacion(t);
      const banderin = t.estado !== 'libre' ? '<path class="trazo" d="M-4.6,0 V-5"/><path class="pendon" d="M-4.6,-5 L-2.2,-4.35 L-4.6,-3.7 Z"/>' : '';
      return lugar(t.clave, sitios.get(t.clave)!, GLIFOS[t.tipo] + banderin, s.clase, t.nombre, `${lanzas(t)} · ${dias(t.dias)}`,
        `${t.nombre}, de ${t.senor}. ${s.texto}. ${mayuscula(lanzas(t))}, a ${dias(t.dias)} de marcha.`);
    }).join('');
    const propia = lugar('aldea', sitios.get('aldea')!, GLIFOS.propia, `propia ${c.asedio ? 'cercada' : ''}`, c.aldea.nombre,
      c.asedio ? '¡cercados!' : `defensa ${cifra(c.aldea.defensa)}`, `${c.aldea.nombre}, vuestra aldea. Defensa ${cifra(c.aldea.defensa)}.`);

    // Las huestes: la vuestra sobre el camino de ida o de vuelta; la enemiga, viniendo hacia la aldea.
    // El rótulo es corto y va en su cartela, al lado de la ficha que quede más lejos del lugar más cercano.
    const ficha = (clase: string, [x, y]: P, texto: string, ayuda: string) => {
      const ancho = texto.length * 1.02 + 2.2;
      const holgura = (lado: number) => Math.min(...[...sitios.values()].map(([sx, sy]) => Math.hypot((x + lado * (3.4 + ancho / 2) - sx) / 12, (y - sy - 2.5) / 6)));
      const lado = holgura(1) >= holgura(-1) ? 1 : -1;
      return `
      <g class="hueste ${clase}" transform="translate(${n(x)},${n(y)})"><title>${escapar(ayuda)}</title>
        <circle class="hueste-halo" r="4.2"/><circle class="hueste-disco" r="2.7"/>
        <path class="hueste-lanza" d="M-1.3,1.5 L1.2,-1.4 M0.4,-1.8 L1.8,-2.1 L1.5,-0.7 Z"/>
        <rect class="hueste-cartela" x="${n(lado > 0 ? 3.4 : -3.4 - ancho)}" y="-1.55" width="${n(ancho)}" height="3.1" rx="1.5"/>
        ${rotulo('hueste-rotulo', lado * (3.4 + ancho / 2), 0.7, texto)}
      </g>`;
    };
    // Si la ficha cae encima de un lugar (o de su nombre), se corre por el camino hasta que deje de tapar.
    const despejada = (ruta: P[], f: number): P => {
      const libre = ([x, y]: P) => [...sitios.values()].every(([sx, sy]) => Math.hypot((x - sx) / 13.5, (y - sy - 2) / 7) > 1);
      for (const paso of [0, 0.06, -0.06, 0.12, -0.12, 0.18, -0.18, 0.24, -0.24, 0.3, -0.3]) {
        const punto = puntoEn(ruta, Math.min(0.92, Math.max(0.08, f + paso)));
        if (libre(punto)) return punto;
      }
      return puntoEn(ruta, f);
    };
    let huestes = '';
    if (c.campana) {
      const destino = c.territorios.find((t) => t.clave === c.campana!.vecino);
      const total = Math.max(1, destino?.dias ?? 1);
      const hecho = Math.min(1, Math.max(0, 1 - c.campana.dias / total));
      // De ida se aleja de la aldea; de vuelta se acerca. Nunca se pinta encima de un lugar.
      const f = c.campana.fase === 'ida' ? 0.4 + hecho * 0.42 : 0.82 - hecho * 0.42;
      const cuando = c.campana.dias <= 0 ? 'esta noche' : dias(c.campana.dias);
      huestes += ficha('propia', despejada(red.ruta(c.campana.vecino), f), c.campana.fase === 'ida' ? cuando : `vuelve · ${cuando}`,
        `Vuestra hueste (${textoTropas(c.campana.tropas, c.unidades)}), ${c.campana.fase === 'ida' ? `camino de ${c.campana.nombre}` : `de vuelta de ${c.campana.nombre}`}.`);
    }
    if (c.amenaza?.vecino && sitios.has(c.amenaza.vecino)) {
      const origen = c.territorios.find((t) => t.clave === c.amenaza!.vecino);
      const total = Math.max(c.amenaza.dias, origen?.dias ?? 1, 1);
      const f = 0.82 - Math.min(1, Math.max(0, 1 - c.amenaza.dias / total)) * 0.5;
      huestes += ficha('enemiga', despejada(red.ruta(c.amenaza.vecino), f), `${c.amenaza.fuerza} lanzas · ${c.amenaza.dias <= 0 ? 'esta noche' : dias(c.amenaza.dias)}`,
        `${mayuscula(c.amenaza.nombre)}: unas ${c.amenaza.fuerza} lanzas camino de ${c.aldea.nombre}.`);
    }
    if (c.asedio) {
      const [x, y] = sitios.get('aldea')!;
      huestes += ficha('enemiga', [x + 10.5, y - 4], `el cerco · ${c.asedio.fuerza} lanzas`, `El real del enemigo: ${c.asedio.fuerza} lanzas, ${dias(c.asedio.dias)} de cerco.`);
    }

    this.dibujo.innerHTML = `
      ${terreno(this.fx)}
      <g filter="url(#mapa-mano)">${caminos}</g>
      ${lugares}${propia}${huestes}`;
  }

  private pintarResultado(): void {
    vaciar(this.resultadoEl);
    this.resultadoEl.className = `mapa-resultado ${this.resultado ? this.resultado.clase : 'oculto'}`;
    if (!this.resultado) return;
    this.resultadoEl.append(
      h('p', null, this.resultado.texto),
      h('button', { class: 'boton cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => { this.resultado = null; this.pintarResultado(); } }, '×'));
  }

  private pintarLado(c: Comarca): void {
    const arriba = this.lado.scrollTop;
    vaciar(this.lado);
    const t = c.territorios.find((x) => x.clave === this.elegido);
    const leccion = this.partida.estado?.tutorial;
    this.lado.append(...[
      leccion?.activo && leccion.boton === 'mapa' && h('article', { class: 'tarjeta mapa-leccion' },
        h('span', { class: 'etiqueta' }, `Lección ${leccion.paso} de ${leccion.total} · ${leccion.titulo}`),
        h('p', { class: 'nota' }, leccion.como)),
      ...(t ? (this.compositor ? this.pintarCompositor(c, t, this.compositor) : this.pintarFicha(c, t)) : this.pintarCasa(c)),
      ...this.pintarPartes(c),
    ].filter((x): x is HTMLElement => Boolean(x)));
    this.lado.scrollTop = arriba;
  }

  /** Sin territorio elegido: lo vuestro y cómo se usa el mapa. */
  private pintarCasa(c: Comarca): HTMLElement[] {
    const enCasa = totalTropas(c.tropas);
    return [
      h('article', { class: 'tarjeta' },
        h('h3', { class: 'titulo mapa-nombre' }, c.aldea.nombre),
        h('p', { class: 'etiqueta' }, `Vuestra casa · ${c.aldea.titulo}`),
        h('dl', { class: 'datos' },
          h('dt', null, 'Defensa'), h('dd', null, cifra(c.aldea.defensa), h('span', { class: 'nota' }, ' · lo que se mide contra quien venga')),
          h('dt', null, 'Tropa'), h('dd', null, enCasa ? `${textoTropas(c.tropas, c.unidades)} en casa` : 'nadie en armas',
            enCasa > 0 && h('span', { class: 'nota' }, ` · fuerza ${cifra(c.fuerza)} en campo abierto`)),
          c.campana && h('dt', null, 'Fuera'), c.campana && h('dd', null, textoTropas(c.campana.tropas, c.unidades),
            (c.campana.refuerzos ?? 0) > 0 && h('span', { class: 'nota' }, ` · y ${cifra(c.campana.refuerzos ?? 0)} de fuerza que mandan vasallos y aliados`))),
        c.campana?.texto && h('p', { class: 'letra' }, c.campana.texto),
        h('div', { class: 'fila' }, h('button', { class: 'boton', type: 'button', onclick: () => { this.cerrar(); this.partida.paneles.abrir('hueste'); } }, 'Pasar revista a la hueste'))),
      h('p', { class: 'nota' }, 'Pinchad en un lugar del mapa para ver quién manda allí, cuánta gente tiene, qué os debe y qué podéis hacerle: mandarle un presente, pactar, exigir… o sacar la hueste.'),
    ];
  }

  private pintarFicha(c: Comarca, t: Territorio): HTMLElement[] {
    const e = this.partida.estado!;
    const s = situacion(t);
    const amo = c.aldea.vasallo_de === t.clave;
    const barra = h('span', { class: 'medidor' }, h('span', { style: `width:${Math.round(((t.relacion + 100) / 200) * 100)}%` }));
    const paga = textoCoste(t.tributo);
    const pagaria = textoCoste(t.tributo_posible);
    const guerras = OBJETIVOS.filter((o) => t.acciones.includes(o));
    const embajada = (accion: AccionEmbajada, texto: string, nota: string, puede = true) => t.acciones.includes(accion) && h('button', {
      class: 'boton opcion', type: 'button', disabled: this.ocupado || !puede, 'data-accion': accion, onclick: () => void this.embajada(t, accion),
    }, h('span', null, texto), h('span', { class: 'nota' }, nota));
    return [
      h('article', { class: `tarjeta mapa-ficha ${s.clase}`, 'data-territorio': t.clave },
        h('div', { class: 'fila' }, h('h3', { class: 'titulo mapa-nombre' }, t.nombre), h('span', { class: 'hueco' }),
          h('button', { class: 'boton cerrar', type: 'button', 'aria-label': 'Cerrar la ficha', onclick: () => this.elegir(null) }, '×')),
        h('p', { class: 'etiqueta' }, `${NOMBRE_TIPO[t.tipo] ?? t.tipo} · ${t.senor}`),
        h('p', null, h('span', { class: `mapa-situacion ${amo ? 'hostil' : s.clase}` }, amo ? 'Vuestro amo: le pagáis vasallaje' : s.texto)),
        h('p', null, t.caracter),
        h('dl', { class: 'datos' },
          h('dt', null, 'Trato'), h('dd', { 'data-dato': 'relacion' }, barra, ` ${t.relacion_texto} (${t.relacion > 0 ? '+' : ''}${t.relacion})`),
          h('dt', null, 'Mesnada'), h('dd', null, lanzas(t), !t.fuerza_exacta && h('span', { class: 'nota' }, ' · lo que cuentan los pastores, de cinco en cinco')),
          h('dt', null, 'Muros'), h('dd', null, String(t.defensa), h('span', { class: 'nota' }, ' · cuentan a su favor cuando hay que tomarlos')),
          h('dt', null, 'Riqueza'), h('dd', null, String(t.riqueza), h('span', { class: 'nota' }, ' · de ahí salen botín y tributo')),
          h('dt', null, 'Camino'), h('dd', null, `${dias(t.dias)} de marcha`),
          h('dt', null, 'Tributo'), h('dd', null, paga !== 'gratis' ? `os paga ${paga} al día` : `pagaría ${pagaria} al día`,
            paga === 'gratis' && h('span', { class: 'nota' }, ' · si fuese vasallo; conquistado, más')))),
      h('div', { class: 'columna opciones mapa-acciones' },
        embajada('regalo', 'Mandar un presente', `Cuesta ${c.precios.regalo} de oro y mejora el trato. Uno al día.`, (e.recursos['oro'] ?? 0) >= c.precios.regalo),
        embajada('alianza', 'Proponer alianza', 'Solo la firma quien ya os aprecia. Un aliado acude si os atacan y manda gente a vuestras guerras.'),
        embajada('exigir', 'Exigir tributo', 'Sin batalla: cede si vuestra hueste dobla a la suya. Si no os teme, se ríe y el trato empeora.'),
        embajada('liberar', 'Liberar del juramento', 'Deja de pagaros y de mandaros gente. Lo agradecerá. O desconfiará.'),
        embajada('rescate', 'Comprar vuestra libertad', `Le pagáis ${c.precios.rescate} monedas de rescate y dejáis de deberle vasallaje.`, (e.recursos['oro'] ?? 0) >= c.precios.rescate),
        guerras.length > 0 && h('div', { class: 'fila mapa-guerras' }, guerras.map((o) => h('button', {
          class: 'boton boton-guerra', type: 'button', 'data-accion': o, title: c.objetivos[o]?.descripcion ?? '',
          onclick: () => { this.compositor = { objetivo: o, envio: { ...c.tropas } }; this.pintar(); },
        }, `${c.objetivos[o]?.nombre ?? mayuscula(o)}…`)))),
    ];
  }

  /** El compositor de campaña: objetivo, cuánta tropa de cada tipo sale y lo que se sabe del enemigo. */
  private pintarCompositor(c: Comarca, t: Territorio, comp: Compositor): HTMLElement[] {
    const objetivo = c.objetivos[comp.objetivo];
    const guerras = OBJETIVOS.filter((o) => t.acciones.includes(o));
    const enCasa = totalTropas(c.tropas);
    const enviados = totalTropas(comp.envio);
    const propia = fuerzaTropas(comp.envio, c.unidades);
    // Lo que pesa en la batalla: la tropa enviada, la gente que mandan vasallos y aliados, y el ánimo de la aldea.
    const fuerza = enviados > 0 ? (propia + t.refuerzos) * c.moral : 0;
    // Lo que hay que superar: su mesnada más lo que cuenten sus muros para ese objetivo, por el umbral.
    const hace = objetivo ? objetivo.umbral * (t.fuerza + t.defensa * objetivo.muros) : 0;
    // Entre lo que yerran los pastores, la suerte y el ánimo, solo con mucha ventaja se va sobre seguro.
    const pinta = fuerza >= hace * 1.35 ? ['bien', 'Pinta bien.'] : fuerza >= hace ? ['', 'Está por ver: es justo.'] : ['mal', 'Pinta mal.'];
    const quedan: Tropas = Object.fromEntries(c.unidades.map((u) => [u.clave, (c.tropas[u.clave] ?? 0) - (comp.envio[u.clave] ?? 0)]));
    const partes = c.aldea.defensa_partes;
    const defensaSin = c.aldea.defensa - partes.tropas + fuerzaTropas(quedan, c.unidades, partes.muros > 0);
    const amigos = c.territorios.some((x) => x.clave !== t.clave && (x.estado !== 'libre' || x.aliado));
    const cambiar = (clave: string, cuantos: number) => {
      const tope = c.tropas[clave as keyof Tropas] ?? 0;
      comp.envio = { ...comp.envio, [clave]: Math.max(0, Math.min(tope, cuantos)) };
      this.pintarLado(c);
    };
    const paso = (texto: string, titulo: string, puede: boolean, accion: () => void) =>
      h('button', { class: 'boton paso', type: 'button', disabled: !puede, title: titulo, onclick: accion }, texto);
    const sinGente = c.unidades.filter((u) => !(c.tropas[u.clave] ?? 0)).map((u) => u.plural);
    const filas = c.unidades.filter((u) => (c.tropas[u.clave] ?? 0) > 0).map((u) => {
      const hay = c.tropas[u.clave] ?? 0;
      const van = comp.envio[u.clave] ?? 0;
      return h('div', { class: 'fila mapa-envio', 'data-envio': u.clave },
        h('span', { class: 'columna' }, h('b', null, u.nombre), h('span', { class: 'nota' }, `${hay} en casa · fuerza ${cifra(u.fuerza)} cada uno`)),
        h('span', { class: 'hueco' }),
        paso('−', 'Uno menos', van > 0, () => cambiar(u.clave, van - 1)),
        h('b', { class: 'mapa-cuantos' }, String(van)),
        paso('+', 'Uno más', van < hay, () => cambiar(u.clave, van + 1)),
        paso('Todos', 'Mandar a todos los que hay en casa', van < hay, () => cambiar(u.clave, hay)));
    });
    const motivo = c.campana ? 'Vuestra hueste ya está en campaña: hasta que vuelva no sale otra.'
      : c.asedio ? 'Estáis cercados: de aquí no sale nadie.'
        : !enCasa ? 'No tenéis a quién mandar. Alistad gente en «Hueste».'
          : !enviados ? 'Hay que mandar a alguien.' : '';
    return [
      h('article', { class: 'tarjeta mapa-compositor', 'data-territorio': t.clave },
        h('div', { class: 'fila' }, h('h3', { class: 'titulo mapa-nombre' }, `Contra ${t.nombre}`), h('span', { class: 'hueco' }),
          h('button', { class: 'boton cerrar', type: 'button', 'aria-label': 'Volver a la ficha', onclick: () => { this.compositor = null; this.pintar(); } }, '×')),
        h('div', { class: 'fila tributos' }, guerras.map((o) => h('button', {
          class: `boton ${o === comp.objetivo ? 'activo' : ''}`, type: 'button', 'data-objetivo': o, onclick: () => { comp.objetivo = o; this.pintarLado(c); },
        }, c.objetivos[o]?.nombre ?? mayuscula(o)))),
        h('p', null, objetivo?.descripcion ?? ''),
        h('p', { class: 'nota' }, `Lo que se sabe de ${t.senor}: ${lanzas(t)}${t.fuerza_exacta ? '' : ' (a ojo de pastor)'} y muros que valen ${t.defensa}`,
          objetivo && (objetivo.muros < 1 ? `, aunque para esto solo cuentan al ${Math.round(objetivo.muros * 100)} %. ` : ', que aquí cuentan enteros. '),
          objetivo && (objetivo.umbral === 1 ? 'Hay que igualar eso, por lo menos.'
            : objetivo.umbral < 1 ? `Basta con llegar al ${Math.round(objetivo.umbral * 100)} % de eso.` : `Y hay que pasarlo de largo: hace falta el ${Math.round(objetivo.umbral * 100)} %.`)),
        h('div', { class: 'columna mapa-envios' }, filas,
          enCasa > 0 && sinGente.length > 0 && h('p', { class: 'nota' }, `En casa no hay ${sinGente.length === 1 ? sinGente[0] : `${sinGente.slice(0, -1).join(', ')} ni ${sinGente[sinGente.length - 1]}`}.`)),
        h('p', { class: `mapa-cuenta ${pinta[0]}`, 'data-dato': 'fuerza' }, h('b', null, `Vuestra fuerza: ${cifra(fuerza)}`), ` · hacen falta unas ${cifra(Math.ceil(hace))}. `, enviados > 0 && pinta[1]),
        h('p', { class: 'mapa-ojo' }, h('b', null, 'Ojo: '), 'lo que mandéis no defiende la aldea mientras esté fuera.',
          enviados > 0 && ` La defensa se quedaría en ${cifra(Math.max(0, defensaSin))} (ahora vale ${cifra(c.aldea.defensa)}).`),
        t.aliado && h('p', { class: 'mal' }, 'Es vuestro aliado: atacarle es perjurio. Se rompe la alianza y los demás señores toman nota.'),
        motivo && h('p', { class: 'nota mal' }, motivo),
        // El pie se queda a la vista aunque la ficha no quepa entera: el botón de salir no se esconde.
        h('div', { class: 'fila mapa-pie' },
          h('button', { class: 'boton boton-lacre', type: 'button', disabled: Boolean(motivo) || this.ocupado, 'data-accion': 'salir', onclick: () => void this.salir(t, comp) }, 'Que salga la hueste'),
          h('button', { class: 'boton', type: 'button', onclick: () => { this.compositor = null; this.pintar(); } }, 'Volver'),
          !enCasa && h('button', { class: 'boton', type: 'button', onclick: () => { this.cerrar(); this.partida.paneles.abrir('hueste'); } }, 'Ir a «Hueste»')),
        h('p', null, h('span', { class: 'etiqueta' }, 'Camino: '), `${dias(t.dias)} de ida y ${dias(t.dias)} de vuelta. La batalla se da al llegar; el botín y los que queden en pie entran al volver.`),
        h('p', { class: 'nota' }, 'La batalla tiene su parte de suerte y el ánimo de la aldea también pelea',
          (this.partida.estado?.poblacion.animo ?? 60) < 48 ? ' (y hoy anda bajo: la hueste irá sin ganas).' : '.',
          enviados > 0 && ` En la cuenta de arriba van ${cifra(propia)} de vuestra tropa`,
          enviados > 0 && amigos && t.refuerzos > 0 && `, ${cifra(t.refuerzos)} que mandan vasallos y aliados`,
          enviados > 0 && (c.moral === 1 ? '.' : ` y el ánimo, que ${c.moral > 1 ? 'suma' : 'resta'} un ${Math.round(Math.abs(c.moral - 1) * 100)} %.`),
          ' Los pastores cuentan las lanzas ajenas de cinco en cinco y por lo alto.')),
    ];
  }

  private pintarPartes(c: Comarca): HTMLElement[] {
    if (!c.partes.length) {
      return [h('h3', { class: 'subtitulo' }, 'Partes de guerra'), h('p', { class: 'nota' }, 'Ninguno todavía. El escriba afila la pluma por si acaso.')];
    }
    return [
      h('h3', { class: 'subtitulo' }, 'Partes de guerra'),
      ...c.partes.slice(0, 6).map((p) => h('article', { class: `tarjeta mapa-parte ${p.victoria ? 'victoria' : 'derrota'}` },
        h('span', { class: 'etiqueta' }, `Día ${p.dia} · ${c.objetivos[p.objetivo]?.nombre ?? mayuscula(p.objetivo)} ${p.nombre} · `, h('b', { class: p.victoria ? 'bien' : 'mal' }, p.victoria ? 'victoria' : 'derrota')),
        h('p', null, p.texto),
        textoCoste(p.botin) !== 'gratis' && h('p', { class: 'nota' }, `Botín: ${textoCoste(p.botin)}.`))),
    ];
  }

  // ───────────── órdenes ─────────────

  /** Manda una orden de la comarca. Los «no se puede» del mundo se enseñan en el propio mapa. */
  private async ordenar<T>(accion: () => Promise<T>): Promise<T | undefined> {
    if (this.ocupado) return undefined;
    this.ocupado = true;
    try {
      this.ultimaOrden = Date.now();
      return await accion();
    } catch (e) {
      this.resultado = { texto: e instanceof ErrorMundo || e instanceof Error ? e.message : String(e), clase: 'mal' };
      this.partida.sonido.efecto('no');
      return undefined;
    } finally {
      this.ocupado = false;
      if (this.abierto) this.pintar();
    }
  }

  private async embajada(t: Territorio, accion: AccionEmbajada): Promise<void> {
    if (accion === 'liberar' && !window.confirm(`¿Liberar a ${t.nombre} de su juramento? Dejará de pagaros tributo.`)) return;
    const r = await this.ordenar(() => api.embajada(this.partida.aldeaId, t.clave, accion));
    if (!r) return;
    this.resultado = { texto: r.texto, clase: '' };
    this.partida.sonido.efecto(accion === 'regalo' || accion === 'rescate' ? 'monedas' : 'sello');
    this.partida.aplicarComarca(r);
  }

  private async salir(t: Territorio, comp: Compositor): Promise<void> {
    const c = this.partida.comarca;
    const envio: Tropas = Object.fromEntries(Object.entries(comp.envio).filter(([, v]) => (v ?? 0) > 0));
    const r = await this.ordenar(() => api.campana(this.partida.aldeaId, t.clave, comp.objetivo, envio));
    if (!r) return;
    this.compositor = null;
    this.resultado = { texto: `Sale la hueste hacia ${t.nombre}: ${c ? textoTropas(envio, c.unidades) : 'los vuestros'}, ${NOMBRE_OBJETIVO[comp.objetivo]}. ${mayuscula(dias(t.dias))} de camino.`, clase: 'bien' };
    this.partida.sonido.efecto('campana');
    this.partida.aplicarComarca(r);
  }
}
