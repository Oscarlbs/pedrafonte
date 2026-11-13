// Lista medidas, triángulos, materiales y texturas de los GLB de una carpeta.
//   node herramientas/inspeccionar-glb.mjs assets/emaceart-glb
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const carpeta = process.argv[2];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const archivo of readdirSync(carpeta).filter((f) => f.endsWith('.glb')).sort()) {
  try {
    const doc = await io.read(join(carpeta, archivo));
    const raiz = doc.getRoot();
    const escena = raiz.getDefaultScene() ?? raiz.listScenes()[0];
    const { min, max } = getBounds(escena);
    let tris = 0;
    for (const m of raiz.listMeshes()) for (const p of m.listPrimitives()) {
      const i = p.getIndices();
      tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
    const mats = raiz.listMaterials().map((m) => `${m.getName()}${m.getBaseColorTexture() ? '*' : ''}[${m.getBaseColorFactor().map((v) => v.toFixed(2)).join(',')}]`);
    const tex = raiz.listTextures().map((t) => `${t.getName() || t.getURI()}:${t.getMimeType()}:${t.getSize()?.join('x')}`);
    const attrs = new Set();
    for (const m of raiz.listMeshes()) for (const p of m.listPrimitives()) for (const s of p.listSemantics()) attrs.add(s);
    console.log([archivo, 'tam=' + max.map((v, i) => (v - min[i]).toFixed(2)).join('x'), 'min=' + min.map((v) => v.toFixed(2)).join(','), 'tris=' + Math.round(tris), 'nodos=' + raiz.listNodes().length, 'mats=' + mats.join('|'), 'tex=' + tex.join('|'), 'attr=' + [...attrs].join(','), 'anim=' + raiz.listAnimations().length].join('  '));
  } catch (e) { console.log(archivo, 'ERROR', e.message); }
}
