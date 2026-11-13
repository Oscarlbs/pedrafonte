// Interfaz de la Fase 1: cartela con el nombre de la aldea, botones de vista y controles de
// previsualización (hora, clima y estación). Solo usa la fachada `Mundo`.
import { UBICACION } from '../datos';
import { textoFecha, textoHora } from '../escena/astros';
import { CLIMAS, NOMBRE_CLIMA, type TipoClima } from '../escena/clima';
import { ESTACIONES, type Estacion, NOMBRE_ESTACION } from '../escena/paleta';
import type { Mundo } from '../mundo';

export interface Panel {
  /** Marca como elegida la vista dada. */
  marcarVista(clave: string): void;
  /** Refleja en los controles lo fijado por otros medios (parámetros de la URL). */
  sincronizar(estado: { hora: number | null; clima: TipoClima | null; estacion: Estacion | null }): void;
}

function crear<K extends keyof HTMLElementTagNameMap>(tipo: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tipo);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

export function crearPanel(raiz: HTMLElement, mundo: Mundo, vistas: { clave: string; nombre: string }[], alElegirVista: (clave: string) => void): Panel {
  // Cartela: nombre, fecha, estación y clima.
  const cartela = crear('div', 'pergamino cartela');
  cartela.append(crear('h1', 'pergamino-titulo', 'Pedrafonte'));
  const sub = crear('p', 'subtitulo');
  cartela.append(sub);
  raiz.append(cartela);

  // Barra de la escena.
  const barra = crear('div', 'pergamino barra-escena');
  barra.setAttribute('role', 'toolbar');
  barra.setAttribute('aria-label', 'Vista y previsualización');

  const grupoVistas = crear('div', 'fila');
  const botones = new Map<string, HTMLButtonElement>();
  for (const v of vistas) {
    const b = crear('button', 'boton', v.nombre);
    b.type = 'button';
    b.addEventListener('click', () => alElegirVista(v.clave));
    botones.set(v.clave, b);
    grupoVistas.append(b);
  }
  barra.append(grupoVistas, crear('div', 'separador'));

  // Hora.
  const grupoHora = crear('div', 'fila');
  const etiHora = crear('label', 'etiqueta', 'Hora');
  const deslizador = crear('input', 'deslizador');
  deslizador.type = 'range';
  deslizador.min = '0';
  deslizador.max = '24';
  deslizador.step = '0.05';
  deslizador.id = 'control-hora';
  etiHora.htmlFor = deslizador.id;
  const reloj = crear('span', 'reloj', '--:--');
  const ahora = crear('button', 'boton', 'Ahora');
  ahora.type = 'button';
  ahora.title = 'Volver a la hora real';
  let horaFijada: number | null = null;
  deslizador.addEventListener('input', () => {
    horaFijada = Number(deslizador.value);
    mundo.fijarHora(horaFijada);
    reloj.textContent = textoHora(horaFijada);
    ahora.classList.remove('activo');
  });
  ahora.addEventListener('click', () => {
    horaFijada = null;
    mundo.fijarHora(null);
    ahora.classList.add('activo');
  });
  ahora.classList.add('activo');
  grupoHora.append(etiHora, deslizador, reloj, ahora);
  barra.append(grupoHora, crear('div', 'separador'));

  // Clima.
  const grupoClima = crear('div', 'fila');
  const etiClima = crear('label', 'etiqueta', 'Clima');
  const selClima = crear('select', 'campo');
  selClima.id = 'control-clima';
  etiClima.htmlFor = selClima.id;
  selClima.append(new Option('Real', 'real'));
  for (const c of CLIMAS) selClima.append(new Option(NOMBRE_CLIMA[c], c));
  selClima.addEventListener('change', () => mundo.fijarClima(selClima.value === 'real' ? null : (selClima.value as TipoClima)));
  grupoClima.append(etiClima, selClima);
  barra.append(grupoClima, crear('div', 'separador'));

  // Estación.
  const grupoEstacion = crear('div', 'fila');
  const etiEstacion = crear('label', 'etiqueta', 'Estación');
  const selEstacion = crear('select', 'campo');
  selEstacion.id = 'control-estacion';
  etiEstacion.htmlFor = selEstacion.id;
  selEstacion.append(new Option('Real', 'real'));
  for (const e of ESTACIONES) selEstacion.append(new Option(NOMBRE_ESTACION[e], e));
  selEstacion.addEventListener('change', () => mundo.fijarEstacion(selEstacion.value === 'real' ? null : (selEstacion.value as Estacion)));
  grupoEstacion.append(etiEstacion, selEstacion);
  barra.append(grupoEstacion);
  raiz.append(barra);

  // Medidas de rendimiento y ayuda de manejo.
  const medidas = crear('div', 'pergamino medidas');
  raiz.append(medidas);
  const ayuda = crear('div', 'pergamino ayuda nota');
  ayuda.textContent = 'Arrastrad para recorrer el valle; botón derecho o Mayús para girar; rueda o dos dedos para acercaros.';
  raiz.append(ayuda);

  const pintarSub = () => {
    const c = mundo.clima();
    const origen = c.origen === 'real' ? `en ${UBICACION.nombre.split(',')[0]}` : c.origen === 'simulado' ? 'figurado' : 'a voluntad';
    const grados = c.origen === 'real' && c.temperatura !== null ? `, ${Math.round(c.temperatura)} °C` : '';
    sub.textContent = `${textoFecha(mundo.fecha(), UBICACION.huso)} · ${NOMBRE_ESTACION[mundo.estacion()]} · ${NOMBRE_CLIMA[c.tipo]} (${origen}${grados})`;
  };
  const pintarReloj = () => {
    const h = mundo.hora();
    if (horaFijada === null) {
      reloj.textContent = textoHora(h);
      if (document.activeElement !== deslizador) deslizador.value = String(h);
    }
  };
  mundo.alCambiar('hora', () => {
    pintarReloj();
    pintarSub();
  });
  mundo.alCambiar('clima', pintarSub);
  mundo.alCambiar('estacion', pintarSub);
  window.setInterval(() => {
    const i = mundo.info();
    medidas.textContent = `${i.fps} fps · ${i.llamadas} llamadas · ${Math.round(i.triangulos / 1000)} mil triángulos`;
    pintarSub();
  }, 500);
  pintarReloj();
  pintarSub();

  return {
    marcarVista(clave) {
      for (const [k, b] of botones) {
        b.classList.toggle('activo', k === clave);
        b.setAttribute('aria-pressed', String(k === clave));
      }
    },
    sincronizar(estado) {
      horaFijada = estado.hora;
      if (estado.hora !== null) {
        deslizador.value = String(estado.hora);
        reloj.textContent = textoHora(estado.hora);
      }
      ahora.classList.toggle('activo', estado.hora === null);
      selClima.value = estado.clima ?? 'real';
      selEstacion.value = estado.estacion ?? 'real';
    },
  };
}
