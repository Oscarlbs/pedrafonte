# assets/

Aquí van los packs de modelos. **No están en git** (pesan ~800 MB y su licencia prohíbe redistribuirlos).

Cómo recuperarlos en un Mac nuevo:

1. Descarga otra vez los packs de donde los compraste/bajaste y déjalos en `assets/_origen/`:
   - `MedievalAssets GLTF with textures free.rar` (Medieval Stylized Assets, de alefranart)
   - `Texture.zip` (EmaceArt, Slavic World Free)
   - `glb.zip` (EmaceArt, de la misma página que `Texture.zip`)
2. Descomprime cada uno en su carpeta:
   ```bash
   bsdtar -xf "assets/_origen/MedievalAssets GLTF with textures free.rar" -C assets/medieval-stylized --strip-components 1
   unzip -o assets/_origen/Texture.zip -d assets/emaceart-texture
   unzip -o -j assets/_origen/glb.zip 'glb/*.glb' -d assets/emaceart-glb
   ```
3. Genera los modelos ligeros que usa el juego:
   ```bash
   node herramientas/optimizar-modelos.mjs
   ```

Inventario en `docs/INVENTARIO.md`; licencias en `docs/LICENCIAS.md`.
