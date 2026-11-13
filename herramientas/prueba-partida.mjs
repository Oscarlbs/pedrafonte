// Prueba de humo del juego en el navegador (Chrome del Mac, sin cabeza), contra el mundo de verdad.
//
//   node herramientas/prueba-partida.mjs [url del juego] [carpeta para fotos]
//
// Funda una aldea «de usar y tirar», y en ella: sigue la primera lección del tutorial, construye una casa
// (con vista previa), tiende un camino, derriba, abre un edificio pinchando en el valle, abre la ficha de una
// vecina y habla con ella, decide una petición del consejo, cambia tributos, adelanta un día y lee el
// pergamino; abre el mapa de la comarca, manda un presente, alista milicia, saca la hueste y, para acabar,
// empieza la aldea de cero. Al acabar borra la aldea.
// Sale con error si algo no funciona o si el navegador escribe errores en la consola.
// Necesita el mundo (8765) y el juego (5173 por defecto) arrancados:  ./arrancar.sh
import puppeteer from 'puppeteer-core';

const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const fotos = process.argv[3] ?? null;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (ruta, cuerpo, metodo) => {
  const r = await fetch(`${base}/api${ruta}`, {
    method: metodo ?? (cuerpo ? 'POST' : 'GET'), headers: cuerpo ? { 'content-type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${await r.text()}`);
  return r.json();
};
const comprobar = (condicion, mensaje) => {
  if (!condicion) throw new Error(`FALLA: ${mensaje}`);
  console.log(`  ✓ ${mensaje}`);
};

const aldea = await api('/aldeas', { nombre: 'Prueba de humo', paisaje: 'valle', tono: 'cuento', dificultad: 'facil' });
const navegador = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
let fallo = null;
try {
  const pagina = await navegador.newPage();
  const errores = [];
  pagina.on('console', (m) => { if (m.type() === 'error' && !/409|Failed to load resource|open-meteo/i.test(m.text())) errores.push(m.text().slice(0, 300)); });
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 400)));
  pagina.on('dialog', (d) => void d.accept());
  const foto = async (nombre) => { if (fotos) await pagina.screenshot({ path: `${fotos}/${nombre}.png`, type: 'png' }); };
  const estado = () => api(`/aldeas/${aldea.id}`);
  const pulsar = async (selector, texto) => {
    const ok = await pagina.evaluate((s, t) => {
      const el = [...document.querySelectorAll(s)].find((x) => !t || x.textContent.includes(t));
      if (!el) return false;
      el.click();
      return true;
    }, selector, texto ?? null);
    if (!ok) throw new Error(`No encuentro ${selector} «${texto ?? ''}»`);
    await espera(400);
  };
  const clic = async (x, y) => { await pagina.mouse.move(x, y); await espera(350); await pagina.mouse.down(); await pagina.mouse.up(); await espera(350); };
  const titulo = () => pagina.evaluate(() => document.querySelector('.panel:not(.oculto) .titulo')?.textContent ?? '');
  const texto = (selector) => pagina.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector);
  const comarca = () => api(`/aldeas/${aldea.id}/mundo`);
  // Los lugares del mapa son grupos de un SVG: se pinchan mandándoles el clic.
  const pincharLugar = async (clave) => {
    const ok = await pagina.evaluate((c) => {
      const lugar = document.querySelector(`.mapa-dibujo .lugar[data-clave="${c}"]`);
      lugar?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return Boolean(lugar);
    }, clave);
    if (!ok) throw new Error(`No encuentro ${clave} en el mapa`);
    await espera(400);
  };

  await pagina.goto(`${base}/?vista=partida&aldea=${aldea.id}&hora=11`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.hud-barra .hud-dato', { timeout: 60000 });
  await espera(5000);
  comprobar(await pagina.$('.velo:not(.oculto) .rollo'), 'al abrir aparece el pergamino del escriba');
  await pulsar('.rollo .boton-lacre');
  await foto('humo-1-aldea');

  console.log('Tutorial:');
  comprobar((await texto('.tutorial-tarjeta:not(.oculto)')).includes('Lección 1 de 19'), 'sale la tarjeta del escriba con la lección 1 de 19');
  await pulsar('.tutorial-tarjeta [data-tutorial="entendido"]');
  await espera(1200);
  comprobar((await texto('.tutorial-tarjeta:not(.oculto)')).includes('Lección 2 de 19'), '«Entendido» pasa a la lección 2');
  comprobar((await texto('.avisos')).includes('Lección aprendida'), 'se avisa de la lección aprendida');
  comprobar(await pagina.$('[data-boton="construir"].latido'), 'el botón «Construir» late mientras dura la lección');
  await pulsar('.tutorial-tarjeta [data-tutorial="ocultar"]');
  await espera(800);
  comprobar((await estado()).tutorial.oculto === true && await pagina.$('.tutorial-tarjeta.plegada'), '«Ocultar» la deja en una pastilla (y el mundo lo recuerda)');
  await pulsar('.tutorial-pastilla');
  await espera(800);
  comprobar((await estado()).tutorial.oculto === false && !(await pagina.$('.tutorial-tarjeta.plegada')), 'la pastilla la vuelve a abrir');
  await foto('humo-1b-tutorial');

  console.log('Construir:');
  await pulsar('[data-boton="construir"]');
  await pulsar('.ficha-edificio', 'Casa de entramado');
  await clic(980, 330);
  await espera(1800);
  let e = await estado();
  comprobar(e.edificios.some((x) => x.clave === 'casa'), 'la casa queda construida y guardada en el mundo');
  comprobar(e.recursos.madera < 68, 'se han cobrado los materiales');
  await foto('humo-2-casa');
  await pulsar('.pestana', 'Caminos');
  await pulsar('.ficha-edificio', 'Camino');
  await clic(900, 430);
  await clic(900, 520);
  await espera(1800);
  e = await estado();
  const caminos = e.edificios.filter((x) => x.clave === 'camino').length;
  comprobar(caminos >= 2, `camino tendido con dos clics (${caminos} tramos)`);
  await pulsar('.cabecera-construir .boton', 'Derribar');
  await clic(900, 430);
  await espera(1800);
  comprobar((await estado()).edificios.filter((x) => x.clave === 'camino').length === caminos - 1, 'derribar quita un tramo');
  await pulsar('.cabecera-construir .boton', 'Cerrar');

  console.log('Pinchar en el valle:');
  await clic(980, 330);
  await espera(900);
  comprobar((await titulo()).includes('Casa'), 'pinchar en la casa abre su tarjeta');
  await foto('humo-3-edificio');

  console.log('Vecinos:');
  await pulsar('[data-boton="vecinos"]');
  await pulsar('.boton.vecino', 'Aldonza');
  await espera(900);
  comprobar((await titulo()).includes('Aldonza'), 'se abre la ficha de doña Aldonza');
  await pagina.type('.charla-entrada input', 'Buenos días, doña Aldonza');
  await pagina.keyboard.press('Enter');
  await espera(2200);
  const respuesta = await pagina.evaluate(() => document.querySelector('.dice-vecino')?.textContent ?? '');
  comprobar(respuesta.length > 5, `contesta en su papel: «${respuesta.slice(0, 70)}»`);
  await foto('humo-4-charla');

  console.log('Gobierno:');
  await pulsar('[data-boton="consejo"]');
  const peticiones = (await estado()).consejo.length;
  comprobar(peticiones >= 1, `hay ${peticiones} peticiones en el consejo`);
  await pulsar('.panel .boton.opcion:not([disabled])');
  await espera(1500);
  comprobar((await estado()).consejo.length === peticiones - 1, 'decidir resuelve la petición');
  await pulsar('[data-boton="leyes"]');
  await pulsar('.tributos .boton', 'Justo');
  await espera(1200);
  comprobar((await estado()).gobierno.impuestos === 2, 'los tributos cambian');
  await pulsar('[data-boton="adelantar"]');
  await pagina.waitForSelector('.velo:not(.oculto) .rollo', { timeout: 60000 });
  e = await estado();
  comprobar(e.tiempo.desfase_dias === 1, 'adelantar un día suma un día');
  const cronica = await pagina.evaluate(() => document.querySelector('.rollo')?.textContent ?? '');
  comprobar(cronica.includes('Prueba de humo') && cronica.includes('opina'), 'tras adelantar sale el pergamino con la crónica y las opiniones');
  await foto('humo-5-pergamino');
  await pulsar('.rollo .boton-lacre');

  console.log('Mapa de la comarca:');
  await pulsar('[data-boton="mapa"]');
  await pagina.waitForSelector('.mapa-dibujo .lugar[data-clave="aldea"]', { timeout: 20000 });
  const lugares = await pagina.$$eval('.mapa-dibujo .lugar[data-clave]:not([data-clave="aldea"])', (l) => l.length);
  comprobar(lugares === 8, `el mapa abre con ocho territorios (${lugares}) y la aldea`);
  const antes = (await comarca()).territorios.find((t) => t.clave === 'vilanova');
  await pincharLugar('vilanova');
  comprobar((await texto('.mapa-ficha')).includes(antes.nombre), `pinchar en ${antes.nombre} abre su ficha`);
  await foto('humo-6-mapa');
  await pulsar('.mapa-acciones [data-accion="regalo"]:not([disabled])');
  await espera(1500);
  const despues = (await comarca()).territorios.find((t) => t.clave === 'vilanova');
  comprobar(despues.relacion > antes.relacion, `un presente sube la relación (${antes.relacion} → ${despues.relacion})`);
  comprobar((await texto('.mapa-resultado')).includes('presente') && (await texto('.mapa-ficha [data-dato="relacion"]')).includes(String(despues.relacion)),
    'el resultado de la embajada se enseña en el propio mapa');
  await pagina.keyboard.press('Escape');
  await pagina.keyboard.press('Escape');
  await espera(400);
  comprobar(!(await pagina.$('.velo-mapa:not(.oculto)')), 'Escape cierra la ficha y luego el mapa');

  console.log('Hueste:');
  await pulsar('[data-boton="hueste"]');
  await pagina.waitForSelector('.panel [data-alistar="milicia:1"]:not([disabled])', { timeout: 20000 });
  await pulsar('.panel [data-alistar="milicia:1"]');
  await espera(1500);
  comprobar((await comarca()).tropas.milicia === 1, 'se alista un miliciano');
  comprobar((await texto('.panel [data-unidad="milicia"] .unidad-cuantos')).startsWith('1 '), 'el panel «Hueste» lo cuenta en casa');
  comprobar((await texto('.hud-dato.tropa')) === '1', 'y la barra de arriba, también');
  await foto('humo-7-hueste');

  console.log('Campaña:');
  await pulsar('[data-boton="mapa"]');
  await pagina.waitForSelector('.mapa-dibujo .lugar[data-clave="vilanova"]', { timeout: 20000 });
  await pincharLugar('vilanova');
  await pulsar('.mapa-guerras [data-accion="saquear"]');
  comprobar((await texto('.mapa-compositor')).includes('no defiende la aldea'), 'el compositor avisa de que lo enviado no defiende la aldea');
  comprobar((await texto('.mapa-compositor [data-envio="milicia"] .mapa-cuantos')) === '1', 'y propone mandar la tropa que hay en casa');
  await pulsar('.mapa-compositor [data-accion="salir"]:not([disabled])');
  await espera(1500);
  const campana = (await comarca()).campana;
  comprobar(campana?.vecino === 'vilanova' && campana.objetivo === 'saquear', 'sale una campaña contra Vilanova');
  comprobar(await pagina.$('.mapa-dibujo .hueste.propia'), 'la hueste aparece en el mapa, sobre el camino');
  comprobar((await texto('.hud-barra')).includes('La hueste, camino de'), 'y la barra de arriba avisa de que está en camino');
  await foto('humo-8-campana');
  await pulsar('.mapa-cabecera .cerrar');

  console.log('Empezar de cero:');
  await pulsar('[data-boton="aldeas"]');
  await pagina.waitForSelector('.panel [data-aldea="reiniciar"]', { timeout: 20000 });
  await pulsar('.panel [data-aldea="reiniciar"]');
  await pulsar('.panel [data-aldea="reiniciar-seguir"]');
  await foto('humo-9-reiniciar');
  await pulsar('.panel [data-aldea="reiniciar-ya"]');
  await pagina.waitForSelector('.velo:not(.oculto) .rollo', { timeout: 60000 });
  e = await estado();
  comprobar(e.aldea.id === aldea.id && e.tiempo.dia === 1 && e.tiempo.desfase_dias === 0, '«Empezar de cero» devuelve la aldea al día 1');
  comprobar(e.edificios.length === 2 && e.guerra.tropas === 0 && e.tutorial.paso === 1, 'sin edificios nuevos, sin tropa y con el tutorial en la primera lección');
  comprobar((await texto('.hud-fecha')).startsWith('Día 1 '), 'y la interfaz vuelve a enseñar el día 1');
  await pulsar('.rollo .boton-lacre');
  comprobar(errores.length === 0, `sin errores en la consola del navegador${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  console.log('\nPrueba de humo superada.');
} catch (error) {
  fallo = error;
} finally {
  await navegador.close();
  await api(`/aldeas/${aldea.id}`, undefined, 'DELETE').catch(() => console.warn(`(no pude borrar la aldea de prueba ${aldea.id})`));
}
if (fallo) {
  console.error(String(fallo.message ?? fallo));
  process.exit(1);
}
