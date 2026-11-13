// El tutorial: la tarjeta del escriba con la lección en curso (mundo/datos/tutorial.yaml). El mundo decide
// cuándo se cumple cada lección; aquí solo se enseña, se señala el botón que toca y se avisa al aprenderla.
import { api, type Estado, type Evento, type Leccion, type OrdenTutorial, type Recursos } from './api';
import { h, textoCoste, vaciar } from './dom';
import type { Partida } from './partida';

/** Para enseñar la despedida una sola vez por aldea (y navegador). */
const CLAVE_DESPEDIDA = 'pedrafonte.tutorial.despedida.';

export class TarjetaTutorial {
  readonly el = h('div', { class: 'tutorial' });
  private readonly tarjeta = h('section', { class: 'pergamino tutorial-tarjeta oculto', 'aria-label': 'Lecciones del escriba' });
  private readonly pastilla = h('button', { class: 'pergamino tutorial-pastilla oculto', type: 'button', title: 'Volver a abrir la lección del escriba' });
  /** Lecciones ya anunciadas: el aviso puede llegar por el WebSocket y por el cambio de estado a la vez. */
  private readonly anunciadas = new Set<string>();
  private firma = '';

  constructor(private readonly partida: Partida) {
    this.el.append(this.tarjeta, this.pastilla);
    this.pastilla.addEventListener('click', () => this.desplegar());
  }

  /** Al entrar en otra aldea (o empezar de cero) se olvida lo anunciado. */
  reiniciar(): void {
    this.anunciadas.clear();
    this.firma = '';
    this.tarjeta.classList.remove('desplegada');
  }

  /** Al cerrarse el panel lateral, la tarjeta vuelve a su sitio y a su ser. */
  alCambiarPanel(abierto: boolean): void {
    if (!abierto) this.tarjeta.classList.remove('desplegada');
  }

  alLlegarEvento(e: Evento): void {
    if (e.tipo !== 'tutorial') return;
    this.anunciar(String(e['clave'] ?? ''), String(e['titulo'] ?? ''), (e['premio'] ?? {}) as Recursos);
  }

  /** Pinta la lección del estado nuevo y, si ha cambiado respecto al anterior, avisa de la aprendida. */
  pintar(e: Estado, antes: Estado | null): void {
    const t = e.tutorial;
    const previa = antes && antes.aldea.id === e.aldea.id ? antes.tutorial : null;
    if (previa?.activo && (t.activo ? t.paso > previa.paso : t.terminado)) this.anunciar(previa.clave, previa.titulo, previa.premio);
    if (previa?.activo && !t.activo && !t.terminado) {
      this.partida.avisar('El escriba guarda sus lecciones. Si las echáis de menos, están en «Aldeas».', '', 8);
    }
    this.partida.hud.destacar(t.activo ? t.boton : null);

    const despedida = !t.activo && t.terminado && t.final && !this.despedidaVista(e.aldea.id) ? t.final : '';
    if (t.activo) this.olvidarDespedida(e.aldea.id);
    const firma = t.activo ? `${e.aldea.id}:${t.paso}:${t.oculto}:${t.texto}` : `${e.aldea.id}:fin:${despedida}`;
    if (firma === this.firma) return;
    this.firma = firma;
    vaciar(this.tarjeta);
    vaciar(this.pastilla);
    this.tarjeta.classList.toggle('oculto', !t.activo && !despedida);
    this.pastilla.classList.toggle('oculto', !t.activo);
    this.tarjeta.classList.toggle('plegada', t.activo && t.oculto);
    if (t.activo) this.pintarLeccion(t);
    else if (despedida) this.pintarDespedida(e.aldea.id, despedida);
  }

  private pintarLeccion(t: Leccion): void {
    const premio = textoCoste(t.premio);
    const piezas = [
      h('header', { class: 'fila tutorial-cabecera' },
        h('span', { class: 'etiqueta' }, `Capítulo ${t.capitulo_n} de ${t.capitulos} · ${t.capitulo}`),
        h('span', { class: 'hueco' }),
        h('span', { class: 'etiqueta' }, `Lección ${t.paso} de ${t.total}`)),
      h('h2', { class: 'titulo tutorial-titulo' }, t.titulo),
      h('p', { class: 'tutorial-texto' }, t.texto),
      t.como && h('div', { class: 'tutorial-como' }, h('span', { class: 'etiqueta' }, 'Cómo se hace'), h('p', null, t.como)),
      premio !== 'gratis' && h('p', { class: 'tutorial-premio' }, h('span', { class: 'etiqueta' }, 'Premio: '), premio),
      h('div', { class: 'tutorial-progreso', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': t.total, 'aria-valuenow': t.paso - 1, title: `${t.paso - 1} de ${t.total} lecciones aprendidas` },
        h('span', { style: `width:${Math.round(((t.paso - 1) / t.total) * 100)}%` })),
      h('div', { class: 'fila tutorial-botones' },
        t.manual && h('button', { class: 'boton boton-lacre', type: 'button', 'data-tutorial': 'entendido', onclick: () => void this.orden('entendido') }, 'Entendido'),
        h('button', { class: 'boton', type: 'button', 'data-tutorial': 'ocultar', title: 'Dejarla en una pastilla pequeña', onclick: () => this.plegar() }, 'Ocultar'),
        h('span', { class: 'hueco' }),
        h('button', { class: 'enlace tutorial-saltar', type: 'button', 'data-tutorial': 'saltar', onclick: () => this.saltar() }, 'Saltar el tutorial')),
    ];
    this.tarjeta.append(...piezas.filter((x): x is HTMLElement => Boolean(x)));
    this.pastilla.append(h('span', { class: 'etiqueta' }, `Lección ${t.paso} de ${t.total}`), h('span', { class: 'tutorial-pastilla-titulo' }, t.titulo));
  }

  private pintarDespedida(aldea: number, texto: string): void {
    const cerrar = () => {
      try {
        localStorage.setItem(CLAVE_DESPEDIDA + aldea, '1');
      } catch {
        /* sin almacenamiento: se verá otra vez al volver, y no pasa nada */
      }
      this.firma = '';
      this.tarjeta.classList.add('oculto');
    };
    this.tarjeta.append(
      h('header', { class: 'fila tutorial-cabecera' }, h('span', { class: 'etiqueta' }, 'Fin de las lecciones')),
      h('h2', { class: 'titulo tutorial-titulo' }, 'El escriba cierra el cuaderno'),
      h('p', { class: 'tutorial-texto' }, texto),
      h('div', { class: 'tutorial-progreso' }, h('span', { style: 'width:100%' })),
      h('div', { class: 'fila tutorial-botones' }, h('button', { class: 'boton boton-lacre', type: 'button', onclick: cerrar }, 'Así sea')),
    );
  }

  private despedidaVista(aldea: number): boolean {
    try {
      return localStorage.getItem(CLAVE_DESPEDIDA + aldea) === '1';
    } catch {
      return false;
    }
  }

  private olvidarDespedida(aldea: number): void {
    try {
      localStorage.removeItem(CLAVE_DESPEDIDA + aldea);
    } catch {
      /* da igual */
    }
  }

  private anunciar(clave: string, titulo: string, premio: Recursos): void {
    if (!clave || this.anunciadas.has(clave)) return;
    this.anunciadas.add(clave);
    const ganado = textoCoste(premio);
    this.partida.avisar(`Lección aprendida: «${titulo}».${ganado === 'gratis' ? '' : ` Os ganáis ${ganado}.`}`, 'bien', 9);
    this.partida.sonido.efecto(ganado === 'gratis' ? 'sello' : 'monedas');
  }

  /** Manda una orden del tutorial al mundo y pinta lo que devuelva. */
  async orden(orden: OrdenTutorial): Promise<boolean> {
    if (orden === 'empezar') this.reiniciar();
    const r = await this.partida.orden(() => api.tutorial(this.partida.aldeaId, orden));
    if (!r) return false;
    this.partida.aplicar(r.estado);
    return true;
  }

  /** Con un panel abierto la tarjeta se pliega sola; aquí el jugador la abre o la vuelve a plegar a mano. */
  private desplegar(): void {
    const t = this.partida.estado?.tutorial;
    if (this.partida.paneles.hayPanel) this.tarjeta.classList.add('desplegada');
    if (t?.activo && t.oculto) void this.orden('mostrar');
  }

  private plegar(): void {
    if (this.partida.paneles.hayPanel && this.tarjeta.classList.contains('desplegada')) {
      this.tarjeta.classList.remove('desplegada');
      return;
    }
    void this.orden('ocultar');
  }

  private saltar(): void {
    if (!window.confirm('¿Despedir al escriba y saltaros sus lecciones? Podréis empezarlas otra vez, desde la primera, en «Aldeas».')) return;
    void this.orden('saltar');
  }
}
