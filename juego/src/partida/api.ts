// Conexión con el mundo (servidor): REST por /api y WebSocket por /ws. Ver docs/API.md.

export type Recursos = Record<string, number>;

export interface Opcion {
  clave: string;
  texto: string;
  pista?: string;
  coste: Recursos;
  disponible: boolean;
}

export interface Sitio {
  cx: number;
  cz: number;
  actividad: string;
  actividad_texto: string;
  lugar: string;
  edificio_id: number | null;
}

export interface Aldeano {
  id: number;
  clave: string;
  nombre: string;
  apodo: string;
  oficio: string;
  oficio_nombre: string;
  genero: string;
  color: string;
  animo: number;
  animo_texto: string;
  opinion: number;
  opinion_texto: string;
  salud: number;
  hambre: number;
  dinero: number;
  casa_id: number | null;
  trabajo_id: number | null;
  sitio?: Sitio;
}

export interface Ficha extends Aldeano {
  edad: number | null;
  caracter: string;
  rasgos: string[];
  objetivo: string;
  secreto: string | null;
  debe: { a: string; cantidad: number } | null;
  dia_llegada: number | null;
  relaciones: { id: number; nombre: string; valor: number; texto: string; etiqueta: string | null; nota: string }[];
  recuerdos: { dia: number; hora: number; texto: string; importancia: number; tipo: string }[];
}

export interface EdificioEstado {
  id: number;
  clave: string;
  cx: number;
  cz: number;
  rot: number;
  dia: number;
}

export interface Peticion {
  id: number;
  dia: number;
  clave: string;
  titulo: string;
  texto: string;
  peticionario_id: number | null;
  opciones: Opcion[];
  estado: string;
  elegida: string | null;
  resultado: string;
}

export interface Carta {
  id: number;
  dia: number;
  tipo: string;
  remitente: string;
  texto: string;
  opciones: Opcion[];
  respuesta: string | null;
  resultado: string;
  estado: string;
}

export interface Visitante {
  id: number;
  tipo: string;
  nombre: string;
  descripcion: string;
  noticia: string;
  ofertas: { clave: string; texto: string; coste: Recursos; quedan: number }[];
  cx: number | null;
  cz: number | null;
  color: string;
}

export interface EscenaEstado {
  id: number;
  dia: number;
  hora: number;
  lugar: string;
  cx: number;
  cz: number;
  tema: string;
  participantes: number[];
  dialogo: { quien: number; texto: string }[];
}

export interface Estado {
  aldea: { id: number; nombre: string; paisaje: string; tono: string; dificultad: string; dia: number; perdida: boolean };
  tiempo: {
    dia: number; hora: number; instante: string; fecha: string; fecha_texto: string; estacion: string;
    estacion_texto: string; franja: string; desfase_dias: number; fiesta: string | null;
  };
  clima: { tipo: string; temperatura: number; origen: string; descripcion: string };
  recursos: Recursos;
  poblacion: {
    vecinos: number; plazas: number; sin_techo: number; animo: number; animo_texto: string; opinion: number;
    opinion_texto: string; dias_comida: number;
  };
  gobierno: {
    impuestos: number; impuestos_nombre: string; leyes: string[]; tension: number;
    revuelta: { activa: boolean; dias: number; avisos: number };
    defensa: number; defensa_partes: DefensaPartes;
    /** `clave` puede ser bandidos, lobos… o `hueste` (viene un señor vecino, con `fuerza` aproximada) o `asedio`. */
    amenaza: { clave: string; nombre: string; dias: number; fuerza?: number | null } | null; peste: boolean;
    alianzas: string[]; promesas: { texto: string; vence: number }[]; perdida: boolean; motivo_perdida: string | null;
  };
  edificios: EdificioEstado[];
  aldeanos: Aldeano[];
  balance: {
    producido: Recursos; gastado: Recursos; comido: Recursos; hambrientos: number; oro: Recursos;
    llegan: string[]; se_van: string[]; neto: Recursos; sin_techo: number; frio: boolean;
  } | null;
  consejo: Peticion[];
  mensajes: Carta[];
  visitantes: Visitante[];
  vecinos: { clave: string; nombre: string; senor: string; caracter: string; relacion: number; relacion_texto: string }[];
  escenas: EscenaEstado[];
  pergamino: { pendiente: boolean; dia: number | null };
  tutorial: Tutorial;
  guerra: GuerraEstado;
}

// ── Tutorial ──

/** La lección en curso del escriba. */
export interface Leccion {
  activo: true;
  oculto: boolean;
  terminado: false;
  paso: number;
  total: number;
  clave: string;
  capitulo: string;
  capitulo_n: number;
  capitulos: number;
  titulo: string;
  texto: string;
  como: string;
  /** Lección de leer: se cumple con «Entendido». Las demás las da por cumplidas el motor. */
  manual: boolean;
  /** Botón de la interfaz que conviene señalar: construir, consejo, vecinos, leyes, mapa, tropas, adelantar. */
  boton: string | null;
  premio: Recursos;
}

/** No hay lección: o no se ha empezado, o se saltó, o se acabó (`terminado`, con la despedida en `final`). */
export interface TutorialParado {
  activo: false;
  terminado: boolean;
  total: number;
  paso?: number;
  final?: string;
}

export type Tutorial = Leccion | TutorialParado;
export type OrdenTutorial = 'entendido' | 'ocultar' | 'mostrar' | 'saltar' | 'empezar';

// ── La comarca: mapa, hueste y guerra ──

export type DefensaPartes = Record<'torres' | 'muros' | 'leyes' | 'alianzas' | 'extra' | 'tropas', number>;
export type ClaveUnidad = 'milicia' | 'lanceros' | 'arqueros' | 'jinetes';
export type Tropas = Partial<Record<ClaveUnidad, number>>;
export type ObjetivoCampana = 'saquear' | 'someter' | 'conquistar';
export type AccionEmbajada = 'regalo' | 'alianza' | 'exigir' | 'liberar' | 'rescate';

/** Lo justo de la guerra para la barra de arriba (viene en el estado completo). */
export interface GuerraEstado {
  titulo: string;
  dominios: number;
  /** Hombres en casa. */
  tropas: number;
  fuerza: number;
  campana: { nombre: string; fase: 'ida' | 'vuelta'; dias: number } | null;
  asedio: boolean;
  /** Clave del señor vecino al que se paga vasallaje, si lo hay. */
  vasallo_de: string | null;
}

export interface Territorio {
  clave: string;
  nombre: string;
  senor: string;
  caracter: string;
  tipo: 'aldea' | 'torre' | 'abadia' | 'villa' | 'puerto' | 'castillo' | 'burgo';
  /** De 0 a 100: x hacia el este, y hacia el sur. */
  pos: [number, number];
  relacion: number;
  relacion_texto: string;
  estado: 'libre' | 'vasallo' | 'conquistado';
  aliado: boolean;
  hostil: boolean;
  fuerza: number;
  /** false: es lo que cuentan los pastores, de cinco en cinco. */
  fuerza_exacta: boolean;
  defensa: number;
  riqueza: number;
  /** Días de marcha desde la aldea. */
  dias: number;
  tributo: Recursos;
  tributo_posible: Recursos;
  /** Fuerza que vasallos y aliados mandarían a una campaña contra este territorio. */
  refuerzos: number;
  acciones: (AccionEmbajada | ObjetivoCampana)[];
}

export interface Unidad {
  clave: ClaveUnidad;
  nombre: string;
  plural: string;
  descripcion: string;
  coste: Recursos;
  sueldo: Recursos;
  fuerza: number;
  en_muro: number;
  requiere?: string[];
  disponible: boolean;
  /** Nombres de los edificios que faltan para poder alistarla. */
  falta: string[];
}

export interface CampanaComarca {
  vecino: string;
  nombre: string;
  objetivo: ObjetivoCampana;
  tropas: Tropas;
  fase: 'ida' | 'vuelta';
  dias: number;
  refuerzos: number | null;
  victoria: boolean | null;
  texto: string | null;
  botin: Recursos | null;
}

export interface ParteGuerra {
  dia: number;
  vecino: string;
  nombre: string;
  objetivo: ObjetivoCampana;
  victoria: boolean;
  texto: string;
  bajas: Tropas;
  botin: Recursos;
}

/** El mapa de la comarca (`GET /aldeas/{id}/mundo`). */
export interface Comarca {
  aldea: {
    nombre: string; pos: [number, number]; titulo: string; dominios: number; vasallo_de: string | null;
    defensa: number; defensa_partes: DefensaPartes;
  };
  territorios: Territorio[];
  /** Pares de claves; «aldea» es la del señor. */
  caminos: [string, string][];
  /** Las tropas que están en casa. */
  tropas: Tropas;
  fuerza: number;
  cupos: { sueldo: number; sueldo_usado: number; milicia: number; milicia_usada: number };
  unidades: Unidad[];
  objetivos: Record<ObjetivoCampana, { nombre: string; descripcion: string; umbral: number; muros: number }>;
  campana: CampanaComarca | null;
  amenaza: { vecino: string | null; nombre: string; fuerza: number; dias: number } | null;
  asedio: { vecino: string | null; fuerza: number; dias: number } | null;
  partes: ParteGuerra[];
  /** Días que faltan para que puedan venir huestes (0 si ya pueden). */
  paz_hasta: number;
  /** Con qué ánimo pelea la hueste (0,8–1,15): multiplica su fuerza en batalla. */
  moral: number;
  precios: { regalo: number; relacion_alianza: number; rescate: number };
}

/** Lo que devuelven las órdenes de la comarca: el mapa y el estado ya cambiados. */
export interface RespuestaComarca {
  mundo: Comarca;
  estado: Estado;
}

export interface Ley {
  clave: string;
  nombre: string;
  descripcion: string;
  requisito?: string;
}

export interface Config {
  motor_ia: string;
  paisajes: Record<string, { nombre: string; descripcion: string }>;
  dificultades: Record<string, { nombre: string; descripcion: string }>;
  tonos: Record<string, { nombre: string; descripcion: string }>;
  leyes: Ley[];
  impuestos: { nombres: string[] };
}

export interface ResumenAldea {
  id: number;
  nombre: string;
  paisaje: string;
  tono: string;
  dificultad: string;
  dia: number;
  perdida: boolean;
}

export interface Cronica {
  dia: number;
  fecha: string;
  texto: string;
  opiniones: string[];
}

export interface Evento {
  tipo: string;
  [campo: string]: unknown;
}

/** El motor dijo que no se puede (409) o algo falló; `message` es para enseñar al jugador. */
export class ErrorMundo extends Error {
  constructor(mensaje: string, readonly codigo: number) {
    super(mensaje);
  }
}

async function pedir<T>(ruta: string, cuerpo?: unknown, metodo?: string): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo ?? (cuerpo === undefined ? 'GET' : 'POST'),
      headers: cuerpo === undefined ? undefined : { 'content-type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorMundo('El mundo no responde. ¿Está arrancado? (./arrancar.sh)', 0);
  }
  if (!respuesta.ok) {
    let detalle = `Error ${respuesta.status}`;
    try {
      const dato = (await respuesta.json()) as { detail?: unknown };
      if (typeof dato.detail === 'string') detalle = dato.detail;
    } catch {
      /* sin cuerpo JSON: se queda el código */
    }
    throw new ErrorMundo(detalle, respuesta.status);
  }
  return (await respuesta.json()) as T;
}

export const api = {
  salud: () => pedir<{ ok: boolean; motor_ia: string }>('/salud'),
  config: () => pedir<Config>('/config'),
  aldeas: () => pedir<ResumenAldea[]>('/aldeas'),
  crearAldea: (datos: { nombre: string; paisaje: string; tono: string; dificultad: string }) => pedir<ResumenAldea>('/aldeas', datos),
  borrarAldea: (id: number) => pedir<{ ok: boolean }>(`/aldeas/${id}`, undefined, 'DELETE'),
  /** Con `hora`, los vecinos vienen colocados donde estarían a esa hora (previsualización). */
  estado: (id: number, hora?: number) => pedir<Estado>(`/aldeas/${id}${hora === undefined ? '' : `?hora=${hora}`}`),
  adelantar: (id: number) => pedir<{ resumen: { horas: number; dias: number }; estado: Estado }>(`/aldeas/${id}/adelantar`, {}),
  construir: (id: number, obra: { clave: string; rot: number; cx?: number; cz?: number; celdas?: [number, number][] }) =>
    pedir<{ construidos: EdificioEstado[]; fallos: { cx: number; cz: number; motivo: string }[]; recursos: Recursos }>(`/aldeas/${id}/construir`, obra),
  derribar: (id: number, edificio: number) => pedir<{ devuelto: Recursos; recursos: Recursos }>(`/aldeas/${id}/derribar`, { id: edificio }),
  girar: (id: number, edificio: number) => pedir<EdificioEstado>(`/aldeas/${id}/girar`, { id: edificio }),
  ficha: (id: number, aldeano: number) => pedir<Ficha>(`/aldeas/${id}/aldeanos/${aldeano}`),
  charla: (id: number, aldeano: number, texto: string) =>
    pedir<{ respuesta: string; revelado: boolean; ficha: Ficha }>(`/aldeas/${id}/aldeanos/${aldeano}/charla`, { texto }),
  decidir: (id: number, peticion: number, opcion: string) => pedir<{ peticion: Peticion; estado: Estado }>(`/aldeas/${id}/consejo/${peticion}`, { opcion }),
  impuestos: (id: number, nivel: number) => pedir<Estado>(`/aldeas/${id}/impuestos`, { nivel }),
  ley: (id: number, clave: string, activa: boolean) => pedir<Estado>(`/aldeas/${id}/leyes`, { clave, activa }),
  pergamino: (id: number) => pedir<{ cronica: Cronica | null; leido: number }>(`/aldeas/${id}/pergamino`),
  pergaminoLeido: (id: number) => pedir<{ ok: boolean }>(`/aldeas/${id}/pergamino/leido`, {}),
  cronicas: (id: number) => pedir<Cronica[]>(`/aldeas/${id}/cronicas`),
  sucesos: (id: number) => pedir<{ id: number; dia: number; hora: number; tipo: string; texto: string }[]>(`/aldeas/${id}/sucesos?limite=60`),
  contestar: (id: number, carta: number, opcion: string) => pedir<{ mensaje: Carta; estado: Estado }>(`/aldeas/${id}/mensajes/${carta}`, { opcion }),
  comerciar: (id: number, visitante: number, oferta: string) =>
    pedir<{ visitante: Visitante; estado: Estado }>(`/aldeas/${id}/visitantes/${visitante}/comerciar`, { oferta }),
  perdon: (id: number) => pedir<Estado>(`/aldeas/${id}/perdon`, {}),
  /** Empieza de cero en el mismo sitio: mismo id, nombre, paisaje, tono y dificultad. No se puede deshacer. */
  reiniciar: (id: number) => pedir<{ estado: Estado }>(`/aldeas/${id}/reiniciar`, {}),
  tutorial: (id: number, orden: OrdenTutorial) => pedir<{ estado: Estado }>(`/aldeas/${id}/tutorial`, { orden }),
  /** El mapa de la comarca. Con `mapa`, el mundo apunta que el señor lo ha abierto (lo pide el tutorial). */
  comarca: (id: number, mapa = false) => pedir<Comarca>(`/aldeas/${id}/mundo${mapa ? '?mapa=1' : ''}`),
  alistar: (id: number, unidad: ClaveUnidad, cantidad: number) => pedir<RespuestaComarca>(`/aldeas/${id}/tropas`, { unidad, cantidad }),
  licenciar: (id: number, unidad: ClaveUnidad, cantidad: number) => pedir<RespuestaComarca>(`/aldeas/${id}/tropas/licenciar`, { unidad, cantidad }),
  embajada: (id: number, vecino: string, accion: AccionEmbajada) =>
    pedir<RespuestaComarca & { texto: string }>(`/aldeas/${id}/mundo/${vecino}`, { accion }),
  campana: (id: number, vecino: string, objetivo: ObjetivoCampana, tropas: Tropas) =>
    pedir<RespuestaComarca>(`/aldeas/${id}/campana`, { vecino, objetivo, tropas }),
};

/** Escucha lo que pasa en directo. Se reconecta sola. Devuelve la función para dejar de escuchar. */
export function escuchar(aldeaId: number, alLlegar: (eventos: Evento[]) => void): () => void {
  let ws: WebSocket | null = null;
  let cerrado = false;
  let reintento = 0;
  let latido = 0;
  const abrir = () => {
    if (cerrado) return;
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocolo}://${location.host}/ws/${aldeaId}`);
    ws.onmessage = (m) => {
      try {
        const dato = JSON.parse(String(m.data)) as { eventos?: Evento[] };
        if (dato.eventos?.length) alLlegar(dato.eventos);
      } catch {
        /* mensaje raro: se ignora */
      }
    };
    ws.onopen = () => {
      latido = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('.'), 25_000);
    };
    ws.onclose = () => {
      window.clearInterval(latido);
      if (!cerrado) reintento = window.setTimeout(abrir, 4000);
    };
  };
  abrir();
  return () => {
    cerrado = true;
    window.clearTimeout(reintento);
    window.clearInterval(latido);
    ws?.close();
  };
}
