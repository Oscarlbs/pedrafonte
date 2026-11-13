// Capturas automáticas del juego con el Chrome del Mac (sin descargar ningún navegador).
//
//   node herramientas/capturas.mjs                      → docs/capturas/fase1-*.png
//   node herramientas/capturas.mjs --prefijo fase2      → docs/capturas/fase2-*.png
//   node herramientas/capturas.mjs --solo escaparate-noche,inicio-dia
//   node herramientas/capturas.mjs --toma "plaza=vista=escaparate&hora=atardecer&cam=-20,30,40,23,26"
//   node herramientas/capturas.mjs --tomas herramientas/mis-tomas.json   (lista [{ nombre, consulta, espera?, ui?, fase? }])
//   node herramientas/capturas.mjs --sin-base --tomas herramientas/tomas-partida.json   → fase2…fase7 (necesita el mundo arrancado)
//
// Una toma puede pedir una aldea «de usar y tirar» poniendo un hueco en su consulta: `aldea={nueva}` (recién
// fundada, con el tutorial en la primera lección) o `aldea={guerra}` (con cuartel, tropa y un vasallo; ver
// herramientas/aldea-de-guerra.mjs). Se fundan antes de empezar y se borran al acabar. Con `"antes"` la toma
// hace algo antes de la foto: `"entendido"` (pasa la primera lección en la nueva) o `"campana"` (saca la hueste).
//
// Otras opciones: --url http://127.0.0.1:5173  --ancho 1920  --alto 1080  --pixeles 1.5  --con-ui  --sin-base
//                  --consola (vuelca lo que el juego escribe en la consola)
//
// Si el juego no está ya servido en --url, arranca `vite` en juego/ y lo apaga al terminar. Cada toma
// abre el juego con parámetros en la URL (ver juego/src/main.ts) y espera a `window.__aldea.listo`.
// «hora» admite un número (0–24) o un momento del día real: amanecer, dia, mediodia, atardecer, noche, luna.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Tomas de la escena: valen para todas las fases (cambia solo el prefijo). */
const TOMAS_BASE = [
  { nombre: 'inicio-dia', consulta: 'vista=inicio&hora=dia&clima=despejado', espera: 7500 },
  { nombre: 'inicio-noche', consulta: 'vista=inicio&hora=noche&clima=despejado' },
  { nombre: 'escaparate-mediodia', consulta: 'vista=escaparate&hora=mediodia&clima=despejado' },
  { nombre: 'escaparate-atardecer', consulta: 'vista=escaparate&hora=atardecer&clima=despejado' },
  { nombre: 'escaparate-noche', consulta: 'vista=escaparate&hora=noche&clima=despejado' },
  { nombre: 'escaparate-luna', consulta: 'vista=escaparate&hora=luna&clima=despejado&mira=luna' },
  { nombre: 'escaparate-amanecer-niebla', consulta: 'vista=escaparate&hora=amanecer&clima=niebla' },
  { nombre: 'escaparate-lluvia', consulta: 'vista=escaparate&hora=15&clima=lluvia' },
  { nombre: 'escaparate-nieve', consulta: 'vista=escaparate&hora=11&clima=nieve&estacion=invierno' },
  { nombre: 'escaparate-plaza', consulta: 'vista=escaparate&hora=atardecer&clima=despejado&cam=-32,27,44,24,25', espera: 7500 },
  { nombre: 'escaparate-molino', consulta: 'vista=escaparate&hora=dia&clima=despejado&cam=38,26,40,31,27' },
  { nombre: 'escaparate-verano', consulta: 'vista=escaparate&hora=dia&clima=despejado&estacion=verano&cam=-150,36,105,27,27' },
  { nombre: 'escaparate-maqueta', consulta: 'vista=escaparate&hora=dia&clima=despejado&cam=30,22,175,27,27' },
  { nombre: 'escaparate-interfaz', consulta: 'vista=escaparate&hora=dia&clima=despejado', ui: true, espera: 7500 },
];

function opciones() {
  const o = { prefijo: 'fase1', url: 'http://127.0.0.1:5173', ancho: 1920, alto: 1080, pixeles: 1.5, solo: null, tomas: [], conUi: false, sinBase: false, consola: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const v = () => a[++i];
    if (a[i] === '--prefijo') o.prefijo = v();
    else if (a[i] === '--url') o.url = v().replace(/\/$/, '');
    else if (a[i] === '--ancho') o.ancho = Number(v());
    else if (a[i] === '--alto') o.alto = Number(v());
    else if (a[i] === '--pixeles') o.pixeles = Number(v());
    else if (a[i] === '--solo') o.solo = v().split(',');
    else if (a[i] === '--con-ui') o.conUi = true;
    else if (a[i] === '--sin-base') o.sinBase = true;
    else if (a[i] === '--consola') o.consola = true;
    else if (a[i] === '--toma') {
      const [nombre, ...resto] = v().split('=');
      o.tomas.push({ nombre, consulta: resto.join('=') });
    } else if (a[i] === '--tomas') {
      o.tomas.push(...JSON.parse(readFileSync(resolve(v()), 'utf8')));
    } else {
      console.error(`Opción desconocida: ${a[i]}`);
      process.exit(2);
    }
  }
  return o;
}

async function responde(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Arranca Vite si el juego no está servido. Devuelve el proceso (o null si ya estaba). */
async function servir(url) {
  if (await responde(url)) return null;
  const { port } = new URL(url);
  console.log(`El juego no está en ${url}; arranco Vite…`);
  const vite = spawn('npx', ['vite', '--port', port || '5173', '--strictPort', '--host', '127.0.0.1'], {
    cwd: join(raiz, 'juego'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let salida = '';
  vite.stdout.on('data', (d) => (salida += d));
  vite.stderr.on('data', (d) => (salida += d));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await responde(url)) return vite;
    if (vite.exitCode !== null) break;
  }
  console.error(`Vite no arrancó:\n${salida}`);
  apagar(vite);
  process.exit(1);
}

function apagar(proceso) {
  if (!proceso) return;
  try {
    process.kill(-proceso.pid, 'SIGTERM');
  } catch {
    proceso.kill('SIGTERM');
  }
}

/** Abre Chrome sin cabeza con WebGL. Prueba la gráfica real y, si no hay, el rasterizador por software. */
async function abrirChrome(ancho, alto) {
  if (!existsSync(CHROME)) {
    console.error(`No encuentro Chrome en ${CHROME}`);
    process.exit(1);
  }
  const comunes = ['--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${ancho},${alto}`];
  const intentos = [
    { nombre: 'gráfica (ANGLE/Metal)', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] },
    { nombre: 'gráfica (por defecto)', args: ['--enable-gpu', '--ignore-gpu-blocklist'] },
    { nombre: 'software (SwiftShader)', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  ];
  for (const intento of intentos) {
    let navegador;
    try {
      navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [...comunes, ...intento.args], defaultViewport: { width: ancho, height: alto, deviceScaleFactor: 1 } });
      const pagina = await navegador.newPage();
      const gl = await pagina.evaluate(() => {
        const c = document.createElement('canvas');
        const g = c.getContext('webgl2');
        if (!g) return null;
        const ext = g.getExtension('WEBGL_debug_renderer_info');
        return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
      });
      await pagina.close();
      if (gl) {
        console.log(`Chrome con WebGL por ${intento.nombre}: ${gl}`);
        return navegador;
      }
    } catch (e) {
      console.warn(`Intento «${intento.nombre}» fallido: ${e.message}`);
    }
    await navegador?.close().catch(() => {});
  }
  console.error('No se consiguió WebGL en Chrome sin cabeza.');
  process.exit(1);
}

async function main() {
  const o = opciones();
  let tomas = [...(o.sinBase ? [] : TOMAS_BASE), ...o.tomas];
  if (o.solo) tomas = tomas.filter((t) => o.solo.includes(t.nombre));
  if (!tomas.length) {
    console.error('No hay tomas que hacer.');
    process.exit(2);
  }
  const destino = join(raiz, 'docs', 'capturas');
  mkdirSync(destino, { recursive: true });

  const vite = await servir(o.url);
  // Aldeas de usar y tirar para las tomas que las piden ({nueva}, {guerra}).
  const pide = (hueco) => tomas.some((t) => t.consulta.includes(`{${hueco}}`));
  const aldeas = {};
  let muestra = null;
  if (pide('nueva') || pide('guerra')) {
    muestra = { ...(await import('./aldea-de-guerra.mjs')) };
    muestra.api = muestra.cliente(o.url);
    if (pide('nueva')) aldeas.nueva = await muestra.fundarNueva(muestra.api);
    if (pide('guerra')) {
      console.log('Preparando la aldea de guerra…');
      aldeas.guerra = await muestra.prepararGuerra(muestra.api, (texto) => console.log(texto)).catch(async (e) => {
        if (aldeas.nueva) await muestra.borrar(muestra.api, aldeas.nueva).catch(() => {});
        throw e;
      });
    }
  }
  const antes = {
    entendido: () => muestra.api.pedir(`/aldeas/${aldeas.nueva}/tutorial`, { orden: 'entendido' }),
    campana: () => muestra.campana(muestra.api, aldeas.guerra),
  };
  const navegador = await abrirChrome(o.ancho, o.alto);
  let fallos = 0;
  try {
    for (const toma of tomas) {
      const pagina = await navegador.newPage();
      const errores = [];
      pagina.on('pageerror', (e) => errores.push(String(e)));
      pagina.on('console', (m) => {
        if (m.type() === 'error') errores.push(m.text());
        else if (o.consola) console.log(`  [${m.type()}] ${m.text()}`);
      });
      const pedida = toma.consulta.replace(/\{(nueva|guerra)\}/g, (_, hueco) => aldeas[hueco]);
      const consulta = `${pedida}&captura=1&pixeles=${o.pixeles}${o.conUi || toma.ui ? '' : '&ui=0'}`;
      const prefijo = toma.fase ?? o.prefijo; // una lista de tomas puede traer su propia fase
      const archivo = join(destino, `${prefijo}-${toma.nombre}.png`);
      try {
        if (toma.antes) {
          if (!antes[toma.antes] || !muestra) throw new Error(`No sé hacer «${toma.antes}» antes de la toma`);
          await antes[toma.antes]();
        }
        await pagina.goto(`${o.url}/?${consulta}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await pagina.waitForFunction(() => window.__aldea && (window.__aldea.listo || window.__aldea.error), { timeout: 90000, polling: 250 });
        const error = await pagina.evaluate(() => window.__aldea.error);
        if (error) throw new Error(error);
        // Un respiro para que el humo, el agua y las figuras cojan su sitio.
        await new Promise((r) => setTimeout(r, toma.espera ?? 2500));
        const info = await pagina.evaluate(() => window.__aldea.info());
        await pagina.screenshot({ path: archivo, type: 'png' });
        console.log(`✓ ${prefijo}-${toma.nombre}.png  · ${info.fps} fps · ${info.llamadas} llamadas · ${Math.round(info.triangulos / 1000)} mil triángulos · ${info.edificios} edificios · sol a ${info.solAltura}°`);
        const graves = errores.filter((e) => !/favicon|open-meteo|Failed to load resource/i.test(e));
        if (graves.length) console.warn(`  avisos de la página: ${graves.slice(0, 4).join(' | ')}`);
      } catch (e) {
        fallos++;
        console.error(`✗ ${toma.nombre}: ${e.message}${errores.length ? `\n  ${errores.slice(0, 6).join('\n  ')}` : ''}`);
      }
      await pagina.close();
    }
  } finally {
    await navegador.close();
    for (const id of Object.values(aldeas)) await muestra.borrar(muestra.api, id).catch(() => console.warn(`(no pude borrar la aldea de muestra ${id})`));
    apagar(vite);
  }
  console.log(`\n${tomas.length - fallos} de ${tomas.length} capturas en ${destino}`);
  process.exit(fallos ? 1 : 0);
}

main();
