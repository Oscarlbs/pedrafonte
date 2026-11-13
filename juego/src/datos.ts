// Datos compartidos con el mundo: catálogo de edificios, paisajes y ubicación. Se leen los mismos
// YAML que usa el servidor (contrato de docs/DISENO.md, Parte II §2).
import { parse } from 'yaml';
import edificiosCrudo from '../../mundo/datos/edificios.yaml?raw';
import paisajesCrudo from '../../mundo/datos/paisajes.yaml?raw';
import ubicacionCrudo from '../../config/ubicacion.yaml?raw';

export type Par = [number, number];

export interface EdificioCatalogo {
  clave: string;
  nombre: string;
  categoria: 'vivienda' | 'produccion' | 'servicio' | 'defensa' | 'camino' | 'adorno';
  tam: Par;
  coste: Record<string, number>;
  requisitos?: Record<string, unknown>;
  efecto?: Record<string, unknown>;
  modelo: string;
  descripcion: string;
}

export interface Paisaje {
  nombre: string;
  descripcion: string;
  celdas: number;
  rio: { anchura: number; puntos: Par[] };
  puente: { celda: Par; tam: Par; modelo: string };
  camino: Par[][];
  claro: { centro: Par; radio: number };
  inicio: { choza: Par; hoguera: Par; colonos: Par[]; senor: Par };
  solar_molino: Par;
  bosques: [number, number, number, number][];
  rocas: [number, number, number, number][];
  relieve: { borde: number; cauce: number; ondulacion: number };
  recursos: Record<string, number>;
}

export interface Ubicacion {
  nombre: string;
  latitud: number;
  longitud: number;
  huso: string;
  clima: string;
}

/** Metros que mide el lado de una celda. */
export const LADO_CELDA = 2;

export const CATALOGO: EdificioCatalogo[] = parse(edificiosCrudo) as EdificioCatalogo[];
export const PAISAJES: Record<string, Paisaje> = parse(paisajesCrudo) as Record<string, Paisaje>;
export const UBICACION: Ubicacion = parse(ubicacionCrudo) as Ubicacion;

const porClave = new Map(CATALOGO.map((e) => [e.clave, e]));

export function edificioDeCatalogo(clave: string): EdificioCatalogo | undefined {
  return porClave.get(clave);
}

/** ¿Se pinta en fila enlazándose con sus vecinos (camino, muros, vallas)? */
export function esArrastre(e: EdificioCatalogo): boolean {
  return e.efecto?.['arrastre'] === true;
}

/** Huella en celdas ya girada: con rot impar se intercambian ancho y fondo. */
export function huella(e: EdificioCatalogo, rot: number): Par {
  return rot % 2 === 0 ? [e.tam[0], e.tam[1]] : [e.tam[1], e.tam[0]];
}
