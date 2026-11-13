// Azar con semilla y ruido suave. Todo lo procedural del valle sale de aquí para que cada paisaje
// se dibuje siempre igual.

export type Azar = () => number;

/** Generador pseudoaleatorio pequeño y rápido (mulberry32). Devuelve valores en [0, 1). */
export function crearAzar(semilla: number): Azar {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convierte un texto en una semilla entera estable. */
export function semillaDe(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2(ix: number, iz: number, semilla: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(semilla, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor suavizado en [0, 1]. */
export function ruido2(x: number, z: number, semilla = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, semilla);
  const b = hash2(ix + 1, iz, semilla);
  const c = hash2(ix, iz + 1, semilla);
  const d = hash2(ix + 1, iz + 1, semilla);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Suma de octavas de ruido, en [0, 1]. */
export function fbm(x: number, z: number, octavas = 3, semilla = 0): number {
  let total = 0;
  let amplitud = 0.5;
  let norma = 0;
  let f = 1;
  for (let i = 0; i < octavas; i++) {
    total += ruido2(x * f, z * f, semilla + i * 17) * amplitud;
    norma += amplitud;
    amplitud *= 0.5;
    f *= 2.03;
  }
  return total / norma;
}

export function suave(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function mezcla(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function limitar(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

/** Elige un elemento de la lista con el azar dado. */
export function elegir<T>(azar: Azar, lista: readonly T[]): T {
  return lista[Math.floor(azar() * lista.length) % lista.length];
}

/** Valor entre a y b. */
export function entre(azar: Azar, a: number, b: number): number {
  return a + (b - a) * azar();
}
