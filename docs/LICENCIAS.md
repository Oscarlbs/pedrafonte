# Licencias de los packs

Resumen hecho leyendo lo que traía cada pack. No soy abogado: si el juego se va a publicar, conviene
releer las licencias originales.

## Medieval Stylized Assets · versión gratuita (alefranart)

Archivo: `assets/medieval-stylized/Free version license.txt`. Dice, en corto:

- ✅ Se puede usar en proyectos comerciales.
- ✅ Se puede usar con fines educativos.
- ⚠️ Se puede modificar **solo para uso personal**.
- ❌ No se puede redistribuir ni revender, ni siquiera modificado.

**Qué significa aquí**

- Usarlo en el juego: permitido.
- Reducir las texturas para que el juego vaya fluido es una modificación; mientras el juego sea para uso
  propio, entra en «uso personal». Si algún día se publica, lo prudente es usar los modelos sin modificar o
  preguntar al autor (https://twitter.com/alefranart).
- **No van a git**, ni los originales ni los optimizados: subirlos a un repo, aunque sea privado, se parece
  demasiado a redistribuir. Por eso `assets/` y `juego/public/modelos/` están en `.gitignore`.
- En el despliegue, los modelos se sirven al navegador como parte del juego (uso normal de un asset en un
  proyecto). Lo que no hay que hacer es ofrecerlos para descargar como pack.

**Veredicto: se usa.**

## EmaceArt · «Free Fantasy Medieval Houses and Props Pack» (Slavic World Free)

Origen: https://emaceart.itch.io/free-fantasy-medieval-houses-and-props-pack (de ahí salen `Texture.zip`,
`glb.zip` y el manual PDF). El zip no trae la licencia dentro; la página, consultada el 12 nov 2026, dice:

- ✅ «EmacEArt Asset License»: uso libre en proyectos propios, personales y comerciales.
- ✅ No hace falta citar al autor (se agradece).
- ❌ No revender los archivos ni pasarlos sueltos o dentro de otro pack.
- La ficha de itch.io marca además «Creative Commons Zero v1.0»; la página no explica cómo casa eso con la
  licencia propia, así que me quedo con la más estricta de las dos.

**Qué significa aquí**: se puede usar en el juego. Igual que el otro pack, **no va a git** y no se ofrece
para descargar.

**Veredicto: se usa.**

## Lo hecho a mano

Casas, molino, árboles, aldeanos, animales, terreno, agua y cielo son geometría y shaders escritos para este
proyecto: no dependen de ninguna licencia ajena.

## Dependencias de código

Paquetes de npm y pip con licencias abiertas (Three.js MIT, Vite MIT, FastAPI MIT, SQLAlchemy MIT, etc.).
