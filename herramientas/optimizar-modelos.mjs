// Convierte los modelos pesados de assets/ en GLB ligeros para el juego.
//
//   node herramientas/optimizar-modelos.mjs
//
// Lee assets/medieval-stylized/*.gltf (texturas de 2K–4K incrustadas, 443 MB en total), reduce las
// texturas a 512 px en WebP, limpia lo que sobra y escribe juego/public/modelos/<nombre>.glb junto con
// un manifiesto.json (medidas de cada modelo). También copia las texturas de hierba de EmaceArt a
// juego/public/texturas/. Nada de esto va a git: se regenera con este script.
//
// Del pack de EmaceArt (assets/emaceart-glb/, 225 piezas de madera y paja con una paleta de 32 px) solo
// se convierten las de la lista EMACEART, con el nombre `ea_<algo>`: el juego carga al arrancar todo lo
// que haya en el manifiesto y no tiene sentido bajar piezas que no usa.

import { readdirSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origen = join(raiz, 'assets', 'medieval-stylized');
const destino = join(raiz, 'juego', 'public', 'modelos');
const texturasOrigen = join(raiz, 'assets', 'emaceart-texture', 'Texture');
const texturasDestino = join(raiz, 'juego', 'public', 'texturas');

const origenEA = join(raiz, 'assets', 'emaceart-glb');

const LADO_TEXTURA = 512;

/** Piezas de EmaceArt que usa el juego: nombre en el manifiesto → archivo del pack (sin .glb). */
const EMACEART = {
  // Edificios enteros
  ea_cabana: 'EA03_Village_OutBuilding_Cubby_01d',
  ea_casona: 'EA03_Town_Building_Administrative _01a',
  ea_torre: 'EA03_Village_Tover_01a',
  ea_pozo: 'EA03_Prop_Village_Whell_01d',
  ea_pajar: 'EA03_Village_OutBuilding_Shed_01a',
  ea_cobertizo: 'EA03_Village_OutBuilding_WoodRoof_01b',
  ea_conejera: 'EA03_Village_AnimalBreeding_Hovel_01a',
  // Piezas sueltas de casa: muros de entramado (8 m) y tejados de paja
  ea_muro_liso: 'EA03_Village_Hut_Wall_Front_04h',
  ea_muro_ventanas: 'EA03_Village_Hut_Wall_Front_04b',
  ea_muro_puerta: 'EA03_Village_Hut_Wall_Front_04e',
  ea_tejado_paja: 'EA03_Village_Hut_Roof_Cut_01c',
  ea_tejado_paja_largo: 'EA03_Village_Hut_Roof_01c',
  // Leña y troncos
  ea_lenera: 'EA03_Items_House_Firewood_01a',
  ea_lenos: 'EA03_Prop_Forester_wooden_01d',
  ea_haz: 'EA03_Prop_Brushwood_03a',
  // Enseres
  ea_saco: 'EA03_Prop_Container_Bag_02a',
  ea_bala: 'EA03_Prop_Container_Bale_01a',
  ea_barril: 'EA03_Prop_Container_Barrel_01d',
  ea_tinaja: 'EA03_Prop_Container_Basket_01a',
  ea_cesto: 'EA03_Prop_Container_Basket_02',
  ea_cubo: 'EA03_Prop_Container_Basket_03a',
  ea_cuba: 'EA03_Prop_Container_Basket_04a',
  ea_cajon_abierto: 'EA03_Prop_Container_Crate_01a',
  ea_cajon: 'EA03_Prop_Container_Crate_02a',
  ea_cesto_verduras: 'EA03_Prop_Vegetable_Basket_02',
  ea_peto: 'EA03_Prop_Sign_Chapel_01',
};

function nombreLimpio(archivo) {
  return basename(archivo, '.gltf').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Medidas, triángulos y materiales de un modelo ya escrito, para el manifiesto. */
function ficha(doc, nombre, original, salida) {
  const escena = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(escena);
  let triangulos = 0;
  for (const malla of doc.getRoot().listMeshes()) {
    for (const p of malla.listPrimitives()) {
      const indices = p.getIndices();
      triangulos += (indices ? indices.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return {
    archivo: `${nombre}.glb`,
    original,
    min: min.map((v) => +v.toFixed(3)),
    max: max.map((v) => +v.toFixed(3)),
    tam: max.map((v, i) => +(v - min[i]).toFixed(3)),
    triangulos: Math.round(triangulos),
    materiales: doc.getRoot().listMaterials().map((m) => m.getName()),
    kb: Math.round(statSync(salida).size / 1024),
  };
}

/**
 * Piezas de EmaceArt: un solo material con una paleta de 32 px. Vienen marcadas como metálicas (sin mapa
 * de entorno saldrían casi negras) y con atributos de sobra; se dejan mates y con lo justo. La paleta se
 * queda en PNG y a su tamaño: comprimirla o reducirla mezclaría los colores.
 */
async function emaceart(io, manifiesto) {
  if (!existsSync(origenEA)) {
    console.warn('Sin el pack de EmaceArt (assets/emaceart-glb): el juego usará su geometría propia.');
    return 0;
  }
  let n = 0;
  for (const [nombre, original] of Object.entries(EMACEART)) {
    const ruta = join(origenEA, `${original}.glb`);
    if (!existsSync(ruta)) {
      console.warn(`EmaceArt: falta ${original}.glb`);
      continue;
    }
    const doc = await io.read(ruta);
    for (const m of doc.getRoot().listMaterials()) {
      m.setName('EA_Paleta').setMetallicFactor(0).setRoughnessFactor(0.9).setMetallicRoughnessTexture(null);
    }
    for (const malla of doc.getRoot().listMeshes()) {
      for (const p of malla.listPrimitives()) {
        for (const s of p.listSemantics()) {
          if (s !== 'POSITION' && s !== 'NORMAL' && s !== 'TEXCOORD_0') p.setAttribute(s, null);
        }
      }
    }
    await doc.transform(dedup(), weld(), prune());
    const salida = join(destino, `${nombre}.glb`);
    await io.write(salida, doc);
    manifiesto[nombre] = ficha(doc, nombre, `${original}.glb`, salida);
    console.log(`${nombre.padEnd(22)} ${String(manifiesto[nombre].kb).padStart(6)} KB  ${manifiesto[nombre].triangulos} tris`);
    n++;
  }
  return n;
}

async function modelos() {
  if (!existsSync(origen)) {
    console.error(`No encuentro ${origen}. Mira assets/LEEME.md para recuperar los packs.`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(destino, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const manifiesto = {};
  const archivos = readdirSync(origen).filter((f) => f.endsWith('.gltf')).sort();
  for (const archivo of archivos) {
    const nombre = nombreLimpio(archivo);
    const doc = await io.read(join(origen, archivo));
    await doc.transform(
      dedup(),
      weld(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [LADO_TEXTURA, LADO_TEXTURA], quality: 82 }),
      prune(),
    );
    const salida = join(destino, `${nombre}.glb`);
    await io.write(salida, doc);
    manifiesto[nombre] = ficha(doc, nombre, archivo, salida);
    console.log(`${nombre.padEnd(22)} ${String(manifiesto[nombre].kb).padStart(6)} KB  ${manifiesto[nombre].triangulos} tris`);
  }
  const deEmaceart = await emaceart(io, manifiesto);
  writeFileSync(join(destino, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2));
  const total = Object.values(manifiesto).reduce((s, m) => s + m.kb, 0);
  console.log(`\n${archivos.length + deEmaceart} modelos, ${(total / 1024).toFixed(1)} MB en total → ${destino}`);
}

async function texturas() {
  if (!existsSync(texturasOrigen)) {
    console.warn('Sin texturas de EmaceArt; el juego usará colores lisos para la hierba.');
    return;
  }
  mkdirSync(texturasDestino, { recursive: true });
  const lista = [
    ['Flower_Grass.png', 'hierba_flores.webp', 1024],
    ['Flower_Grass_NM.png', 'hierba_flores_normal.webp', 512],
    ['Grass_Texture.png', 'hierba_mata.webp', 480],
  ];
  for (const [de, a, lado] of lista) {
    const ruta = join(texturasOrigen, de);
    if (!existsSync(ruta)) continue;
    await sharp(ruta).resize(lado, lado).webp({ quality: 88, alphaQuality: 95 }).toFile(join(texturasDestino, a));
    console.log(`textura ${a}`);
  }
}

await modelos();
await texturas();
