// Hojas de contactos de una carpeta de GLB, para ver de un vistazo qué trae un pack.
//
//   node herramientas/galeria-modelos.mjs <carpeta de GLB> <carpeta de salida> [expresión regular] [--frente|--lado|--arriba]
//
// Sirve la carpeta y three.js desde un puerto local efímero, dibuja cada modelo con el Chrome del Mac
// y guarda hojas PNG de 5 × 4 miniaturas con el nombre y las medidas (ancho × alto × fondo, en metros).
// La vista es de tres cuartos desde el sureste (+x, +z); con --frente, desde +z; con --lado, desde +x;
// con --arriba, desde el cielo (norte arriba). Los ejes pintados: x en rojo, z en azul.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const vista = process.argv.includes('--frente') ? 'frente' : process.argv.includes('--lado') ? 'lado' : process.argv.includes('--arriba') ? 'arriba' : process.argv.includes('--otro') ? 'otro' : process.argv.includes('--atras') ? 'atras' : 'cuartos';
const [carpeta, salida, patron] = args;
if (!carpeta || !salida) {
  console.error('Uso: node herramientas/galeria-modelos.mjs <carpeta de GLB> <carpeta de salida> [regex] [--frente|--lado|--arriba]');
  process.exit(1);
}
const origen = resolve(carpeta);
const three = join(raiz, 'juego', 'node_modules', 'three');
const filtro = patron ? new RegExp(patron, 'i') : null;
const archivos = readdirSync(origen).filter((f) => f.endsWith('.glb') && (!filtro || filtro.test(f))).sort();
mkdirSync(resolve(salida), { recursive: true });

const PAGINA = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">
<canvas id="hoja"></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const LADO = 384, COLS = 5, FILAS = 4;
const hoja = document.getElementById('hoja');
hoja.width = LADO * COLS; hoja.height = (LADO + 34) * FILAS;
const ctx = hoja.getContext('2d');
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(LADO, LADO);
const escena = new THREE.Scene();
escena.background = new THREE.Color(0xb9c4cc);
escena.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.5));
const sol = new THREE.DirectionalLight(0xfff2dd, 2.4); sol.position.set(4, 8, 6); escena.add(sol);
const suelo = new THREE.GridHelper(40, 40, 0x556066, 0x9aa5ab); escena.add(suelo);
const camara = new THREE.PerspectiveCamera(30, 1, 0.05, 500);
const cargador = new GLTFLoader();
escena.add(new THREE.AxesHelper(3));
const VISTAS = { cuartos: [0.75, 0.55, 1], frente: [0, 0.25, 1], lado: [1, 0.25, 0], arriba: [0, 1, 0.001], otro: [-1, 0.25, 0], atras: [-0.75, 0.55, -1] };
window.pintar = async (nombres, vista) => {
  ctx.fillStyle = '#20252a'; ctx.fillRect(0, 0, hoja.width, hoja.height);
  for (let i = 0; i < nombres.length; i++) {
    const x = (i % COLS) * LADO, y = Math.floor(i / COLS) * (LADO + 34);
    let rotulo = nombres[i];
    try {
      const gltf = await cargador.loadAsync('/m/' + encodeURIComponent(nombres[i]));
      const caja = new THREE.Box3().setFromObject(gltf.scene);
      const tam = caja.getSize(new THREE.Vector3()), centro = caja.getCenter(new THREE.Vector3());
      escena.add(gltf.scene);
      const radio = Math.max(tam.length() / 2, 0.05);
      const dir = new THREE.Vector3(...VISTAS[vista]);
      camara.position.copy(centro).addScaledVector(dir.normalize(), radio / Math.sin((15 * Math.PI) / 180) * 1.02);
      camara.near = radio / 50; camara.far = radio * 20; camara.updateProjectionMatrix();
      camara.lookAt(centro);
      suelo.position.set(0, 0, 0);
      r.render(escena, camara);
      ctx.drawImage(r.domElement, x, y, LADO, LADO);
      escena.remove(gltf.scene);
      rotulo += '  ' + tam.x.toFixed(1) + '×' + tam.y.toFixed(1) + '×' + tam.z.toFixed(1) + '  y0=' + caja.min.y.toFixed(2);
    } catch (e) { rotulo += '  ERROR'; }
    ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif';
    ctx.fillText(rotulo.replace(/^EA0?3?_/, '').replace('.glb', ''), x + 6, y + LADO + 21, LADO - 12);
  }
  return hoja.toDataURL('image/png');
};
window.listo = true;
</script>`;

const TIPOS = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };
const servidor = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end(PAGINA);
  const base = ruta.startsWith('/three/') ? three : ruta.startsWith('/m/') ? origen : null;
  const archivo = base && normalize(join(base, ruta.replace(/^\/(three|m)\//, '')));
  if (!archivo || !archivo.startsWith(base) || !existsSync(archivo)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
  createReadStream(archivo).pipe(res);
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${servidor.address().port}/`;

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
try {
  const pagina = await navegador.newPage();
  pagina.on('pageerror', (e) => console.error('página:', e.message));
  await pagina.goto(url);
  await pagina.waitForFunction('window.listo === true', { timeout: 20000 });
  for (let i = 0, n = 1; i < archivos.length; i += 20, n++) {
    const datos = await pagina.evaluate((lote, f) => window.pintar(lote, f), archivos.slice(i, i + 20), vista);
    const destino = join(resolve(salida), `hoja-${String(n).padStart(2, '0')}.png`);
    writeFileSync(destino, Buffer.from(datos.split(',')[1], 'base64'));
    console.log(destino, `(${archivos.slice(i, i + 20).length} modelos)`);
  }
} finally {
  await navegador.close();
  servidor.close();
}
