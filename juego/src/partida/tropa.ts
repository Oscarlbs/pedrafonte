// Cuentas y textos de la tropa que comparten el mapa de la comarca y el panel «Hueste».
// Los precios, sueldos y fuerzas vienen siempre del mundo (`Comarca.unidades`); aquí solo se suman.
import type { Recursos, Tropas, Unidad } from './api';

/** «8 lanceros y 2 jinetes», con los nombres que da el mundo («nadie» si no hay ninguno). */
export function textoTropas(tropas: Tropas, unidades: Unidad[]): string {
  const partes = unidades
    .filter((u) => (tropas[u.clave] ?? 0) > 0)
    .map((u) => `${tropas[u.clave]} ${tropas[u.clave] === 1 ? u.plural.replace(/s$/, '') : u.plural}`);
  if (!partes.length) return 'nadie';
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

export function totalTropas(tropas: Tropas): number {
  return Object.values(tropas).reduce((n, v) => n + (v ?? 0), 0);
}

/** Lo que pesan en batalla: en campo abierto o, con `enMuro`, defendiendo tras muralla o empalizada. */
export function fuerzaTropas(tropas: Tropas, unidades: Unidad[], enMuro = false): number {
  return unidades.reduce((n, u) => n + (tropas[u.clave] ?? 0) * (enMuro ? u.en_muro : u.fuerza), 0);
}

export function costePor(coste: Recursos, n: number): Recursos {
  return Object.fromEntries(Object.entries(coste).map(([k, v]) => [k, v * n]));
}

export const NOMBRE_OBJETIVO: Record<string, string> = { saquear: 'a saquear', someter: 'a someter', conquistar: 'a conquistar' };
