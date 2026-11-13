// Barra superior (recursos, población y fecha) y botonera del señor.
import { api, type Estado } from './api';
import { cifra, dias, h, icono, mayuscula, vaciar } from './dom';
import type { Partida } from './partida';

const NOMBRE_CLIMA: Record<string, string> = {
  despejado: 'despejado', nubes: 'nublado', lluvia: 'lluvia', niebla: 'niebla', tormenta: 'tormenta', nieve: 'nieve',
};

/** El tutorial nombra los botones a su manera: `tropas` es «Hueste» y `pergamino`, «Crónica». */
const BOTON_DE_LECCION: Record<string, string> = { tropas: 'hueste', pergamino: 'cronica' };

const NOMBRE_DEFENSA: [keyof Estado['gobierno']['defensa_partes'], string][] = [
  ['torres', 'torres con guardia y cuarteles'], ['muros', 'muros'], ['tropas', 'tropa en casa'], ['leyes', 'leyes'], ['alianzas', 'alianzas'], ['extra', 'apaños'],
];

/** «Barón de Pedrafonte»; el último título ya lleva su «de». */
export function tituloDe(titulo: string, aldea: string): string {
  return / de /.test(titulo) ? `${titulo}, en ${aldea}` : `${titulo} de ${aldea}`;
}

export class Hud {
  readonly el = h('div', { class: 'hud' });
  private readonly barra = h('div', { class: 'pergamino hud-barra', role: 'status' });
  private readonly botones = h('nav', { class: 'hud-botones', 'aria-label': 'Gobierno de la aldea' });
  private readonly insignias = new Map<string, HTMLElement>();
  private readonly porNombre = new Map<string, HTMLButtonElement>();
  private readonly vigia: ResizeObserver | null;

  constructor(private readonly partida: Partida) {
    this.el.append(this.barra, this.botones);
    // La barra crece hacia abajo cuando hay muchos avisos: lo que cuelga de ella (paneles, avisos, tutorial) baja con ella.
    this.vigia = 'ResizeObserver' in window
      ? new ResizeObserver(() => partida.raiz.style.setProperty('--hud-bajo', `${Math.round(this.barra.getBoundingClientRect().bottom)}px`))
      : null;
    this.vigia?.observe(this.barra);
    this.boton('construir', 'Construir', 'Colocar, girar y derribar edificios (C)', () => partida.constructor_.alternar());
    this.boton('consejo', 'Consejo', 'Las peticiones de hoy', () => partida.paneles.alternar('consejo'));
    this.boton('cartas', 'Cartas', 'Mensajes de los señores vecinos', () => partida.paneles.alternar('cartas'));
    this.boton('mercader', 'Mercader', 'Tratar con quien está de paso', () => partida.paneles.alternar('mercader'));
    this.boton('leyes', 'Leyes', 'Tributos y leyes', () => partida.paneles.alternar('leyes'));
    this.boton('vecinos', 'Vecinos', 'Quién vive en la aldea', () => partida.paneles.alternar('vecinos'));
    this.boton('hueste', 'Hueste', 'Vuestra tropa: alistar, licenciar y lo que cuesta mantenerla', () => partida.paneles.alternar('hueste'));
    this.boton('mapa', 'Mapa', 'El mapa de la comarca: vecinos, embajadas y campañas (M)', () => partida.mapa.alternar());
    this.boton('cronica', 'Crónica', 'El pergamino del escriba', () => void partida.paneles.abrirPergamino());
    this.boton('bitacora', 'Bitácora', 'Todo lo que ha ido pasando', () => partida.paneles.alternar('bitacora'));
    this.boton('aldeas', 'Aldeas', 'Cambiar de aldea o fundar otra', () => partida.paneles.alternar('aldeas'));
    this.boton('adelantar', 'Adelantar un día', 'Que pase un día entero de golpe', () => void this.adelantar(), 'boton-lacre');
    this.boton('sonido', 'Sonido: no', 'Ambiente del valle (sin archivos: se genera al vuelo)', () => this.alternarSonido());
  }

  private boton(nombre: string, texto: string, ayuda: string, accion: () => void, clase = ''): void {
    const insignia = h('span', { class: 'insignia oculto' });
    const b = h('button', { class: `boton ${clase}`, type: 'button', title: ayuda, onclick: accion, 'data-boton': nombre }, texto, insignia);
    this.insignias.set(nombre, insignia);
    this.porNombre.set(nombre, b);
    this.botones.append(b);
  }

  private marca(nombre: string, cuantos: number, texto = String(cuantos)): void {
    const insignia = this.insignias.get(nombre);
    if (!insignia) return;
    insignia.textContent = texto;
    insignia.classList.toggle('oculto', cuantos <= 0);
  }

  /** Señala con un latido el botón que pide la lección en curso (o ninguno). */
  destacar(boton: string | null): void {
    const nombre = boton ? (BOTON_DE_LECCION[boton] ?? boton) : null;
    for (const [clave, b] of this.porNombre) b.classList.toggle('latido', clave === nombre);
  }

  private async adelantar(): Promise<void> {
    const boton = this.porNombre.get('adelantar');
    if (!boton || boton.disabled) return;
    boton.disabled = true;
    boton.firstChild!.textContent = 'Pasando el día…';
    const r = await this.partida.orden(() => api.adelantar(this.partida.aldeaId));
    boton.disabled = false;
    boton.firstChild!.textContent = 'Adelantar un día';
    if (!r) return;
    this.partida.aplicar(r.estado);
    this.partida.sonido.efecto('campana');
    if (!r.estado.gobierno.perdida) void this.partida.paneles.abrirPergamino();
  }

  private alternarSonido(): void {
    const activo = this.partida.sonido.alternar();
    this.porNombre.get('sonido')!.firstChild!.textContent = activo ? 'Sonido: sí' : 'Sonido: no';
  }

  pintar(e: Estado): void {
    vaciar(this.barra);
    const dato = (nombreIcono: string, valor: string, titulo: string, clase = '') =>
      h('span', { class: `hud-dato ${clase}`, title: titulo }, icono(nombreIcono), h('b', null, valor));
    const neto = e.balance?.neto ?? {};
    const cambio = (r: string) => {
      const v = Math.round(neto[r] ?? 0);
      return e.balance ? ` (ayer ${v >= 0 ? '+' : ''}${v})` : '';
    };
    const r = e.recursos;
    const p = e.poblacion;
    const g = e.guerra;
    // Los sueldos y tributos dejan picos (0,3 de oro): en la barra se enseña lo que hay entero.
    const hay = (recurso: string) => String(Math.floor(r[recurso] ?? 0));
    const partes = e.gobierno.defensa_partes;
    const desglose = NOMBRE_DEFENSA.filter(([clave]) => partes[clave] > 0).map(([clave, nombre]) => `${nombre} ${cifra(partes[clave])}`).join(' · ');
    const piezas: (HTMLElement | null)[] = [
      // Sin la cartela de arriba (ui=0), el título del señor va aquí.
      document.querySelector('.cartela') ? null : h('span', { class: 'hud-titulo' }, tituloDe(g.titulo, e.aldea.nombre)),
      dato('grano', hay('grano'), `Grano${cambio('grano')}`),
      dato('madera', hay('madera'), `Madera${cambio('madera')}`),
      dato('piedra', hay('piedra'), `Piedra${cambio('piedra')}`),
      dato('oro', hay('oro'), `Oro${cambio('oro')}`),
      h('span', { class: 'separador' }),
      dato('harina', hay('harina'), `Harina${cambio('harina')}`, 'menor'),
      dato('pan', hay('pan'), `Pan${cambio('pan')} · comida para ${cifra(p.dias_comida)} días`, p.dias_comida < 3 ? 'alerta' : 'menor'),
      h('span', { class: 'separador' }),
      dato('gente', `${p.vecinos}/${p.plazas}`, `${p.vecinos} vecinos y ${p.plazas} plazas de vivienda${p.sin_techo ? ` · ${p.sin_techo} duermen al raso` : ''}`, p.sin_techo ? 'alerta' : ''),
      h('span', { class: 'hud-texto', title: `Ánimo medio: ${p.animo} de 100` }, `Ánimo: ${p.animo_texto}`),
      h('span', { class: `hud-texto ${p.opinion < -20 ? 'alerta' : ''}`, title: `Opinión media sobre vos: ${p.opinion} (de −100 a 100)` }, mayuscula(p.opinion_texto)),
      h('span', { class: 'separador' }),
      dato('escudo', cifra(e.gobierno.defensa), `Defensa de la aldea: ${cifra(e.gobierno.defensa)}${desglose ? ` (${desglose})` : '. Ni torre, ni muro, ni lanza: lo que venga, entra'}`, 'menor defensa'),
      dato('lanza', String(g.tropas), g.tropas
        ? `Tropa en casa: ${g.tropas} ${g.tropas === 1 ? 'hombre' : 'hombres'}, que valen ${cifra(g.fuerza)} en campo abierto${g.campana ? ' (la hueste que está fuera no cuenta)' : ''}`
        : `Sin tropa en casa${g.campana ? ': está toda en campaña' : '. Se alista en «Hueste»'}`, 'menor tropa'),
      h('span', { class: 'separador' }),
      h('span', { class: 'hud-fecha', title: `Estación: ${e.tiempo.estacion_texto} · ${e.clima.origen === 'real' ? 'clima real' : 'clima figurado'}` },
        `Día ${e.tiempo.dia} · ${e.tiempo.fecha_texto} · ${NOMBRE_CLIMA[e.clima.tipo] ?? e.clima.tipo}, ${e.clima.temperatura} °C`),
    ];
    this.barra.append(...piezas.filter((x): x is HTMLElement => x !== null));
    // Con `accion`, la etiqueta es un botón (las de guerra llevan al mapa).
    const etiqueta = (texto: string, clase: string, titulo = '', accion?: () => void) => this.barra.append(accion
      ? h('button', { class: `hud-etiqueta ${clase}`, type: 'button', title: titulo, onclick: accion }, texto)
      : h('span', { class: `hud-etiqueta ${clase}`, title: titulo }, texto));
    const alMapa = () => void this.partida.mapa.abrir();
    if (e.tiempo.fiesta) etiqueta(`Hoy: ${e.tiempo.fiesta}`, 'bien');
    if (e.tiempo.desfase_dias) etiqueta(`+${e.tiempo.desfase_dias} d adelantados`, '', 'Días adelantados con el botón sobre la fecha real');
    const amenaza = e.gobierno.amenaza;
    const cuando = (n: number) => (n <= 0 ? 'esta noche' : `en ${dias(n)}`);
    if (g.asedio || amenaza?.clave === 'asedio') {
      etiqueta(`¡Cercados!${amenaza?.fuerza ? ` Unas ${amenaza.fuerza} lanzas al otro lado del río` : ''}`, 'mal guerra',
        'Estáis cercados: nadie entra ni sale y el grano mengua. El cerco se levanta si aguantáis más que ellos; los arqueros en el muro lo acortan.', alMapa);
    } else if (amenaza && (amenaza.clave === 'hueste' || amenaza.clave === 'mesnada')) {
      etiqueta(`Viene ${amenaza.nombre}${amenaza.fuerza ? `: unas ${amenaza.fuerza} lanzas,` : ':'} ${cuando(amenaza.dias)}`, 'mal guerra',
        `Si vuestra defensa (${cifra(e.gobierno.defensa)}) no llega a sus lanzas, entran. Hay tiempo para cerrar muros, alistar gente… o mandar un presente.`, alMapa);
    } else if (amenaza) {
      etiqueta(`${mayuscula(amenaza.nombre)}: ${cuando(amenaza.dias)}`, 'mal', 'Hay aviso de amenaza: reforzad la defensa');
    }
    if (g.campana) {
      etiqueta(g.campana.fase === 'ida'
        ? `La hueste, camino de ${g.campana.nombre}: ${g.campana.dias <= 0 ? 'llega esta noche' : dias(g.campana.dias)}`
        : `La hueste vuelve de ${g.campana.nombre}: ${g.campana.dias <= 0 ? 'llega esta noche' : dias(g.campana.dias)}`, 'guerra',
      'Mientras la hueste está fuera, lo que mandasteis no defiende la aldea. La batalla se da al llegar; el botín entra al volver.', alMapa);
    }
    if (g.vasallo_de) {
      const amo = e.vecinos.find((v) => v.clave === g.vasallo_de);
      etiqueta(`Sois vasallo de ${amo?.senor ?? 'otro señor'}`, 'mal guerra', 'Le pagáis tributo cada noche. En el mapa podéis comprar vuestra libertad… o ganarla por las armas.', alMapa);
    }
    if (e.gobierno.peste) etiqueta('Peste', 'mal', 'Hay fiebre en la aldea: pozo, curandera y cuarentena ayudan');
    if (e.gobierno.revuelta.activa) etiqueta('¡Revuelta!', 'mal', 'Los vecinos se han plantado. Mejorad su opinión o bajad la tensión');
    else if (e.gobierno.revuelta.avisos > 0) etiqueta('Malestar', 'mal', 'Se oyen corrillos: opinión muy baja y tensión alta');
    for (const promesa of e.gobierno.promesas) etiqueta(`Prometido: ${promesa.texto} (día ${promesa.vence})`, '', 'Una promesa vuestra con fecha');

    this.marca('consejo', e.consejo.length);
    this.marca('cartas', e.mensajes.length);
    this.marca('mercader', e.visitantes.length);
    this.marca('mapa', g.asedio || amenaza?.clave === 'hueste' || amenaza?.clave === 'mesnada' ? 1 : 0, '!');
    this.porNombre.get('mercader')?.classList.toggle('oculto', e.visitantes.length === 0);
  }

  marcarActivo(nombre: string | null): void {
    for (const [clave, b] of this.porNombre) b.classList.toggle('activo', clave === nombre);
  }

  desmontar(): void {
    this.vigia?.disconnect();
  }
}
