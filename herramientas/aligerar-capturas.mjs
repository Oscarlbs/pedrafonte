// Convierte las capturas PNG de docs/capturas/ en JPEG ligeros (1600 px de ancho) y borra los PNG.
//   node herramientas/aligerar-capturas.mjs
// Las capturas van a git: en PNG pesan unos 3 MB cada una; así quedan en unos 300 KB.
import { readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'capturas');
for (const archivo of readdirSync(carpeta).filter((f) => f.endsWith('.png'))) {
  const origen = join(carpeta, archivo);
  await sharp(origen).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(origen.replace(/\.png$/, '.jpg'));
  unlinkSync(origen);
  console.log('aligerada', archivo);
}
