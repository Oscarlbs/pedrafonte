// Sol, luna, estación y hora local reales para la ubicación del señor (config/ubicacion.yaml).
import * as SunCalc from 'suncalc';
import * as THREE from 'three';
import type { Estacion } from './paleta';

export interface Astros {
  /** Altura del sol sobre el horizonte, en grados. */
  solAltura: number;
  /** ¿Es por la mañana? (el sol aún sube). */
  manana: boolean;
  dirSol: THREE.Vector3;
  lunaAltura: number;
  dirLuna: THREE.Vector3;
  /** Fracción iluminada de la luna (0 nueva, 1 llena). */
  lunaFase: number;
  /** Rumbos de brújula, en grados (0 = norte, 90 = este). */
  solRumbo: number;
  lunaRumbo: number;
}

/**
 * Vector unitario hacia un astro. SunCalc 2 da los ángulos en grados y el acimut desde el norte en
 * el sentido de las agujas del reloj (0 = N, 90 = E, 180 = S). En la escena, norte = −z y este = +x.
 */
function direccion(acimut: number, altura: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(acimut);
  const al = THREE.MathUtils.degToRad(altura);
  const c = Math.cos(al);
  return new THREE.Vector3(Math.sin(az) * c, Math.sin(al), -Math.cos(az) * c);
}

export function calcularAstros(fecha: Date, latitud: number, longitud: number): Astros {
  const sol = SunCalc.getPosition(fecha, latitud, longitud);
  const luna = SunCalc.getMoonPosition(fecha, latitud, longitud);
  const fase = SunCalc.getMoonIllumination(fecha);
  return {
    solAltura: sol.altitude,
    manana: sol.azimuth < 180,
    dirSol: direccion(sol.azimuth, sol.altitude),
    lunaAltura: luna.altitude,
    dirLuna: direccion(luna.azimuth, luna.altitude),
    lunaFase: fase.fraction,
    solRumbo: sol.azimuth,
    lunaRumbo: luna.azimuth,
  };
}

export interface FechaLocal {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const formatos = new Map<string, Intl.DateTimeFormat>();

/** Fecha y hora de pared en el huso dado. */
export function enHuso(fecha: Date, huso: string): FechaLocal {
  let f = formatos.get(huso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: huso, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatos.set(huso, f);
  }
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(fecha)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return { anio: v['year'], mes: v['month'], dia: v['day'], hora: v['hour'], minuto: v['minute'], segundo: v['second'] };
}

/** Hora decimal (0–24) en el huso. */
export function horaDecimal(fecha: Date, huso: string): number {
  const l = enHuso(fecha, huso);
  return l.hora + l.minuto / 60 + l.segundo / 3600;
}

/** El mismo día de `base` (en el huso), pero a la hora decimal indicada. */
export function fechaConHora(base: Date, hora: number, huso: string): Date {
  const l = enHuso(base, huso);
  const comoUtc = Date.UTC(l.anio, l.mes - 1, l.dia, l.hora, l.minuto, l.segundo);
  const desfase = comoUtc - Math.floor(base.getTime() / 1000) * 1000;
  return new Date(Date.UTC(l.anio, l.mes - 1, l.dia) + hora * 3600000 - desfase);
}

/** Estación astronómica aproximada; en el hemisferio sur van cambiadas. */
export function estacionDe(fecha: Date, latitud: number, huso: string): Estacion {
  const l = enHuso(fecha, huso);
  const n = l.mes * 100 + l.dia;
  let e: Estacion;
  if (n >= 320 && n < 621) e = 'primavera';
  else if (n >= 621 && n < 923) e = 'verano';
  else if (n >= 923 && n < 1221) e = 'otono';
  else e = 'invierno';
  if (latitud >= 0) return e;
  const opuesta: Record<Estacion, Estacion> = { primavera: 'otono', verano: 'invierno', otono: 'primavera', invierno: 'verano' };
  return opuesta[e];
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function textoFecha(fecha: Date, huso: string): string {
  const l = enHuso(fecha, huso);
  return `${l.dia} de ${MESES[l.mes - 1]}`;
}

export function textoHora(hora: number): string {
  const h = Math.floor(hora) % 24;
  const m = Math.floor((hora - Math.floor(hora)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type Momento = 'amanecer' | 'dia' | 'mediodia' | 'atardecer' | 'noche' | 'luna';

export const MOMENTOS: Momento[] = ['amanecer', 'dia', 'mediodia', 'atardecer', 'noche', 'luna'];

/** Hora decimal local de un momento del día real (según el sol de esa fecha y lugar). */
export function horaDeMomento(momento: Momento, fecha: Date, latitud: number, longitud: number, huso: string): number {
  const t = SunCalc.getTimes(fecha, latitud, longitud);
  const h = (d: Date | null) => (d ? horaDecimal(d, huso) : 12);
  switch (momento) {
    case 'amanecer':
      return h(t.sunrise) + 0.45;
    case 'dia':
      return h(t.solarNoon) - 1.6;
    case 'mediodia':
      return h(t.solarNoon);
    case 'atardecer':
      return h(t.sunset) - 0.75;
    case 'luna': {
      // Primera hora de la noche con la luna baja sobre el horizonte; si esa noche no sale, vale «noche».
      const ocaso = t.sunset ?? t.solarNoon;
      for (let dh = 0.8; dh < 11; dh += 0.1) {
        const cuando = new Date(ocaso.getTime() + dh * 3600000);
        const sol = SunCalc.getPosition(cuando, latitud, longitud).altitude;
        const luna = SunCalc.getMoonPosition(cuando, latitud, longitud).altitude;
        if (sol < -9 && luna > 5 && luna < 26) return (h(ocaso) + dh) % 24;
      }
      return Math.min(23.5, h(t.sunset) + 3.6);
    }
    default:
      return Math.min(23.5, h(t.sunset) + 3.6);
  }
}
