// Paneles del señor: ficha y charla de cada vecino, consejo, leyes y tributos, cartas de los vecinos,
// mercader, hueste, pergamino del escriba, bitácora, lista de vecinos, aldeas y fin de partida.
import { edificioDeCatalogo } from '../datos';
import { api, type Carta, type ClaveUnidad, type Estado, type Ficha, type Opcion, type Recursos, type Unidad } from './api';
import { cifra, dias, h, mayuscula, textoCoste, vaciar } from './dom';
import type { Partida } from './partida';
import { costePor, NOMBRE_OBJETIVO, textoTropas } from './tropa';

type Nombre = 'consejo' | 'leyes' | 'cartas' | 'mercader' | 'bitacora' | 'aldeas' | 'vecinos' | 'ficha' | 'edificio' | 'hueste';

const NOMBRE_TIPO_CARTA: Record<string, string> = {
  comercio: 'Oferta de comercio', boda: 'Propuesta de boda', alianza: 'Propuesta de alianza', amenaza: 'Amenaza', cortesia: 'Cortesía',
};

export class Paneles {
  readonly el = h('div', { class: 'paneles' });
  private readonly lateral = h('aside', { class: 'pergamino panel oculto', 'aria-live': 'polite' });
  private readonly velo = h('div', { class: 'velo oculto' });
  private abierto: Nombre | null = null;
  private fichaId = 0;
  private edificioId = 0;
  private conversacion: { quien: 'senor' | 'vecino'; texto: string }[] = [];
  /** Paso de la confirmación de «Empezar de cero» (0: sin pedir). */
  private pasoReinicio = 0;

  constructor(private readonly partida: Partida) {
    this.el.append(this.lateral, this.velo);
  }

  /** ¿Hay un panel lateral abierto? */
  get hayPanel(): boolean {
    return this.abierto !== null;
  }

  get enHueste(): boolean {
    return this.abierto === 'hueste';
  }

  /** El panel abierto que tiene botón en la botonera (la ficha de un vecino o de un edificio no lo tienen). */
  get nombreAbierto(): string | null {
    return this.abierto === 'ficha' || this.abierto === 'edificio' ? null : this.abierto;
  }

  // ───────────── abrir y cerrar ─────────────

  alternar(nombre: Nombre): void {
    if (this.abierto === nombre) this.cerrar();
    else this.abrir(nombre);
  }

  abrir(nombre: Nombre): void {
    this.abierto = nombre;
    this.pasoReinicio = 0;
    this.lateral.classList.remove('oculto');
    this.partida.hud.marcarActivo(nombre);
    this.partida.alCambiarPanel(true);
    if (nombre === 'hueste') {
      // La tropa por tipo, los cupos y los precios vienen con el mapa de la comarca.
      if (!this.partida.comarca) this.marco('Hueste', h('p', { class: 'nota' }, 'Pasando revista…'));
      void this.partida.cargarComarca();
      if (!this.partida.comarca) return;
    }
    this.pintar();
  }

  abrirPorNombre(nombre: string): void {
    if (nombre === 'pergamino') void this.abrirPergamino();
    else if (nombre === 'construir') this.partida.constructor_.abrir();
    else if (nombre === 'ficha') {
      const primero = this.partida.estado?.aldeanos[0];
      if (primero) void this.abrirFicha(primero.id);
    } else if (nombre === 'mapa' || nombre.startsWith('mapa:')) {
      const [, territorio, objetivo] = nombre.split(':');
      void this.partida.mapa.abrir(territorio, objetivo);
    } else if (['consejo', 'leyes', 'cartas', 'mercader', 'bitacora', 'aldeas', 'vecinos', 'hueste'].includes(nombre)) {
      this.abrir(nombre as Nombre);
    }
  }

  cerrar(): void {
    this.abierto = null;
    this.lateral.classList.add('oculto');
    this.velo.classList.add('oculto');
    vaciar(this.velo);
    this.partida.hud.marcarActivo(null);
    this.partida.alCambiarPanel(false);
  }

  cerrarSiEsFicha(): void {
    if (this.abierto === 'ficha' || this.abierto === 'edificio') this.cerrar();
  }

  alCambiarEstado(_estado: Estado): void {
    if (this.abierto && !['ficha', 'bitacora', 'aldeas'].includes(this.abierto)) this.pintar();
  }

  alLlegarSuceso(): void {
    if (this.abierto === 'bitacora') this.pintar();
  }

  /** Ha llegado un mapa de la comarca nuevo: el panel «Hueste» vive de él. */
  alCambiarComarca(): void {
    if (this.abierto === 'hueste') this.pintar();
  }

  private marco(titulo: string, ...contenido: (Node | string | null | undefined | false)[]): void {
    // Si se repinta el mismo panel (un +1 en la hueste, una ley que cambia), no se pierde por dónde se iba leyendo.
    const mismo = this.lateral.querySelector('.panel-cabecera .titulo')?.textContent === titulo;
    const arriba = mismo ? (this.lateral.querySelector('.panel-cuerpo')?.scrollTop ?? 0) : 0;
    vaciar(this.lateral);
    const cuerpo = h('div', { class: 'panel-cuerpo' }, ...contenido);
    this.lateral.append(
      h('header', { class: 'fila panel-cabecera' },
        h('h2', { class: 'titulo' }, titulo),
        h('button', { class: 'boton cerrar', type: 'button', onclick: () => this.cerrar(), 'aria-label': 'Cerrar' }, '×')),
      cuerpo,
    );
    cuerpo.scrollTop = arriba;
  }

  private pintar(): void {
    const e = this.partida.estado;
    if (!e || !this.abierto) return;
    if (this.abierto === 'consejo') this.pintarConsejo(e);
    else if (this.abierto === 'leyes') this.pintarLeyes(e);
    else if (this.abierto === 'cartas') this.pintarCartas(e);
    else if (this.abierto === 'mercader') this.pintarMercader(e);
    else if (this.abierto === 'vecinos') this.pintarVecinos(e);
    else if (this.abierto === 'bitacora') void this.pintarBitacora();
    else if (this.abierto === 'aldeas') void this.pintarAldeas();
    else if (this.abierto === 'edificio') this.pintarEdificio(e);
    else if (this.abierto === 'hueste') this.pintarHueste(e);
  }

  /** Botones de las opciones de una petición o una carta. */
  private opciones(opciones: Opcion[], alElegir: (clave: string) => void): HTMLElement {
    return h('div', { class: 'columna opciones' }, opciones.map((o) => {
      const coste = textoCoste(o.coste);
      return h('button', { class: 'boton opcion', type: 'button', disabled: !o.disponible, onclick: () => alElegir(o.clave), title: o.disponible ? '' : 'El arca no da para tanto' },
        h('span', null, o.texto),
        coste !== 'gratis' && h('span', { class: 'nota' }, `Cuesta ${coste}`),
        o.pista && h('span', { class: 'nota pista' }, o.pista));
    }));
  }

  // ───────────── consejo ─────────────

  private pintarConsejo(e: Estado): void {
    const cuerpo = e.consejo.length
      ? e.consejo.map((p) => {
        const quien = this.partida.aldeano(p.peticionario_id ?? 0);
        return h('article', { class: 'tarjeta' },
          h('h3', { class: 'subtitulo' }, p.titulo),
          quien && h('p', { class: 'etiqueta' }, `Pide audiencia: ${quien.nombre}, ${quien.oficio_nombre}`),
          h('p', null, p.texto),
          this.opciones(p.opciones, (opcion) => void this.decidir(p.id, opcion)));
      })
      : [h('p', { class: 'nota' }, 'Hoy nadie pide audiencia. Disfrutadlo: mañana volverán, y con más ganas.')];
    this.marco('Consejo', h('p', { class: 'nota' }, 'Lo que dejéis más de un día sin decidir se decidirá solo, y casi nunca a vuestro favor.'), ...cuerpo);
  }

  private async decidir(peticion: number, opcion: string): Promise<void> {
    const r = await this.partida.orden(() => api.decidir(this.partida.aldeaId, peticion, opcion));
    if (!r) return;
    this.partida.sonido.efecto('sello');
    this.partida.avisar(r.peticion.resultado, '', 10);
    this.partida.aplicar(r.estado);
  }

  // ───────────── leyes y tributos ─────────────

  private pintarLeyes(e: Estado): void {
    const config = this.partida.config;
    if (!config) return;
    const tributos = h('div', { class: 'fila tributos' }, config.impuestos.nombres.map((nombre, nivel) =>
      h('button', { class: `boton ${nivel === e.gobierno.impuestos ? 'activo' : ''}`, type: 'button', onclick: () => void this.tributos(nivel) }, nombre)));
    const leyes = config.leyes.map((ley) => {
      const vigente = e.gobierno.leyes.includes(ley.clave);
      return h('article', { class: `tarjeta ${vigente ? 'vigente' : ''}` },
        h('div', { class: 'fila' }, h('h3', { class: 'subtitulo' }, ley.nombre), h('span', { class: 'hueco' }),
          h('button', { class: `boton ${vigente ? 'activo' : ''}`, type: 'button', onclick: () => void this.ley(ley.clave, !vigente) }, vigente ? 'Derogar' : 'Promulgar')),
        h('p', { class: 'nota' }, ley.descripcion));
    });
    this.marco('Leyes y tributos',
      h('h3', { class: 'subtitulo' }, 'Tributos'),
      h('p', { class: 'nota' }, 'Cuanto más cobréis, más oro entra y peor os miran. Subirlos duele al momento; bajarlos se agradece, pero menos.'),
      tributos,
      h('p', { class: 'etiqueta' }, `Tensión en la aldea: ${e.gobierno.tension} de 100 · Defensa: ${e.gobierno.defensa}`),
      h('h3', { class: 'subtitulo' }, 'Leyes'), ...leyes);
  }

  private async tributos(nivel: number): Promise<void> {
    const estado = await this.partida.orden(() => api.impuestos(this.partida.aldeaId, nivel));
    if (estado) this.partida.aplicar(estado);
  }

  private async ley(clave: string, activa: boolean): Promise<void> {
    const estado = await this.partida.orden(() => api.ley(this.partida.aldeaId, clave, activa));
    if (!estado) return;
    this.partida.sonido.efecto('sello');
    this.partida.aplicar(estado);
  }

  // ───────────── cartas de los vecinos ─────────────

  private pintarCartas(e: Estado): void {
    const carta = (c: Carta) => h('article', { class: 'tarjeta carta' },
      h('p', { class: 'etiqueta' }, `${NOMBRE_TIPO_CARTA[c.tipo] ?? 'Carta'} · ${c.remitente}`),
      h('p', { class: 'letra' }, c.texto),
      this.opciones(c.opciones, (opcion) => void this.contestar(c.id, opcion)));
    const vecinos = e.vecinos.map((v) => h('li', null, h('b', null, `${v.nombre}: `), `${v.senor}. ${v.caracter} `,
      h('span', { class: `nota ${v.relacion < -15 ? 'mal' : v.relacion > 15 ? 'bien' : ''}` }, `(${v.relacion_texto}${e.gobierno.alianzas.includes(v.clave) ? ', aliados' : ''})`)));
    this.marco('Cartas',
      ...(e.mensajes.length ? e.mensajes.map(carta) : [h('p', { class: 'nota' }, 'No hay cartas pendientes. Los vecinos callan, que no es lo mismo que estar tranquilos.')]),
      h('h3', { class: 'subtitulo' }, 'Las aldeas vecinas'), h('ul', { class: 'lista' }, vecinos));
  }

  private async contestar(carta: number, opcion: string): Promise<void> {
    const r = await this.partida.orden(() => api.contestar(this.partida.aldeaId, carta, opcion));
    if (!r) return;
    this.partida.sonido.efecto('sello');
    this.partida.avisar(r.mensaje.resultado, '', 10);
    this.partida.aplicar(r.estado);
  }

  // ───────────── mercader ─────────────

  abrirMercader(): void {
    this.abrir('mercader');
  }

  private pintarMercader(e: Estado): void {
    if (!e.visitantes.length) {
      this.marco('De paso', h('p', { class: 'nota' }, 'No hay nadie de paso. Con un puesto de mercado vendrían más a menudo.'));
      return;
    }
    this.marco('De paso', ...e.visitantes.map((v) => h('article', { class: 'tarjeta' },
      h('h3', { class: 'subtitulo' }, mayuscula(v.nombre)),
      h('p', null, v.descripcion),
      v.noticia && h('p', { class: 'letra' }, `«${v.noticia}»`),
      h('div', { class: 'columna opciones' }, v.ofertas.map((o) => {
        const puede = o.quedan > 0 && Object.entries(o.coste).every(([k, n]) => (e.recursos[k] ?? 0) >= n);
        return h('button', { class: 'boton opcion', type: 'button', disabled: !puede, onclick: () => void this.comerciar(v.id, o.clave) },
          h('span', null, o.texto), h('span', { class: 'nota' }, o.quedan > 0 ? `Quedan ${o.quedan}` : 'Agotado'));
      })))));
  }

  private async comerciar(visitante: number, oferta: string): Promise<void> {
    const r = await this.partida.orden(() => api.comerciar(this.partida.aldeaId, visitante, oferta));
    if (!r) return;
    this.partida.sonido.efecto('monedas');
    this.partida.aplicar(r.estado);
  }

  // ───────────── vecinos y ficha ─────────────

  private pintarVecinos(e: Estado): void {
    const fila = (a: Estado['aldeanos'][number]) => h('button', { class: 'boton vecino', type: 'button', onclick: () => void this.abrirFicha(a.id) },
      h('span', { class: 'punto', style: `background:${a.color}` }),
      h('span', { class: 'columna' }, h('b', null, a.nombre), h('span', { class: 'nota' }, `${mayuscula(a.oficio_nombre)} · ${a.animo_texto} · ${a.opinion_texto}`)),
      h('span', { class: 'nota' }, a.sitio ? a.sitio.actividad_texto : ''));
    this.marco(`Vecinos (${e.aldeanos.length})`,
      h('p', { class: 'nota' }, 'Pinchad en uno (aquí o en el valle) para ver su ficha y hablar con él.'),
      ...e.aldeanos.map(fila));
  }

  async abrirFicha(id: number): Promise<void> {
    const ficha = await this.partida.orden(() => api.ficha(this.partida.aldeaId, id));
    if (!ficha) return;
    if (this.fichaId !== id) this.conversacion = [];
    this.fichaId = id;
    this.abierto = 'ficha';
    this.lateral.classList.remove('oculto');
    this.partida.hud.marcarActivo(null);
    this.partida.alCambiarPanel(true);
    this.pintarFicha(ficha);
  }

  private pintarFicha(f: Ficha): void {
    const barra = (valor: number, minimo: number, maximo: number) =>
      h('span', { class: 'medidor' }, h('span', { style: `width:${Math.round(((valor - minimo) / (maximo - minimo)) * 100)}%` }));
    const entrada = h('input', { class: 'entrada', type: 'text', maxLength: 300, placeholder: `Decidle algo a ${f.apodo}…`, 'aria-label': 'Hablar' });
    const registro = h('div', { class: 'charla-registro' }, this.conversacion.map((c) =>
      h('p', { class: c.quien === 'senor' ? 'dice-senor' : 'dice-vecino' }, c.quien === 'senor' ? `Vos: ${c.texto}` : c.texto)));
    const enviar = async () => {
      const texto = entrada.value.trim();
      if (!texto) return;
      entrada.value = '';
      this.conversacion.push({ quien: 'senor', texto });
      const r = await this.partida.orden(() => api.charla(this.partida.aldeaId, f.id, texto));
      if (!r) return;
      this.conversacion.push({ quien: 'vecino', texto: r.respuesta });
      this.partida.mundo.decir(`v${f.id}`, r.respuesta, 7);
      this.partida.sonido.efecto('voz');
      if (r.revelado) this.partida.avisar(`${f.nombre} os ha confiado su secreto.`, 'bien', 8);
      if (this.abierto === 'ficha' && this.fichaId === f.id) this.pintarFicha(r.ficha);
      void this.partida.refrescar();
    };
    entrada.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void enviar();
    });
    this.marco(f.nombre,
      h('p', { class: 'etiqueta' }, [mayuscula(f.oficio_nombre), f.edad ? `${f.edad} años` : '', f.dia_llegada ? `en la aldea desde el día ${f.dia_llegada}` : ''].filter(Boolean).join(' · ')),
      h('p', null, f.caracter),
      h('div', { class: 'tarjeta charla' },
        registro,
        h('div', { class: 'fila charla-entrada' }, entrada, h('button', { class: 'boton boton-lacre', type: 'button', onclick: () => void enviar() }, 'Decir'))),
      h('dl', { class: 'datos' },
        h('dt', null, 'Ánimo'), h('dd', null, barra(f.animo, 0, 100), ` ${f.animo_texto}`),
        h('dt', null, 'Sobre vos'), h('dd', null, barra(f.opinion, -100, 100), ` ${f.opinion_texto}`),
        h('dt', null, 'Salud'), h('dd', null, barra(f.salud, 0, 100), f.hambre > 0 ? ' pasa hambre' : ''),
        h('dt', null, 'Bolsa'), h('dd', null, `${f.dinero} monedas${f.debe ? ` · debe ${f.debe.cantidad}` : ''}`),
        h('dt', null, 'Ahora'), h('dd', null, f.sitio ? `${f.sitio.actividad_texto}, en ${f.sitio.lugar}` : '—'),
        h('dt', null, 'Quiere'), h('dd', null, f.objetivo),
        h('dt', null, 'Calla'), h('dd', { class: f.secreto ? '' : 'nota' }, f.secreto ?? 'Algo calla, como todos. Ganaos su confianza y preguntad.')),
      f.relaciones.length > 0 && h('h3', { class: 'subtitulo' }, 'Con los demás'),
      h('ul', { class: 'lista relaciones' }, f.relaciones.map((r) =>
        h('li', { title: r.nota }, h('button', { class: 'enlace', type: 'button', onclick: () => void this.abrirFicha(r.id) }, r.nombre),
          h('span', { class: `nota ${r.valor < -20 ? 'mal' : r.valor > 20 ? 'bien' : ''}` }, ` ${r.texto}`)))),
      f.recuerdos.length > 0 && h('h3', { class: 'subtitulo' }, 'Lo último que recuerda'),
      h('ul', { class: 'lista recuerdos' }, f.recuerdos.map((r) => h('li', null, h('span', { class: 'etiqueta' }, `Día ${r.dia} `), r.texto))));
    registro.scrollTop = registro.scrollHeight;
  }

  // ───────────── edificio ─────────────

  abrirEdificio(id: number): void {
    this.edificioId = id;
    this.abrir('edificio');
    this.partida.hud.marcarActivo(null);
  }

  private pintarEdificio(e: Estado): void {
    const edificio = e.edificios.find((x) => x.id === this.edificioId);
    const ficha = edificio && edificioDeCatalogo(edificio.clave);
    if (!edificio || !ficha) {
      this.cerrar();
      return;
    }
    const viven = e.aldeanos.filter((a) => a.casa_id === edificio.id);
    const trabajan = e.aldeanos.filter((a) => a.trabajo_id === edificio.id);
    const efecto = (ficha.efecto ?? {}) as Record<string, unknown>;
    const lineas: string[] = [];
    if (efecto['vivienda']) lineas.push(`Vivienda para ${String(efecto['vivienda'])}.`);
    if (efecto['produce']) lineas.push(`Produce al día: ${textoCoste(efecto['produce'] as Record<string, number>)}${efecto['estacional'] ? ' (según la estación)' : ''}.`);
    if (efecto['consume']) lineas.push(`Gasta: ${textoCoste(efecto['consume'] as Record<string, number>)}.`);
    if (efecto['trabajadores'] && !trabajan.length) lineas.push('Nadie lo atiende: sin trabajador no rinde.');
    const gente = (titulo: string, lista: typeof viven) => lista.length > 0 && h('p', null, h('span', { class: 'etiqueta' }, `${titulo}: `),
      lista.map((a, i) => [i ? ', ' : '', h('button', { class: 'enlace', type: 'button', onclick: () => void this.abrirFicha(a.id) }, a.nombre)]).flat());
    this.marco(ficha.nombre,
      h('p', null, ficha.descripcion),
      ...lineas.map((l) => h('p', { class: 'nota' }, l)),
      gente('Viven aquí', viven), gente('Trabajan aquí', trabajan),
      h('div', { class: 'fila' },
        h('button', { class: 'boton', type: 'button', onclick: () => void this.girarEdificio(edificio.id) }, 'Girar'),
        h('button', { class: 'boton', type: 'button', onclick: () => void this.derribarEdificio(edificio.id, ficha.nombre) }, 'Derribar')));
  }

  private async girarEdificio(id: number): Promise<void> {
    if (await this.partida.orden(() => api.girar(this.partida.aldeaId, id))) await this.partida.refrescar();
  }

  private async derribarEdificio(id: number, nombre: string): Promise<void> {
    if (!window.confirm(`¿Derribar ${nombre.toLowerCase()}? Se recupera la mitad de la madera y la piedra.`)) return;
    if (await this.partida.orden(() => api.derribar(this.partida.aldeaId, id))) {
      this.cerrar();
      await this.partida.refrescar();
    }
  }

  // ───────────── hueste ─────────────

  private pintarHueste(e: Estado): void {
    const c = this.partida.comarca;
    if (!c) return;
    const fuera = c.campana?.tropas ?? {};
    const enCasa = c.unidades.reduce((n, u) => n + (c.tropas[u.clave] ?? 0), 0);
    const sueldo: Recursos = {};
    for (const u of c.unidades) {
      const hombres = (c.tropas[u.clave] ?? 0) + (fuera[u.clave] ?? 0);
      for (const [recurso, cuanto] of Object.entries(u.sueldo)) sueldo[recurso] = (sueldo[recurso] ?? 0) + cuanto * hombres;
    }
    const medidor = (usado: number, cupo: number) => h('span', { class: 'medidor' }, h('span', { style: `width:${cupo > 0 ? Math.min(100, Math.round((usado / cupo) * 100)) : 0}%` }));
    const resumen = h('article', { class: 'tarjeta' },
      h('p', null, enCasa
        ? h('b', null, `${enCasa} ${enCasa === 1 ? 'hombre' : 'hombres'} en casa`)
        : h('b', null, 'Nadie en armas'),
      enCasa ? ` · valen ${cifra(c.fuerza)} en campo abierto` : '. Hoy por hoy os defienden los muros, si los hay, y la buena suerte.'),
      h('dl', { class: 'datos' },
        h('dt', null, 'Cuartel'), h('dd', null, medidor(c.cupos.sueldo_usado, c.cupos.sueldo), ` ${c.cupos.sueldo_usado} de ${c.cupos.sueldo} camas`,
          c.cupos.sueldo === 0 && h('span', { class: 'nota' }, ' · sin cuartel no hay hombres de armas')),
        h('dt', null, 'Milicia'), h('dd', null, medidor(c.cupos.milicia_usada, c.cupos.milicia), ` ${c.cupos.milicia_usada} de ${c.cupos.milicia}`,
          h('span', { class: 'nota' }, ' · un hombre por cada dos vecinos')),
        h('dt', null, 'Sueldo'), h('dd', null, textoCoste(sueldo) === 'gratis' ? 'nada, de momento' : `${textoCoste(sueldo)} cada noche`)),
      h('p', { class: 'nota' }, 'Cobran cada noche, estén en casa o en campaña. Si no hay con qué, parte de la tropa se marcha, y con vuestras lanzas.'));
    const campana = c.campana && h('article', { class: 'tarjeta vigente' },
      h('h3', { class: 'subtitulo' }, 'En campaña'),
      h('p', null, c.campana.fase === 'ida'
        ? `${mayuscula(textoTropas(c.campana.tropas, c.unidades))} van camino de ${c.campana.nombre}, ${NOMBRE_OBJETIVO[c.campana.objetivo] ?? ''}. ${c.campana.dias <= 0 ? 'Llegan esta noche' : `Llegan en ${dias(c.campana.dias)}`}.`
        : `${mayuscula(textoTropas(c.campana.tropas, c.unidades))} vuelven de ${c.campana.nombre}${c.campana.victoria ? ', con la victoria' : ', con el rabo entre las piernas'}. ${c.campana.dias <= 0 ? 'Entran esta noche' : `Entran en ${dias(c.campana.dias)}`}.`),
      c.campana.texto && h('p', { class: 'letra' }, c.campana.texto),
      h('p', { class: 'nota' }, 'Mientras estén fuera no defienden la aldea, y no puede salir otra hueste.'),
      h('button', { class: 'boton', type: 'button', onclick: () => void this.partida.mapa.abrir() }, 'Verlo en el mapa'));
    const unidad = (u: Unidad) => {
      const hay = c.tropas[u.clave] ?? 0;
      const lejos = fuera[u.clave] ?? 0;
      const libres = u.clave === 'milicia' ? c.cupos.milicia - c.cupos.milicia_usada : c.cupos.sueldo - c.cupos.sueldo_usado;
      const puede = (n: number) => u.disponible && libres >= n && Object.entries(u.coste).every(([k, v]) => (e.recursos[k] ?? 0) >= v * n);
      const porque = (n: number) => !u.disponible ? `Falta: ${u.falta.join(' y ').toLowerCase()}`
        : libres < n ? (u.clave === 'milicia' ? 'No quedan brazos: la milicia sale de vuestros vecinos' : 'No quedan camas en el cuartel: levantad otro')
          : puede(n) ? `Cuesta ${textoCoste(costePor(u.coste, n))}` : `El arca no da: cuesta ${textoCoste(costePor(u.coste, n))}`;
      const alistar = (n: number) => h('button', {
        class: 'boton', type: 'button', disabled: !puede(n), title: porque(n), 'data-alistar': `${u.clave}:${n}`,
        onclick: () => void this.alistar(u.clave, n),
      }, `+${n}`);
      const licenciar = (n: number) => h('button', {
        class: 'boton', type: 'button', disabled: hay < n, title: hay < n ? 'No tenéis tantos en casa' : 'Mandarlos a casa: el coste de alistarlos no se devuelve',
        'data-licenciar': `${u.clave}:${n}`, onclick: () => void this.licenciar(u.clave, n),
      }, `−${n}`);
      return h('article', { class: `tarjeta unidad ${u.disponible ? '' : 'sin-requisito'}`, 'data-unidad': u.clave },
        h('div', { class: 'fila' }, h('h3', { class: 'subtitulo' }, u.nombre), h('span', { class: 'hueco' }),
          h('b', { class: 'unidad-cuantos' }, `${hay} en casa`), lejos > 0 && h('span', { class: 'nota' }, `+${lejos} fuera`)),
        h('p', { class: 'nota' }, u.descripcion),
        h('p', { class: 'unidad-cifras' },
          `Fuerza ${cifra(u.fuerza)}`, u.en_muro !== u.fuerza && ` (${cifra(u.en_muro)} tras un muro)`,
          ` · alistar: ${textoCoste(u.coste)} · sueldo: ${textoCoste(u.sueldo)} al día`),
        !u.disponible && h('p', { class: 'mal' }, `Para tener ${u.plural} hace falta ${u.falta.join(' y ').toLowerCase()}.`),
        h('div', { class: 'fila unidad-botones' },
          h('span', { class: 'etiqueta' }, 'Alistar'), alistar(1), alistar(5), h('span', { class: 'hueco' }),
          h('span', { class: 'etiqueta' }, 'Licenciar'), licenciar(1), licenciar(5)));
    };
    const partes = c.aldea.defensa_partes;
    const fila = (nombre: string, valor: number, nota = '') => [h('dt', null, nombre), h('dd', null, cifra(valor), nota && h('span', { class: 'nota' }, ` · ${nota}`))];
    this.marco('Hueste',
      resumen, campana,
      ...c.unidades.map(unidad),
      h('h3', { class: 'subtitulo' }, 'La defensa de la aldea'),
      h('p', { class: 'nota' }, 'Es lo que se mide contra las lanzas de quien venga. Si llega, se van; si no llega y hay muros y pan, os cercan; si no, entran.'),
      h('dl', { class: 'datos defensa' },
        ...fila('Torres y cuarteles', partes.torres, 'las torres solo cuentan con guardia dentro'),
        ...fila('Muros', partes.muros, 'empalizada y muralla'),
        ...fila('Tropa en casa', partes.tropas, partes.muros > 0 ? 'vale más tras el muro' : 'sin muro, lo que vale en campo abierto'),
        ...fila('Leyes', partes.leyes),
        ...fila('Alianzas', partes.alianzas, 'cada aliado acude con lo suyo'),
        ...(partes.extra ? fila('Apaños', partes.extra, 'de un día para otro') : []),
        h('dt', { class: 'total' }, 'Total'), h('dd', { class: 'total' }, h('b', null, cifra(c.aldea.defensa)))));
  }

  private async alistar(clave: ClaveUnidad, cantidad: number): Promise<void> {
    const r = await this.partida.orden(() => api.alistar(this.partida.aldeaId, clave, cantidad));
    if (!r) return;
    this.partida.sonido.efecto('monedas');
    this.partida.aplicarComarca(r);
  }

  private async licenciar(clave: ClaveUnidad, cantidad: number): Promise<void> {
    const r = await this.partida.orden(() => api.licenciar(this.partida.aldeaId, clave, cantidad));
    if (r) this.partida.aplicarComarca(r);
  }

  // ───────────── bitácora ─────────────

  private async pintarBitacora(): Promise<void> {
    const sucesos = await this.partida.orden(() => api.sucesos(this.partida.aldeaId));
    if (!sucesos || this.abierto !== 'bitacora') return;
    this.marco('Bitácora', h('ul', { class: 'lista bitacora' }, sucesos.map((s) =>
      h('li', { class: `suceso-${s.tipo}` }, h('span', { class: 'etiqueta' }, `Día ${s.dia}, ${String(s.hora).padStart(2, '0')} h `), s.texto))));
  }

  // ───────────── pergamino del escriba ─────────────

  async abrirPergamino(): Promise<void> {
    const r = await this.partida.orden(() => api.pergamino(this.partida.aldeaId));
    if (!r) return;
    vaciar(this.velo);
    const cerrar = () => {
      this.velo.classList.add('oculto');
      vaciar(this.velo);
      void api.pergaminoLeido(this.partida.aldeaId).catch(() => undefined);
      this.partida.refrescarPronto();
    };
    const c = r.cronica;
    const hoja = h('section', { class: 'pergamino rollo', role: 'dialog', 'aria-label': 'Pergamino del escriba' },
      h('h2', { class: 'titulo' }, !c ? 'Crónica' : c.dia === 0 ? 'Primera hoja del escriba' : `Crónica del día ${c.dia}`),
      ...(c
        ? [
          ...c.texto.split(/\n\s*\n/).map((parrafo) => h('p', { class: 'letra' }, parrafo)),
          c.opiniones.length > 0 && h('h3', { class: 'subtitulo' }, 'Lo que opina el escriba de vuestro gobierno'),
          h('ul', { class: 'lista opiniones' }, c.opiniones.map((o) => h('li', null, o))),
        ]
        : [h('p', { class: 'letra' }, 'El escriba aún no ha escrito nada: la aldea acaba de fundarse. Esta noche, al cerrar el día, dejará aquí su primera crónica. Y sus opiniones, que las tiene.')]),
      h('div', { class: 'fila fin-rollo' }, h('button', { class: 'boton boton-lacre', type: 'button', onclick: cerrar }, 'Enterado')));
    this.velo.append(hoja);
    this.velo.classList.remove('oculto');
    this.partida.sonido.efecto('pergamino');
  }

  // ───────────── aldeas ─────────────

  private async pintarAldeas(): Promise<void> {
    const config = this.partida.config;
    const aldeas = await this.partida.orden(() => api.aldeas());
    if (!config || !aldeas || this.abierto !== 'aldeas') return;
    const nombre = h('input', { class: 'entrada', type: 'text', maxLength: 40, placeholder: 'Nombre de la aldea', 'aria-label': 'Nombre' });
    const selector = (opciones: Record<string, { nombre: string; descripcion: string }>, porDefecto: string) => {
      const s = h('select', { class: 'campo' }, Object.entries(opciones).map(([clave, o]) => h('option', { value: clave, title: o.descripcion }, o.nombre)));
      s.value = porDefecto;
      return s;
    };
    const paisaje = selector(config.paisajes, 'valle');
    const tono = selector(config.tonos, 'cuento');
    const dificultad = selector(config.dificultades, 'normal');
    const explicacion = h('p', { class: 'nota' });
    const explicar = () => {
      explicacion.textContent = [config.paisajes[paisaje.value]?.descripcion, config.tonos[tono.value]?.descripcion, config.dificultades[dificultad.value]?.descripcion].filter(Boolean).join(' ');
    };
    for (const s of [paisaje, tono, dificultad]) s.addEventListener('change', explicar);
    explicar();
    const abandonar = async (id: number, nombreAldea: string) => {
      if (!window.confirm(`¿Abandonar ${nombreAldea} para siempre? Se borra la aldea entera, con sus vecinos y su crónica. No se puede deshacer.`)) return;
      if (await this.partida.orden(() => api.borrarAldea(id))) void this.pintarAldeas();
    };
    const fundar = async () => {
      const r = await this.partida.orden(() => api.crearAldea({ nombre: nombre.value.trim() || 'Aldea nueva', paisaje: paisaje.value, tono: tono.value, dificultad: dificultad.value }));
      if (!r) return;
      this.cerrar();
      await this.partida.entrar(r.id);
      this.partida.avisar(`Fundada ${r.nombre}: un claro, una choza, una hoguera y cuatro colonos.`, 'bien', 8);
    };
    // Lo que se puede hacer con la aldea en la que se está: retomar las lecciones y empezar de cero.
    const tutorial = this.partida.estado?.tutorial;
    const empezarTutorial = async () => {
      if (!(await this.partida.tutorial.orden('empezar'))) return;
      this.cerrar();
      this.partida.avisar('El escriba vuelve a abrir el cuaderno por la primera hoja.', 'bien', 7);
    };
    const reiniciar = async (nombreAldea: string) => {
      const id = this.partida.aldeaId;
      const r = await this.partida.orden(() => api.reiniciar(id));
      if (!r) return;
      this.cerrar();
      await this.partida.entrar(id);
      this.partida.avisar(`${nombreAldea} vuelve a ser un claro, una choza, una hoguera y cuatro colonos. Día 1.`, 'bien', 9);
    };
    const pedirReinicio = (paso: number) => {
      this.pasoReinicio = paso;
      void this.pintarAldeas();
    };
    const aqui = (nombreAldea: string) => h('div', { class: 'columna aldea-aqui' },
      h('div', { class: 'fila aldea-acciones' },
        tutorial && !tutorial.activo && h('button', {
          class: 'boton', type: 'button', 'data-aldea': 'tutorial', onclick: () => void empezarTutorial(),
          title: tutorial.terminado ? 'Repetir las lecciones del escriba desde la primera' : 'Las lecciones del escriba, desde la primera',
        }, 'Empezar el tutorial'),
        this.pasoReinicio === 0 && h('button', {
          class: 'boton', type: 'button', 'data-aldea': 'reiniciar', title: 'Borrarlo todo y volver al día 1 en este mismo sitio', onclick: () => pedirReinicio(1),
        }, 'Empezar de cero')),
      this.pasoReinicio === 1 && h('div', { class: 'columna aviso-reinicio', role: 'alertdialog', 'aria-label': 'Empezar de cero' },
        h('p', null, `¿Empezar ${nombreAldea} de cero? Se pierde todo: edificios, vecinos, crónicas, tropa, vasallos y lo que haya en el arca. Queda el sitio, el nombre y el día 1.`),
        h('div', { class: 'fila' },
          h('button', { class: 'boton', type: 'button', 'data-aldea': 'reiniciar-seguir', onclick: () => pedirReinicio(2) }, 'Sí, empezar de cero'),
          h('button', { class: 'boton', type: 'button', onclick: () => pedirReinicio(0) }, 'No, dejadlo estar'))),
      this.pasoReinicio === 2 && h('div', { class: 'columna aviso-reinicio', role: 'alertdialog', 'aria-label': 'Empezar de cero: última confirmación' },
        h('p', null, h('b', null, 'Última vez que lo pregunto. '), 'Esto no se puede deshacer: ni el escriba guarda copia.'),
        h('div', { class: 'fila' },
          h('button', { class: 'boton boton-lacre', type: 'button', 'data-aldea': 'reiniciar-ya', onclick: () => void reiniciar(nombreAldea) }, 'Borrarlo todo y empezar'),
          h('button', { class: 'boton', type: 'button', onclick: () => pedirReinicio(0) }, 'Me lo he pensado mejor'))));
    this.marco('Aldeas',
      ...aldeas.map((a) => h('article', { class: `tarjeta ${a.id === this.partida.aldeaId ? 'vigente' : ''}` },
        h('div', { class: 'fila' },
          h('span', { class: 'columna' }, h('b', null, a.nombre),
            h('span', { class: 'nota' }, `${config.paisajes[a.paisaje]?.nombre ?? a.paisaje} · ${config.tonos[a.tono]?.nombre ?? a.tono} · ${config.dificultades[a.dificultad]?.nombre ?? a.dificultad} · día ${a.dia}`)),
          h('span', { class: 'hueco' }),
          a.id === this.partida.aldeaId
            ? h('span', { class: 'etiqueta' }, 'Estáis aquí')
            : [
              h('button', { class: 'boton', type: 'button', onclick: () => { this.cerrar(); void this.partida.entrar(a.id); } }, 'Ir'),
              h('button', { class: 'boton', type: 'button', title: 'Borra esta aldea para siempre', onclick: () => void abandonar(a.id, a.nombre) }, 'Abandonar'),
            ]),
        a.id === this.partida.aldeaId && aqui(a.nombre))),
      h('h3', { class: 'subtitulo' }, 'Fundar otra aldea'),
      h('div', { class: 'columna formulario' },
        h('label', { class: 'etiqueta' }, 'Nombre', nombre),
        h('label', { class: 'etiqueta' }, 'Paisaje', paisaje),
        h('label', { class: 'etiqueta' }, 'Tono', tono),
        h('label', { class: 'etiqueta' }, 'Dificultad', dificultad),
        explicacion,
        h('button', { class: 'boton boton-lacre', type: 'button', onclick: () => void fundar() }, 'Fundar')));
  }

  // ───────────── fin de partida ─────────────

  abrirFin(): void {
    const motivo = this.partida.estado?.gobierno.motivo_perdida ?? 'La aldea ya no os obedece.';
    vaciar(this.velo);
    const perdon = async () => {
      const estado = await this.partida.orden(() => api.perdon(this.partida.aldeaId));
      if (!estado) return;
      this.velo.classList.add('oculto');
      vaciar(this.velo);
      this.partida.aplicar(estado);
      this.partida.avisar('Os dan otra oportunidad. Una.', 'bien', 8);
    };
    this.velo.append(h('section', { class: 'pergamino rollo', role: 'alertdialog', 'aria-label': 'Fin' },
      h('h2', { class: 'titulo' }, 'Os han echado'),
      h('p', { class: 'letra' }, motivo),
      h('p', { class: 'nota' }, 'Podéis volver por el puente, pedir perdón en la plaza y entregar el arca. Los vecinos son rencorosos, pero no tanto.'),
      h('div', { class: 'fila fin-rollo' }, h('button', { class: 'boton boton-lacre', type: 'button', onclick: () => void perdon() }, 'Pedir perdón y volver'))));
    this.velo.classList.remove('oculto');
  }
}
