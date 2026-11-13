// Trozos de GLSL compartidos por los materiales del valle.

/** Ruido de valor barato para fragmentos. */
export const RUIDO_GLSL = /* glsl */ `
float aldeaHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float aldeaRuido(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = aldeaHash(i);
  float b = aldeaHash(i + vec2(1.0, 0.0));
  float c = aldeaHash(i + vec2(0.0, 1.0));
  float d = aldeaHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float aldeaFbm(vec2 p) {
  return aldeaRuido(p) * 0.55 + aldeaRuido(p * 2.07 + 11.3) * 0.3 + aldeaRuido(p * 4.3 + 5.1) * 0.15;
}
`;

/** Uniformes globales que comparten varios materiales (nieve, viento, noche…). */
export const GLOBALES = {
  uTiempo: { value: 0 },
  /** 0–1: cuánta nieve cubre lo que mira hacia arriba. */
  uNieve: { value: 0 },
  /** 0–1: ventanas y faroles encendidos. */
  uLuces: { value: 0 },
  /** 0–1: fuerza del viento (mueve hierba y copas). */
  uViento: { value: 0.3 },
  /** 0–1: lluvia (salpica el agua, oscurece el suelo). */
  uLluvia: { value: 0 },
};
