// Arranque del juego. Tres vistas: «Aldea» (la partida, si el mundo responde), «Inicio» y «Escaparate».
// Para la partida: &aldea=2 (entrar en esa aldea)  &pergamino=0
//   &panel=consejo|construir|leyes|cartas|mercader|vecinos|ficha|bitacora|aldeas|pergamino|hueste|mapa
//   (el mapa admite un territorio y un objetivo: panel=mapa:meiras abre su ficha; panel=mapa:meiras:someter, el compositor de campaña)
// Admite parámetros en la URL para previsualizar y para
// las capturas automáticas:
//   ?vista=partida|inicio|escaparate  &hora=18.5  &clima=real|despejado|nubes|lluvia|niebla|tormenta|nieve
//   &estacion=primavera|verano|otono|invierno  &fecha=2026-06-21  &paisaje=valle|ribera|montana|bosque
//   &cam=azimut,elevacion,distancia[,cx,cz]  &mira=luna|sol  &ui=0  &captura=1  &pixeles=1.5
// «hora» admite también un momento del día real: amanecer, dia, mediodia, atardecer, noche o luna.
import './ui/estilo.css';
import { PAISAJES, UBICACION } from './datos';
import { horaDeMomento, MOMENTOS, type Momento } from './escena/astros';
import { CLIMAS, type TipoClima } from './escena/clima';
import { ESTACIONES, type Estacion } from './escena/paleta';
import { crearMundo, type Mundo } from './mundo';
import { crearVistaPartida } from './partida/partida';
import { crearPanel } from './ui/panel';
import { vistaEscaparate } from './vistas/escaparate';
import { vistaInicio } from './vistas/inicio';
import type { Vista } from './vistas/vista';

interface EstadoAldea {
  /** true cuando la escena está cargada, montada y dibujada. */
  listo: boolean;
  error: string | null;
  mundo: Mundo | null;
  vista: string | null;
  info: () => ReturnType<Mundo['info']> | null;
  /** Cambia de vista por código (lo usa el script de capturas). */
  irA: (clave: string) => Promise<void>;
}

declare global {
  interface Window {
    __aldea: EstadoAldea;
  }
}

const VISTAS: Vista[] = [vistaInicio, vistaEscaparate];

/** ¿Responde el servidor del mundo? Sin él solo se enseña la escena (Inicio y Escaparate). */
async function hayMundo(): Promise<boolean> {
  try {
    const respuesta = await fetch('/api/salud', { signal: AbortSignal.timeout(2500) });
    return respuesta.ok && ((await respuesta.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}
const params = new URLSearchParams(location.search);
const captura = params.get('captura') === '1';

window.__aldea = { listo: false, error: null, mundo: null, vista: null, info: () => null, irA: async () => {} };

async function arrancar(): Promise<void> {
  const lienzo = document.getElementById('lienzo') as HTMLCanvasElement;
  const interfaz = document.getElementById('interfaz') as HTMLElement;
  // La partida de verdad («Aldea») solo existe si el mundo está arrancado.
  const conMundo = await hayMundo();
  if (conMundo) {
    const aldea = Number(params.get('aldea'));
    VISTAS.unshift(crearVistaPartida(interfaz, { panel: params.get('panel'), sinPergamino: params.get('pergamino') === '0', aldea: aldea > 0 ? aldea : null }));
  }
  const pixeles = Number(params.get('pixeles'));
  const paisaje = params.get('paisaje') ?? undefined;
  const mundo = await crearMundo(lienzo, {
    pixeles: pixeles > 0 ? pixeles : undefined,
    quieto: captura,
    paisaje: paisaje && PAISAJES[paisaje] ? paisaje : undefined,
  });

  // Lo que se fija por URL.
  const fechaTxt = params.get('fecha');
  const fechaFija = fechaTxt && !Number.isNaN(Date.parse(fechaTxt)) ? new Date(`${fechaTxt}T12:00:00`) : null;
  // La hora puede ser un número o un momento del día real (amanecer, dia, mediodia, atardecer, noche).
  const horaTxt = params.get('hora');
  let hora: number | null = null;
  if (horaTxt && (MOMENTOS as string[]).includes(horaTxt)) {
    hora = horaDeMomento(horaTxt as Momento, fechaFija ?? new Date(), UBICACION.latitud, UBICACION.longitud, UBICACION.huso);
  } else if (horaTxt !== null && horaTxt !== '' && !Number.isNaN(Number(horaTxt))) {
    hora = Number(horaTxt);
  }
  const climaTxt = params.get('clima');
  const clima = climaTxt && (CLIMAS as string[]).includes(climaTxt) ? (climaTxt as TipoClima) : null;
  const estTxt = params.get('estacion');
  const estacion = estTxt && (ESTACIONES as string[]).includes(estTxt) ? (estTxt as Estacion) : null;
  if (fechaFija) mundo.fijarFecha(fechaFija);
  if (hora !== null) mundo.fijarHora(hora);
  if (clima) mundo.fijarClima(clima);
  if (estacion) mundo.fijarEstacion(estacion);

  let desmontar: (() => void) | null = null;
  let panel: ReturnType<typeof crearPanel> | null = null;
  const irA = async (clave: string): Promise<void> => {
    const vista = VISTAS.find((v) => v.clave === clave) ?? VISTAS[0];
    window.__aldea.listo = false;
    desmontar?.();
    desmontar = vista.montar(mundo);
    mundo.camara.fijar(vista.camara(mundo), true);
    window.__aldea.vista = vista.clave;
    panel?.marcarVista(vista.clave);
    await mundo.asentar(captura ? 12 : 3);
    window.__aldea.listo = true;
  };

  if (params.get('ui') !== '0') {
    panel = crearPanel(interfaz, mundo, VISTAS.map((v) => ({ clave: v.clave, nombre: v.nombre })), (clave) => void irA(clave));
    panel.sincronizar({ hora, clima, estacion });
  }
  window.__aldea.mundo = mundo;
  window.__aldea.info = () => mundo.info();
  window.__aldea.irA = irA;

  await irA(params.get('vista') ?? (conMundo ? 'partida' : 'escaparate'));
  if (!conMundo && params.get('ui') !== '0') {
    const aviso = document.createElement('div');
    aviso.className = 'pergamino aviso';
    aviso.textContent = 'El mundo no responde: se enseña solo la escena. Para jugar, arrancad ./arrancar.sh y recargad.';
    interfaz.append(aviso);
    window.setTimeout(() => aviso.remove(), 12000);
  }
  // Encuadre a medida: azimut, elevación, distancia y, si se quiere, la celda a la que mirar.
  // «mira=luna» (o sol): cámara tendida hacia el astro, para verlo sobre la aldea.
  const mira = params.get('mira');
  if (mira === 'luna' || mira === 'sol') {
    window.__aldea.listo = false;
    await mundo.asentar(2);
    const astros = mundo.astros();
    mundo.camara.fijar({ azimut: -(mira === 'luna' ? astros.lunaRumbo : astros.solRumbo), elevacion: 9, distancia: 105 }, true);
    await mundo.asentar(6);
    window.__aldea.listo = true;
  }
  const cam = params.get('cam')?.split(',').map(Number);
  if (cam && cam.length >= 3 && cam.every((n) => !Number.isNaN(n))) {
    const pose = { azimut: cam[0], elevacion: cam[1], distancia: cam[2] };
    const centro = cam.length >= 5 ? mundo.celdaAMundo(cam[3], cam[4]) : null;
    mundo.camara.fijar(centro ? { ...pose, ...centro } : pose, true);
    window.__aldea.listo = false;
    await mundo.asentar(6);
    window.__aldea.listo = true;
  }
}

arrancar().catch((e: unknown) => {
  console.error(e);
  const mensaje = e instanceof Error ? e.message : String(e);
  window.__aldea.error = mensaje;
  const aviso = document.createElement('div');
  aviso.className = 'pergamino aviso';
  aviso.textContent = `No se ha podido levantar el valle: ${mensaje}`;
  document.getElementById('interfaz')?.append(aviso);
});
