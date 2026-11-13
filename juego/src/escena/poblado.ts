// Poblado: coloca, quita y previsualiza edificios sobre la cuadrícula. Cada edificio sale de su
// constructor (edificios.ts), se «hornea» en los lotes por material y deja fuera solo lo que se
// mueve (la rueda del molino, las espigas). Las piezas de arrastre se enlazan con sus vecinas.
import * as THREE from 'three';
import { type EdificioCatalogo, edificioDeCatalogo, esArrastre, huella, LADO_CELDA, type Par } from '../datos';
import type { Cuadricula } from '../juego/cuadricula';
import { semillaDe } from '../util/azar';
import { construir, type ContextoObra } from './edificios';
import type { Efectos } from './efectos';
import type { Etiqueta, Ficha, Lotes } from './lotes';
import type { Biblioteca } from './modelos';
import type { Estacion, PaletaEstacion } from './paleta';
import { conMaterial, type Marca } from './taller';
import type { CapasSuelo, Rect, Terreno } from './terreno';
import type { ArbolPlantado, Vegetacion } from './vegetacion';

export interface DatosEdificio {
  id: string;
  /** Clave del catálogo (mundo/datos/edificios.yaml). */
  clave: string;
  /** Esquina mínima de la huella, en celdas. */
  cx: number;
  cz: number;
  /** Cuartos de vuelta: la fachada mira al sur (0), oeste (1), norte (2) o este (3). */
  rot?: number;
}

export interface DatosVistaPrevia {
  clave: string;
  cx: number;
  cz: number;
  rot?: number;
  valido: boolean;
}

interface PiezaPlantilla {
  geometria: THREE.BufferGeometry;
  material: THREE.Material;
  matriz: THREE.Matrix4;
  /** La geometría es de esta plantilla (no del pack) y hay que soltarla al descartarla. */
  propia: boolean;
}

interface Plantilla {
  piezas: PiezaPlantilla[];
  vivos: THREE.Object3D[];
  marcas: Marca[];
}

interface Puesto {
  datos: Required<DatosEdificio>;
  cat: EdificioCatalogo;
  rect: Rect;
  fichas: Ficha[];
  soporte: THREE.Group | null;
  arbol: ArbolPlantado | null;
  enlaces: number;
}

interface Giro {
  eje: 'x' | 'y' | 'z';
  vel: number;
}

const VECINOS: [number, number, number][] = [
  [0, -1, 1],
  [1, 0, 2],
  [0, 1, 4],
  [-1, 0, 8],
];
const SIN_PISAR = new Set(['campo', 'huerto', 'arbol', 'camino']);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

export class Poblado {
  /** Aquí cuelgan las piezas vivas (no horneadas) y el fantasma de la vista previa. */
  readonly grupo = new THREE.Group();
  private readonly puestos = new Map<string, Puesto>();
  private readonly plantillas = new Map<string, Plantilla>();
  private readonly girando: THREE.Object3D[] = [];
  private readonly caminos = new Map<number, string>();
  private capasSucias = true;
  private estacion: Estacion;
  private paleta: PaletaEstacion;
  private fantasma: { clave: string; enlaces: number; grupo: THREE.Group; losa: THREE.Mesh } | null = null;
  private readonly matFantasma = {
    si: new THREE.MeshBasicMaterial({ color: 0x6fd07a, transparent: true, opacity: 0.6 }),
    no: new THREE.MeshBasicMaterial({ color: 0xe0584a, transparent: true, opacity: 0.6 }),
  };

  constructor(
    private readonly lotes: Lotes,
    private readonly bib: Biblioteca,
    private readonly cuadricula: Cuadricula,
    private readonly terreno: Terreno,
    private readonly vegetacion: Vegetacion,
    private readonly efectos: Efectos,
    estacion: Estacion,
    paleta: PaletaEstacion,
  ) {
    this.estacion = estacion;
    this.paleta = paleta;
    this.grupo.name = 'poblado';
  }

  private contexto(cat: EdificioCatalogo, variante: number, enlaces?: number): ContextoObra {
    return {
      bib: this.bib,
      ancho: cat.tam[0] * LADO_CELDA,
      fondo: cat.tam[1] * LADO_CELDA,
      semilla: semillaDe(cat.modelo) + variante * 977,
      variante,
      estacion: this.estacion,
      paleta: this.paleta,
      enlaces,
    };
  }

  /** Separa un grupo en piezas para los lotes, piezas vivas y marcas. */
  private hornear(grupo: THREE.Group): Plantilla {
    grupo.updateMatrixWorld(true);
    const piezas: PiezaPlantilla[] = [];
    const vivos: THREE.Object3D[] = [];
    const recorrer = (o: THREE.Object3D) => {
      if (o.userData['vivo']) {
        vivos.push(o);
        return;
      }
      if (o instanceof THREE.Mesh) {
        const geometria = o.geometry as THREE.BufferGeometry;
        piezas.push({ geometria, material: o.material as THREE.Material, matriz: o.matrixWorld.clone(), propia: !geometria.userData['compartida'] });
      }
      for (const h of o.children) recorrer(h);
    };
    for (const h of grupo.children) recorrer(h);
    return { piezas, vivos, marcas: (grupo.userData['marcas'] as Marca[] | undefined) ?? [] };
  }

  private plantilla(cat: EdificioCatalogo, variante: number, enlaces: number): Plantilla {
    const clave = `${cat.modelo}|${variante}|${enlaces}`;
    let p = this.plantillas.get(clave);
    if (!p) {
      p = this.hornear(construir(cat.modelo, this.contexto(cat, variante, enlaces || undefined)));
      this.plantillas.set(clave, p);
    }
    return p;
  }

  /** Mete en los lotes un grupo suelto (el puente, por ejemplo) con la transformación dada. */
  hornearGrupo(grupo: THREE.Group, matriz: THREE.Matrix4, etiqueta?: Etiqueta): Ficha[] {
    const fichas: Ficha[] = [];
    for (const pieza of this.hornear(grupo).piezas) {
      fichas.push(this.lotes.crear(pieza.geometria, pieza.material, _m.multiplyMatrices(matriz, pieza.matriz), etiqueta));
    }
    return fichas;
  }

  /** Centro de la huella, altura del suelo y giro del edificio. */
  asiento(cat: EdificioCatalogo, cx: number, cz: number, rot: number): { x: number; y: number; z: number; ry: number; rect: Rect } {
    const [w, f] = huella(cat, rot);
    const { x, z } = this.cuadricula.celdaAMundo(cx + (w - 1) / 2, cz + (f - 1) / 2);
    const a = (w * LADO_CELDA) / 2 - 0.5;
    const b = (f * LADO_CELDA) / 2 - 0.5;
    const h = (px: number, pz: number) => this.terreno.alturaEn(px, pz);
    const y = (h(x, z) * 2 + h(x - a, z - b) + h(x + a, z - b) + h(x - a, z + b) + h(x + a, z + b)) / 6 - 0.02;
    return { x, y, z, ry: (-rot * Math.PI) / 2, rect: { cx, cz, ancho: w, fondo: f } };
  }

  private enlacesDe(clave: string, cx: number, cz: number, ignorar?: string): number {
    let bits = 0;
    for (const [dx, dz, bit] of VECINOS) {
      const id = this.cuadricula.ocupante(cx + dx, cz + dz);
      if (!id || id === ignorar) continue;
      if (this.puestos.get(id)?.datos.clave === clave) bits |= bit;
    }
    return bits;
  }

  /** Crea las piezas de un edificio ya anotado (o las rehace si cambian sus enlaces). */
  private levantar(p: Puesto): void {
    const { datos, cat } = p;
    const arrastre = esArrastre(cat);
    let rot = datos.rot;
    let enlaces = 0;
    if (arrastre) {
      enlaces = this.enlacesDe(datos.clave, datos.cx, datos.cz);
      // Una pieza suelta se dibuja como un tramo corto, de este a oeste o de norte a sur.
      p.enlaces = enlaces;
      if (enlaces === 0) enlaces = rot % 2 === 0 ? 10 : 5;
      rot = 0;
    }
    const variante = semillaDe(datos.id) % (arrastre ? 2 : 3);
    const plantilla = this.plantilla(cat, variante, enlaces);
    const s = this.asiento(cat, datos.cx, datos.cz, arrastre ? 0 : datos.rot);
    const base = new THREE.Matrix4().makeRotationY(s.ry).setPosition(s.x, s.y, s.z);
    const etiqueta: Etiqueta = { tipo: 'edificio', id: datos.id };
    for (const pieza of plantilla.piezas) {
      p.fichas.push(this.lotes.crear(pieza.geometria, pieza.material, _m.multiplyMatrices(base, pieza.matriz), etiqueta));
    }
    if (plantilla.vivos.length) {
      const soporte = new THREE.Group();
      soporte.applyMatrix4(base);
      soporte.userData['etiqueta'] = etiqueta;
      for (const v of plantilla.vivos) soporte.add(v.clone(true));
      this.grupo.add(soporte);
      soporte.updateMatrixWorld(true);
      soporte.traverse((o) => {
        if (o.userData['giro']) this.girando.push(o);
        if (o instanceof THREE.InstancedMesh && o.userData['pegarAlSuelo']) this.pegarAlSuelo(o);
      });
      p.soporte = soporte;
    }
    const marcas = plantilla.marcas.map((m) => ({ ...m, pos: m.pos.clone().applyMatrix4(base) }));
    this.efectos.registrar(datos.id, marcas, s.y);
  }

  /** Ajusta cada instancia (espigas, coles) a la altura real del terreno bajo ella. */
  private pegarAlSuelo(malla: THREE.InstancedMesh): void {
    for (let i = 0; i < malla.count; i++) {
      malla.getMatrixAt(i, _m);
      _p.setFromMatrixPosition(_m);
      const local = _p.clone();
      _p.applyMatrix4(malla.matrixWorld);
      const dy = this.terreno.alturaEn(_p.x, _p.z) - _p.y;
      _m.setPosition(local.x, local.y + dy, local.z);
      malla.setMatrixAt(i, _m);
    }
    malla.instanceMatrix.needsUpdate = true;
  }

  private derribar(p: Puesto): void {
    for (const f of p.fichas) this.lotes.quitar(f);
    p.fichas.length = 0;
    if (p.soporte) {
      p.soporte.traverse((o) => {
        const i = this.girando.indexOf(o);
        if (i >= 0) this.girando.splice(i, 1);
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      this.grupo.remove(p.soporte);
      p.soporte = null;
    }
    this.efectos.quitar(p.datos.id);
  }

  private reenlazarVecinos(p: Puesto): void {
    for (const [dx, dz] of VECINOS) {
      const id = this.cuadricula.ocupante(p.datos.cx + dx, p.datos.cz + dz);
      const v = id ? this.puestos.get(id) : undefined;
      if (!v || v.datos.clave !== p.datos.clave) continue;
      if (this.enlacesDe(v.datos.clave, v.datos.cx, v.datos.cz) !== v.enlaces) {
        this.derribar(v);
        this.levantar(v);
      }
    }
  }

  /** Coloca un edificio del catálogo. Si ya había uno con ese id, lo sustituye. */
  poner(d: DatosEdificio): boolean {
    const cat = edificioDeCatalogo(d.clave);
    if (!cat) {
      console.warn(`Edificio desconocido: ${d.clave}`);
      return false;
    }
    if (this.puestos.has(d.id)) this.quitar(d.id);
    const datos: Required<DatosEdificio> = { id: d.id, clave: d.clave, cx: d.cx, cz: d.cz, rot: ((d.rot ?? 0) % 4 + 4) % 4 };
    const [w, f] = huella(cat, datos.rot);
    const p: Puesto = { datos, cat, rect: { cx: d.cx, cz: d.cz, ancho: w, fondo: f }, fichas: [], soporte: null, arbol: null, enlaces: 0 };
    this.puestos.set(d.id, p);
    this.capasSucias = true;

    if (cat.modelo === 'camino') {
      this.cuadricula.marcarCamino(d.cx, d.cz, true);
      this.caminos.set(this.cuadricula.indice(d.cx, d.cz), d.id);
      this.vegetacion.despejar(d.id, p.rect);
      return true;
    }
    if (cat.modelo === 'arbol') {
      const { x, z } = this.cuadricula.celdaAMundo(d.cx, d.cz);
      this.vegetacion.despejar(d.id, p.rect);
      p.arbol = this.vegetacion.plantar(x, z, semillaDe(d.id));
      this.cuadricula.ocupar(d.cx, d.cz, d.id);
      return true;
    }
    for (let j = 0; j < f; j++) for (let i = 0; i < w; i++) this.cuadricula.ocupar(d.cx + i, d.cz + j, d.id);
    this.vegetacion.despejar(d.id, p.rect);
    this.levantar(p);
    if (esArrastre(cat)) this.reenlazarVecinos(p);
    return true;
  }

  quitar(id: string): boolean {
    const p = this.puestos.get(id);
    if (!p) return false;
    this.puestos.delete(id);
    this.capasSucias = true;
    this.vegetacion.restaurar(id);
    if (p.cat.modelo === 'camino') {
      this.cuadricula.marcarCamino(p.datos.cx, p.datos.cz, false);
      const i = this.cuadricula.indice(p.datos.cx, p.datos.cz);
      if (this.caminos.get(i) === id) this.caminos.delete(i);
      return true;
    }
    for (let j = 0; j < p.rect.fondo; j++) for (let i = 0; i < p.rect.ancho; i++) this.cuadricula.liberar(p.datos.cx + i, p.datos.cz + j, id);
    if (p.arbol) {
      this.vegetacion.talar(p.arbol);
      return true;
    }
    this.derribar(p);
    if (esArrastre(p.cat)) this.reenlazarVecinos(p);
    return true;
  }

  vaciar(): void {
    for (const id of [...this.puestos.keys()]) this.quitar(id);
  }

  tiene(id: string): boolean {
    return this.puestos.has(id);
  }

  /** Id de la celda de camino puesta ahí (los caminos no ocupan: se pasa por ellos). */
  caminoEn(cx: number, cz: number): string | undefined {
    return this.cuadricula.dentro(cx, cz) ? this.caminos.get(this.cuadricula.indice(cx, cz)) : undefined;
  }

  lista(): Required<DatosEdificio>[] {
    return [...this.puestos.values()].map((p) => ({ ...p.datos }));
  }

  /** Celda de la puerta (la de delante de la fachada) de un edificio, para que las figuras vayan a ella. */
  celdaPuerta(id: string): Par | null {
    const p = this.puestos.get(id);
    if (!p) return null;
    const { cx, cz, ancho, fondo } = p.rect;
    const medio: Par[] = [
      [cx + Math.floor(ancho / 2), cz + fondo],
      [cx - 1, cz + Math.floor(fondo / 2)],
      [cx + Math.floor(ancho / 2), cz - 1],
      [cx + ancho, cz + Math.floor(fondo / 2)],
    ];
    return medio[p.datos.rot];
  }

  /** Cambia de estación: se rehacen las plantillas y todos los edificios. */
  fijarEstacion(estacion: Estacion, paleta: PaletaEstacion): void {
    this.paleta = paleta;
    if (estacion === this.estacion) return;
    this.estacion = estacion;
    const todos = this.lista();
    this.vaciar();
    for (const pl of this.plantillas.values()) {
      for (const pieza of pl.piezas) {
        if (!pieza.propia) continue;
        this.lotes.soltarGeometria(pieza.geometria);
        pieza.geometria.dispose();
      }
      // Las piezas vivas (rueda, espigas) también tienen geometría propia.
      for (const vivo of pl.vivos) {
        vivo.traverse((o) => {
          if (o instanceof THREE.Mesh && !(o.geometry as THREE.BufferGeometry).userData['compartida']) (o.geometry as THREE.BufferGeometry).dispose();
        });
      }
    }
    this.plantillas.clear();
    this.quitarFantasma();
    for (const d of todos) this.poner(d);
  }

  private capas(): CapasSuelo {
    const capas: CapasSuelo = { caminos: [], cultivos: [], pisados: [] };
    for (const p of this.puestos.values()) {
      const m = p.cat.modelo;
      if (m === 'camino') capas.caminos.push([p.datos.cx, p.datos.cz]);
      else if (m === 'campo' || m === 'huerto') capas.cultivos.push(p.rect);
      else if (!SIN_PISAR.has(m) && p.cat.categoria !== 'adorno' && !esArrastre(p.cat)) capas.pisados.push(p.rect);
    }
    return capas;
  }

  private quitarFantasma(): void {
    if (!this.fantasma) return;
    this.grupo.remove(this.fantasma.grupo, this.fantasma.losa);
    this.fantasma.losa.geometry.dispose();
    this.fantasma = null;
  }

  /** Fantasma verde (válido) o rojo sobre la cuadrícula; null lo quita. */
  vistaPrevia(v: DatosVistaPrevia | null): void {
    if (!v) {
      this.quitarFantasma();
      return;
    }
    const cat = edificioDeCatalogo(v.clave);
    if (!cat) return;
    const rot = ((v.rot ?? 0) % 4 + 4) % 4;
    const arrastre = esArrastre(cat);
    let enlaces = 0;
    if (arrastre && cat.modelo !== 'camino') {
      enlaces = this.enlacesDe(v.clave, v.cx, v.cz);
      if (enlaces === 0) enlaces = rot % 2 === 0 ? 10 : 5;
    }
    if (!this.fantasma || this.fantasma.clave !== v.clave || this.fantasma.enlaces !== enlaces) {
      this.quitarFantasma();
      const grupo = construir(cat.modelo, this.contexto(cat, 0, enlaces || undefined));
      const losa = new THREE.Mesh(new THREE.PlaneGeometry(cat.tam[0] * LADO_CELDA - 0.1, cat.tam[1] * LADO_CELDA - 0.1), this.matFantasma.si);
      losa.geometry.rotateX(-Math.PI / 2);
      losa.renderOrder = 4;
      grupo.renderOrder = 4;
      this.fantasma = { clave: v.clave, enlaces, grupo, losa };
      this.grupo.add(grupo, losa);
    }
    const material = v.valido ? this.matFantasma.si : this.matFantasma.no;
    conMaterial(this.fantasma.grupo, material);
    this.fantasma.losa.material = material;
    const s = this.asiento(cat, v.cx, v.cz, arrastre ? 0 : rot);
    for (const o of [this.fantasma.grupo, this.fantasma.losa]) {
      o.position.set(s.x, s.y, s.z);
      o.rotation.y = s.ry;
    }
    this.fantasma.losa.position.y += 0.12;
  }

  /** Dueño de una pieza viva tocada por un rayo (rueda del molino, trigal). */
  etiquetaDe(objeto: THREE.Object3D): Etiqueta | null {
    let o: THREE.Object3D | null = objeto;
    while (o) {
      const e = o.userData['etiqueta'] as Etiqueta | undefined;
      if (e) return e;
      o = o.parent;
    }
    return null;
  }

  actualizar(dt: number): void {
    for (const o of this.girando) {
      const g = o.userData['giro'] as Giro;
      o.rotation[g.eje] += g.vel * dt;
    }
    if (this.capasSucias) {
      this.capasSucias = false;
      this.terreno.fijarCapas(this.capas());
    }
  }
}
