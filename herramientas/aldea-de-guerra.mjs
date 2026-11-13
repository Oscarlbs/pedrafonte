// Funda y prepara por la API una aldea «de usar y tirar» con algo de guerra, para las capturas de la fase 7:
// casas, cuartel, empalizada, tropa, un presente, un vasallo y un parte de guerra. No toca ninguna otra aldea.
//
//   node herramientas/aldea-de-guerra.mjs               → la funda, la prepara y escribe su id
//   node herramientas/aldea-de-guerra.mjs --campana 12  → saca la hueste de la aldea 12 (para ver la ficha en el mapa)
//   node herramientas/aldea-de-guerra.mjs --borrar 12   → la borra
//   (--url http://127.0.0.1:5173 para apuntar a otro sitio; hace falta el mundo arrancado: ./arrancar.sh)
//
// `capturas.mjs` lo usa solo: si una toma lleva `{guerra}` o `{nueva}` en su consulta, funda las aldeas que
// hagan falta, pone su id en el hueco y las borra al acabar. Una toma con `"antes": "campana"` saca antes la hueste.
import { pathToFileURL } from 'node:url';

const NOMBRE_GUERRA = 'Castro da Proba';
const NOMBRE_NUEVA = 'Aldea da Proba';

/** Cliente mínimo de la API del mundo (a través del puente de Vite o directo). */
export function cliente(base = 'http://127.0.0.1:5173') {
  const raiz = base.replace(/\/$/, '');
  const pedir = async (ruta, cuerpo, metodo) => {
    const r = await fetch(`${raiz}/api${ruta}`, {
      method: metodo ?? (cuerpo ? 'POST' : 'GET'), headers: cuerpo ? { 'content-type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (!r.ok) {
      const error = new Error(`${ruta}: ${r.status} ${await r.text()}`);
      error.codigo = r.status;
      throw error;
    }
    return r.json();
  };
  /** Lo mismo, pero un «no se puede» (409) devuelve null en vez de saltar. */
  const probar = async (ruta, cuerpo) => {
    try {
      return await pedir(ruta, cuerpo);
    } catch (e) {
      if (e.codigo === 409) return null;
      throw e;
    }
  };
  return { pedir, probar };
}

/** Funda una aldea recién nacida (día 1, con el tutorial en su primera lección). */
export async function fundarNueva(api, nombre = NOMBRE_NUEVA) {
  return (await api.pedir('/aldeas', { nombre, paisaje: 'valle', tono: 'cuento', dificultad: 'facil' })).id;
}

export async function borrar(api, id) {
  await api.pedir(`/aldeas/${id}`, undefined, 'DELETE');
}

/** Busca sitio libre cerca de (cx, cz) y construye. Devuelve true si lo consigue. */
async function levantar(api, id, clave, cx, cz, radio = 9) {
  const sitios = [];
  for (let dx = -radio; dx <= radio; dx++) for (let dz = -radio; dz <= radio; dz++) sitios.push([cx + dx, cz + dz]);
  sitios.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
  for (const [x, z] of sitios) {
    const visto = await api.pedir(`/aldeas/${id}/comprobar`, { clave, cx: x, cz: z, rot: 0 });
    if (!visto.valido) {
      // Si el motivo no es el sitio (falta madera, falta gente…), no vale la pena seguir buscando.
      if (!/siti|ocupad|río|rio|agua|camino|mapa|fuera|pisa|orilla|cabe/i.test(visto.motivo)) return false;
      continue;
    }
    const r = await api.probar(`/aldeas/${id}/construir`, { clave, cx: x, cz: z, rot: 0 });
    return Boolean(r?.construidos?.length);
  }
  return false;
}

/** Funda y prepara la aldea de guerra. Devuelve su id. `decir` recibe lo que va pasando. */
export async function prepararGuerra(api, decir = () => {}) {
  const id = (await api.pedir('/aldeas', { nombre: NOMBRE_GUERRA, paisaje: 'valle', tono: 'cuento', dificultad: 'facil' })).id;
  try {
    const estado = () => api.pedir(`/aldeas/${id}`);
    const mundo = () => api.pedir(`/aldeas/${id}/mundo`);
    /** Pasa una noche: se lee el pergamino y se despacha el consejo (a la primera opción que se pueda pagar). */
    const noche = async () => {
      const e = (await api.pedir(`/aldeas/${id}/adelantar`, {})).estado;
      await api.probar(`/aldeas/${id}/pergamino/leido`, {});
      for (const p of e.consejo) {
        const opcion = p.opciones.find((o) => o.disponible);
        if (opcion) await api.probar(`/aldeas/${id}/consejo/${p.id}`, { opcion: opcion.clave });
      }
      return estado();
    };
    await api.pedir(`/aldeas/${id}/tutorial`, { orden: 'saltar' });
    await api.probar(`/aldeas/${id}/pergamino/leido`, {});
    await api.pedir(`/aldeas/${id}/impuestos`, { nivel: 2 });
    let e = await estado();
    const hoguera = e.edificios.find((x) => x.clave === 'hoguera') ?? { cx: 22, cz: 27 };
    const cerca = async (clave, dx = 0, dz = 0) => {
      const hecho = await levantar(api, id, clave, hoguera.cx + dx, hoguera.cz + dz);
      if (!hecho) decir(`  (no pude levantar ${clave})`);
      return hecho;
    };

    // Techo, pan y madera: lo justo para que lleguen vecinos y haya con qué pagar a la tropa.
    for (const [clave, dx, dz] of [['casa', 5, -4], ['campo', -7, 5], ['campo', -8, -4], ['cabana_lenador', 7, 4], ['casa', 9, -5], ['campo', -12, 1], ['cantera', 4, 9]]) await cerca(clave, dx, dz);
    for (let dia = 0; dia < 16; dia++) {
      e = await noche();
      // Para el cuartel (10 de oro) y seis lanceros (36 de oro y 12 de madera).
      if (e.poblacion.vecinos >= 6 && e.recursos.madera >= 44 && e.recursos.piedra >= 12 && e.recursos.oro >= 46) break;
    }
    decir(`  día ${e.tiempo.dia}: ${e.poblacion.vecinos} vecinos, ${Math.floor(e.recursos.oro)} de oro, ${Math.floor(e.recursos.madera)} de madera, ${Math.floor(e.recursos.grano)} de grano`);
    await cerca('cuartel', -2, -8);

    // Tropa, la justa y a última hora (cobra cada noche): seis lanceros y algo de milicia. Y a someter al vecino más flojo.
    let c = await mundo();
    const lanceros = Math.min(6, Math.floor(e.recursos.oro / 6), c.cupos.sueldo - c.cupos.sueldo_usado);
    if (lanceros > 0) await api.probar(`/aldeas/${id}/tropas`, { unidad: 'lanceros', cantidad: lanceros });
    const milicia = Math.min(3, c.cupos.milicia);
    if (milicia > 0) await api.probar(`/aldeas/${id}/tropas`, { unidad: 'milicia', cantidad: milicia });
    c = await mundo();
    decir(`  tropa en casa: ${JSON.stringify(c.tropas)}`);
    const flojo = [...c.territorios].sort((a, b) => a.fuerza + a.defensa - (b.fuerza + b.defensa))[0];
    const envio = Object.fromEntries(Object.entries(c.tropas).filter(([, cuantos]) => cuantos > 0));
    if (await api.probar(`/aldeas/${id}/campana`, { vecino: flojo.clave, objetivo: 'someter', tropas: envio })) {
      for (let dia = 0; dia < flojo.dias * 2 + 1 && (await mundo()).campana; dia++) await noche();
    }
    // Con lo que haya dado la guerra: una empalizada corta (con muro, la tropa vale más en casa) y un presente a quien mejor os mira.
    const fila = [];
    for (let i = 0; i < 8; i++) fila.push([hoguera.cx - 4 + i, hoguera.cz + 6]);
    await api.probar(`/aldeas/${id}/construir`, { clave: 'empalizada', celdas: fila, rot: 0 });
    c = await mundo();
    const amigo = [...c.territorios].filter((t) => t.estado === 'libre').sort((a, b) => b.relacion - a.relacion)[0];
    if (amigo) await api.probar(`/aldeas/${id}/mundo/${amigo.clave}`, { accion: 'regalo' });
    c = await mundo();
    decir(`  ${flojo.nombre}: ${c.territorios.find((t) => t.clave === flojo.clave)?.estado}; título: ${c.aldea.titulo}; en casa: ${JSON.stringify(c.tropas)}`);
    return id;
  } catch (e) {
    await borrar(api, id).catch(() => {});
    throw e;
  }
}

/** Saca la hueste (la mitad de lo que haya en casa) contra un vecino a dos días y deja pasar una noche: queda a medio camino. */
export async function campana(api, id) {
  const c = await api.pedir(`/aldeas/${id}/mundo`);
  if (c.campana) return;
  const lejos = c.territorios.filter((t) => t.estado === 'libre' && t.dias >= 2).sort((a, b) => a.fuerza - b.fuerza)[0]
    ?? c.territorios.find((t) => t.estado === 'libre');
  const envio = Object.fromEntries(Object.entries(c.tropas).map(([clave, cuantos]) => [clave, Math.ceil(cuantos / 2)]).filter(([, cuantos]) => cuantos > 0));
  if (!lejos || !Object.keys(envio).length) return;
  await api.pedir(`/aldeas/${id}/campana`, { vecino: lejos.clave, objetivo: 'saquear', tropas: envio });
  if (lejos.dias >= 2) {
    await api.pedir(`/aldeas/${id}/adelantar`, {});
    await api.probar(`/aldeas/${id}/pergamino/leido`, {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const valor = (nombre) => (args.includes(nombre) ? args[args.indexOf(nombre) + 1] : null);
  const api = cliente(valor('--url') ?? undefined);
  if (valor('--borrar')) {
    await borrar(api, Number(valor('--borrar')));
    console.error(`Aldea ${valor('--borrar')} borrada.`);
  } else if (valor('--campana')) {
    await campana(api, Number(valor('--campana')));
    console.error(`La hueste de la aldea ${valor('--campana')} está en camino.`);
  } else {
    console.error(`Preparando «${NOMBRE_GUERRA}»…`);
    console.log(await prepararGuerra(api, (texto) => console.error(texto)));
  }
}
