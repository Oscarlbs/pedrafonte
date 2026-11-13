// Construir sobre la cuadrícula invisible: elegir del catálogo, vista previa bajo el puntero, girar,
// colocar (o tender una fila de camino, muro o valla con dos clics) y derribar.
import { CATALOGO, edificioDeCatalogo, esArrastre, huella, type EdificioCatalogo } from '../datos';
import type { Puntero } from '../mundo';
import { api } from './api';
import { h, textoCoste, vaciar } from './dom';
import type { Partida } from './partida';

const CATEGORIAS: [string, string][] = [
  ['vivienda', 'Viviendas'], ['produccion', 'Producción'], ['servicio', 'Servicios'], ['defensa', 'Defensa'],
  ['camino', 'Caminos'], ['adorno', 'Adornos'],
];

type Modo = { tipo: 'colocar'; clave: string; rot: number; inicio: [number, number] | null } | { tipo: 'derribar' } | null;

export class Constructor {
  readonly el = h('div', { class: 'pergamino menu-construir oculto', role: 'dialog', 'aria-label': 'Construir' });
  private readonly pestanas = h('div', { class: 'fila pestanas' });
  private readonly lista = h('div', { class: 'catalogo' });
  private readonly detalle = h('p', { class: 'nota detalle' }, 'Elegid qué levantar y pinchad en el valle.');
  private categoria = 'vivienda';
  private modo: Modo = null;
  private ultima: { cx: number; cz: number } | null = null;

  constructor(private readonly partida: Partida) {
    const derribar = h('button', { class: 'boton', type: 'button', onclick: () => this.elegirDerribar(), title: 'Pinchad después en lo que queráis quitar' }, 'Derribar');
    const girar = h('button', { class: 'boton', type: 'button', onclick: () => this.girar(), title: 'Girar un cuarto de vuelta (R)' }, 'Girar');
    const cerrar = h('button', { class: 'boton', type: 'button', onclick: () => this.cerrar() }, 'Cerrar');
    this.el.append(
      h('div', { class: 'fila cabecera-construir' }, h('h2', { class: 'titulo' }, 'Construir'), this.pestanas, h('span', { class: 'hueco' }), girar, derribar, cerrar),
      this.lista,
      this.detalle,
    );
    this.pintar();
  }

  get abierto(): boolean {
    return !this.el.classList.contains('oculto');
  }

  alternar(): void {
    if (this.abierto) this.cerrar();
    else this.abrir();
  }

  abrir(): void {
    this.el.classList.remove('oculto');
    this.partida.hud.marcarActivo('construir');
    this.pintar();
  }

  cerrar(): void {
    this.cancelar();
    this.el.classList.add('oculto');
    this.partida.hud.marcarActivo(null);
  }

  /** Deja de colocar o derribar. Devuelve true si había algo que cancelar. */
  cancelar(): boolean {
    if (!this.modo) return false;
    this.modo = null;
    this.partida.mundo.vistaPrevia(null);
    this.explicar();
    this.pintar();
    return true;
  }

  pintar(): void {
    vaciar(this.pestanas);
    for (const [clave, nombre] of CATEGORIAS) {
      this.pestanas.append(h('button', {
        class: `boton pestana ${clave === this.categoria ? 'activo' : ''}`, type: 'button',
        onclick: () => { this.categoria = clave; this.pintar(); },
      }, nombre));
    }
    vaciar(this.lista);
    const recursos = this.partida.estado?.recursos ?? {};
    for (const e of CATALOGO.filter((x) => x.categoria === this.categoria)) {
      const alcanza = Object.entries(e.coste ?? {}).every(([k, v]) => (recursos[k] ?? 0) >= v);
      const elegido = this.modo?.tipo === 'colocar' && this.modo.clave === e.clave;
      this.lista.append(h('button', {
        class: `ficha-edificio ${elegido ? 'activo' : ''} ${alcanza ? '' : 'caro'}`, type: 'button', title: e.descripcion,
        onclick: () => this.elegir(e.clave),
        onpointerenter: () => this.explicar(e),
        onpointerleave: () => this.explicar(),
      }, h('b', null, e.nombre), h('span', { class: 'nota' }, textoCoste(e.coste ?? {}))));
    }
  }

  private explicar(e?: EdificioCatalogo): void {
    const ficha = e ?? (this.modo?.tipo === 'colocar' ? edificioDeCatalogo(this.modo.clave) : undefined);
    if (this.modo?.tipo === 'derribar' && !e) {
      this.detalle.textContent = 'Derribar: pinchad en el edificio, camino o muro que queráis quitar. Se recupera la mitad de la madera y la piedra. Esc para dejarlo.';
      return;
    }
    if (!ficha) {
      this.detalle.textContent = 'Elegid qué levantar y pinchad en el valle.';
      return;
    }
    const partes = [ficha.descripcion, `Ocupa ${ficha.tam[0]} × ${ficha.tam[1]} celdas.`, this.requisitos(ficha)];
    if (!e && this.modo?.tipo === 'colocar') {
      partes.push(esArrastre(ficha)
        ? (this.modo.inicio ? 'Segundo clic: hasta dónde llega la fila.' : 'Primer clic: dónde empieza la fila. Segundo clic: dónde acaba.')
        : 'Pinchad en el valle para levantarlo. R gira, Esc cancela.');
    }
    this.detalle.textContent = partes.filter(Boolean).join(' ');
  }

  private requisitos(e: EdificioCatalogo): string {
    const r = (e.requisitos ?? {}) as { poblacion?: number; edificios?: string[]; terreno?: string; unico?: boolean };
    const partes: string[] = [];
    if (r.poblacion) partes.push(`al menos ${r.poblacion} vecinos`);
    for (const clave of r.edificios ?? []) partes.push(edificioDeCatalogo(clave)?.nombre.toLowerCase() ?? clave);
    if (r.terreno === 'orilla') partes.push('tocar la orilla del río');
    if (r.unico) partes.push('solo puede haber uno');
    return partes.length ? `Pide: ${partes.join(', ')}.` : '';
  }

  private elegir(clave: string): void {
    this.modo = { tipo: 'colocar', clave, rot: 0, inicio: null };
    this.pintar();
    this.explicar();
  }

  private elegirDerribar(): void {
    this.partida.mundo.vistaPrevia(null);
    this.modo = { tipo: 'derribar' };
    this.pintar();
    this.explicar();
  }

  private girar(): void {
    if (this.modo?.tipo !== 'colocar') return;
    this.modo.rot = (this.modo.rot + 1) % 4;
    if (this.ultima) this.previsualizar(this.ultima.cx, this.ultima.cz);
  }

  alTeclear(ev: KeyboardEvent): void {
    if (ev.key === 'r' || ev.key === 'R') this.girar();
    else if ((ev.key === 'c' || ev.key === 'C') && !ev.metaKey && !ev.ctrlKey) this.alternar();
  }

  // ───────────── en el valle ─────────────

  alMover(ev: Puntero): void {
    if (this.modo?.tipo !== 'colocar') return;
    const celda = this.esquina(ev);
    if (!celda) {
      this.partida.mundo.vistaPrevia(null);
      return;
    }
    this.ultima = celda;
    this.previsualizar(celda.cx, celda.cz);
  }

  /** La celda bajo el puntero es el centro de la huella; el motor quiere la esquina. */
  private esquina(ev: Puntero): { cx: number; cz: number } | null {
    if (this.modo?.tipo !== 'colocar') return null;
    const celda = this.partida.mundo.celdaBajoPuntero(ev);
    const ficha = edificioDeCatalogo(this.modo.clave);
    if (!celda || !ficha) return null;
    const [ancho, fondo] = huella(ficha, this.modo.rot);
    return { cx: celda.cx - Math.floor((ancho - 1) / 2), cz: celda.cz - Math.floor((fondo - 1) / 2) };
  }

  private previsualizar(cx: number, cz: number): void {
    if (this.modo?.tipo !== 'colocar') return;
    const { clave, rot } = this.modo;
    this.partida.mundo.vistaPrevia({ clave, cx, cz, rot, valido: this.motivo(clave, cx, cz, rot) === null });
  }

  /** Por qué no se puede construir ahí (o null si se puede). El motor del mundo tiene la última palabra. */
  private motivo(clave: string, cx: number, cz: number, rot: number): string | null {
    const mundo = this.partida.mundo;
    const ficha = edificioDeCatalogo(clave);
    if (!ficha) return 'No existe.';
    const [ancho, fondo] = huella(ficha, rot);
    const n = mundo.datosPaisaje().celdas;
    let orilla = false;
    for (let i = 0; i < ancho; i++) {
      for (let j = 0; j < fondo; j++) {
        const x = cx + i;
        const z = cz + j;
        if (x < 0 || z < 0 || x >= n || z >= n) return 'Se sale del valle.';
        const tipo = mundo.tipoCelda(x, z);
        if (tipo === 'agua') return 'Ahí hay río.';
        if (tipo === 'puente') return 'No se puede construir sobre el puente.';
        if (mundo.ocupante(x, z) || mundo.caminoEn(x, z)) return 'Ese sitio ya está ocupado.';
        if (tipo === 'camino') return 'Por ahí pasa el camino real.';
        orilla ||= tipo === 'orilla';
      }
    }
    if ((ficha.requisitos as { terreno?: string } | undefined)?.terreno === 'orilla' && !orilla) return `${ficha.nombre} tiene que tocar la orilla del río.`;
    const recursos = this.partida.estado?.recursos ?? {};
    if (!Object.entries(ficha.coste ?? {}).every(([k, v]) => (recursos[k] ?? 0) >= v)) return `No alcanza: cuesta ${textoCoste(ficha.coste ?? {})}.`;
    return null;
  }

  /** Clic en el valle. Devuelve true si el clic era para construir o derribar. */
  alPulsar(ev: Puntero): boolean {
    if (!this.modo) return false;
    if (this.modo.tipo === 'derribar') {
      void this.derribar(ev);
      return true;
    }
    const celda = this.esquina(ev);
    const ficha = edificioDeCatalogo(this.modo.clave);
    if (!celda || !ficha) return true;
    if (esArrastre(ficha)) {
      if (!this.modo.inicio) {
        this.modo.inicio = [celda.cx, celda.cz];
        this.explicar();
        return true;
      }
      const celdas = fila(this.modo.inicio, [celda.cx, celda.cz]);
      this.modo.inicio = null;
      void this.construir(ficha, { celdas });
      return true;
    }
    const motivo = this.motivo(ficha.clave, celda.cx, celda.cz, this.modo.rot);
    if (motivo) {
      this.partida.avisar(motivo, 'mal', 4);
      this.partida.sonido.efecto('no');
      return true;
    }
    void this.construir(ficha, { cx: celda.cx, cz: celda.cz });
    return true;
  }

  private async construir(ficha: EdificioCatalogo, donde: { cx?: number; cz?: number; celdas?: [number, number][] }): Promise<void> {
    if (this.modo?.tipo !== 'colocar') return;
    const rot = this.modo.rot;
    const r = await this.partida.orden(() => api.construir(this.partida.aldeaId, { clave: ficha.clave, rot, ...donde }));
    if (!r) return;
    for (const e of r.construidos) this.partida.mundo.ponerEdificio({ id: `e${e.id}`, clave: e.clave, cx: e.cx, cz: e.cz, rot: e.rot });
    this.partida.sonido.efecto('obra');
    if (r.fallos.length) this.partida.avisar(`${r.fallos.length} ${r.fallos.length === 1 ? 'tramo no se pudo' : 'tramos no se pudieron'} poner: ${r.fallos[0].motivo}`, 'mal');
    // Lo grande se pone de uno en uno; caminos, muros y adornos, los que hagan falta.
    if (!esArrastre(ficha) && ficha.categoria !== 'adorno') {
      this.modo = null;
      this.partida.mundo.vistaPrevia(null);
    }
    this.explicar();
    await this.partida.refrescar();
  }

  private async derribar(ev: Puntero): Promise<void> {
    const mundo = this.partida.mundo;
    const celda = mundo.celdaBajoPuntero(ev);
    const objeto = mundo.objetoBajoPuntero(ev);
    const id = (objeto?.tipo === 'edificio' ? objeto.id : undefined) ?? (celda ? mundo.ocupante(celda.cx, celda.cz) ?? mundo.caminoEn(celda.cx, celda.cz) : undefined);
    if (!id?.startsWith('e')) return;
    const r = await this.partida.orden(() => api.derribar(this.partida.aldeaId, Number(id.slice(1))));
    if (!r) return;
    mundo.quitarEdificio(id);
    this.partida.sonido.efecto('derribo');
    const devuelto = textoCoste(r.devuelto);
    if (devuelto !== 'gratis') this.partida.avisar(`Derribado. Se recupera: ${devuelto}.`, '', 4);
    await this.partida.refrescar();
  }
}

/** Celdas de una fila en L entre dos puntos: primero a lo largo del eje más largo, luego el otro. */
function fila(a: [number, number], b: [number, number]): [number, number][] {
  const celdas: [number, number][] = [];
  let [x, z] = a;
  const porX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const paso = (desde: number, hasta: number) => (hasta > desde ? 1 : -1);
  celdas.push([x, z]);
  const avanzarX = () => { while (x !== b[0]) { x += paso(x, b[0]); celdas.push([x, z]); } };
  const avanzarZ = () => { while (z !== b[1]) { z += paso(z, b[1]); celdas.push([x, z]); } };
  if (porX) { avanzarX(); avanzarZ(); } else { avanzarZ(); avanzarX(); }
  return celdas.slice(0, 120);
}
