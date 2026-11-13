// Una vista es una lista de colocaciones hecha solo con la fachada `Mundo` (docs/ESCENA.md).
import type { Mundo, PoseCamara } from '../mundo';

export interface Vista {
  clave: string;
  nombre: string;
  /** Vacía el mundo y coloca lo suyo. Devuelve una función que detiene lo que deje en marcha. */
  montar(mundo: Mundo): () => void;
  /** Encuadre con el que se abre. */
  camara(mundo: Mundo): Partial<PoseCamara>;
}

/** Ayuda para colocar: numera los ids y avisa si algo pisa agua u otro edificio. */
export function colocador(mundo: Mundo, prefijo: string): (clave: string, cx: number, cz: number, rot?: number) => string {
  let n = 0;
  return (clave, cx, cz, rot = 0) => {
    const id = `${prefijo}-${clave}-${++n}`;
    if (import.meta.env.DEV) {
      const ocupado = mundo.ocupante(cx, cz);
      if (ocupado) console.warn(`[vista] ${id} en (${cx}, ${cz}) pisa a ${ocupado}`);
      if (mundo.tipoCelda(cx, cz) === 'agua') console.warn(`[vista] ${id} en (${cx}, ${cz}) cae al agua`);
    }
    mundo.ponerEdificio({ id, clave, cx, cz, rot });
    return id;
  };
}
