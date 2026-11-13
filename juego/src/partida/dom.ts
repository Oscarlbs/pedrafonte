// Ayudas para montar la interfaz a mano, sin bibliotecas.

type Hijo = Node | string | null | undefined | false;

/** Crea un elemento: h('button', {class: 'boton', onclick: fn}, 'Texto'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tipo: K,
  atributos: Record<string, unknown> | null = null,
  ...hijos: (Hijo | Hijo[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tipo);
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') el.className = String(valor);
    else if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), valor as EventListener);
    else if (clave in el && clave !== 'list') (el as unknown as Record<string, unknown>)[clave] = valor;
    else el.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo);
  }
  return el;
}

export function vaciar(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

const TRAZOS: Record<string, string> = {
  grano: '<path d="M12 21V9M12 9c-2-1-3-3-3-5 2 0 3 2 3 5Zm0 0c2-1 3-3 3-5-2 0-3 2-3 5Zm0 5c-2-1-4-1-5-3 2-1 4 0 5 3Zm0 0c2-1 4-1 5-3-2-1-4 0-5 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  madera: '<path d="M4 9h13a3 3 0 0 1 0 6H4a3 3 0 0 1 0-6Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="12" r="1.2" fill="currentColor"/><path d="M7 12h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  piedra: '<path d="M4 17l2-7 5-4 6 2 3 6-2 4H6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 6l1 6 6 2M12 12l-6 5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  oro: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  pan: '<path d="M4 14c0-4 3.5-7 8-7s8 3 8 7c0 2-1.5 3-3 3H7c-1.5 0-3-1-3-3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 10l1.5 3M12.5 9.5 14 12.500M16 10.500l1 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  harina: '<path d="M7 8h10l2 11H5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 8c0-2 1.500-3 4-3s4 1 4 3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  gente: '<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.500 19c0-3 2.500-5 5.500-5s5.500 2 5.500 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="17" cy="9" r="2.300" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M16 14c2.500 0 4.500 1.700 4.500 4.500" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  escudo: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6Z" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linejoin="round"/>',
  lanza: '<path d="M5 20 16.500 8.500" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linecap="round"/><path d="M15 7l5-3-3 5Z" fill="none" stroke="currentColor" stroke-width="1.500" stroke-linejoin="round"/><path d="M8 13.500l2.500 2.500" stroke="currentColor" stroke-width="1.400" stroke-linecap="round"/>',
};

/** Icono pequeño de línea (dibujado aquí: no se descarga nada). */
export function icono(nombre: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icono');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = TRAZOS[nombre] ?? '';
  return svg;
}

export const NOMBRE_RECURSO: Record<string, string> = {
  grano: 'grano', madera: 'madera', piedra: 'piedra', oro: 'oro', harina: 'harina', pan: 'pan',
};

/** Un número como se escribe en castellano: sin decimales de más y con coma («2,5»). */
export function cifra(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** «16 de madera y 4 de piedra» (o «gratis»). */
export function textoCoste(coste: Record<string, number>): string {
  const partes = Object.entries(coste).filter(([, v]) => v > 0).map(([k, v]) => `${cifra(v)} de ${NOMBRE_RECURSO[k] ?? k}`);
  if (!partes.length) return 'gratis';
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** «1 día», «3 días». */
export function dias(n: number): string {
  return `${n} ${n === 1 ? 'día' : 'días'}`;
}

export function mayuscula(texto: string): string {
  return texto ? texto[0].toUpperCase() + texto.slice(1) : texto;
}
