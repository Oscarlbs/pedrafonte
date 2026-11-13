// Lotes: todo lo sólido de la aldea (edificios, enseres, figuras) se dibuja agrupado por material en
// un THREE.BatchedMesh. Así un pueblo entero cuesta una llamada de dibujo por material y no una por
// pieza, que es lo que permite llegar a 60 fps con mucho detalle.
import * as THREE from 'three';

/** A quién pertenece una pieza, para saber qué hay bajo el puntero. */
export interface Etiqueta {
  tipo: 'edificio' | 'figura' | 'animal';
  id: string;
}

export interface Ficha {
  lote: Lote;
  instancia: number;
}

const _color = new THREE.Color();

export class Lote {
  readonly malla: THREE.BatchedMesh;
  readonly etiquetas = new Map<number, Etiqueta>();
  private readonly geometrias = new Map<THREE.BufferGeometry, { id: number; v: number; i: number }>();
  private maxV: number;
  private maxI: number;
  private maxInst: number;
  private sigV = 0;
  private sigI = 0;
  private huecoV = 0;
  private instancias = 0;

  constructor(material: THREE.Material, sombra: boolean) {
    this.maxInst = 256;
    this.maxV = 16384;
    this.maxI = 49152;
    this.malla = new THREE.BatchedMesh(this.maxInst, this.maxV, this.maxI, material);
    this.malla.castShadow = sombra;
    this.malla.receiveShadow = true;
    this.malla.frustumCulled = false;
    this.malla.sortObjects = false;
    this.malla.name = `lote:${material.name || material.type}`;
  }

  private asegurar(v: number, i: number): void {
    if (this.sigV + v <= this.maxV && this.sigI + i <= this.maxI) return;
    // Antes de crecer, se recupera el hueco de las geometrías borradas.
    if (this.huecoV > this.maxV * 0.3) {
      this.malla.optimize();
      this.huecoV = 0;
      this.sigV = 0;
      this.sigI = 0;
      for (const g of this.geometrias.values()) {
        this.sigV += g.v;
        this.sigI += g.i;
      }
      if (this.sigV + v <= this.maxV && this.sigI + i <= this.maxI) return;
    }
    while (this.sigV + v > this.maxV) this.maxV *= 2;
    while (this.sigI + i > this.maxI) this.maxI *= 2;
    this.malla.setGeometrySize(this.maxV, this.maxI);
  }

  /** Da de alta una geometría (una sola vez por objeto) y devuelve su número en el lote. */
  registrar(geometria: THREE.BufferGeometry): number {
    const ya = this.geometrias.get(geometria);
    if (ya) return ya.id;
    const v = geometria.getAttribute('position').count;
    const i = geometria.getIndex()?.count ?? 0;
    this.asegurar(v, i);
    const id = this.malla.addGeometry(geometria);
    this.geometrias.set(geometria, { id, v, i });
    this.sigV += v;
    this.sigI += i;
    return id;
  }

  soltarGeometria(geometria: THREE.BufferGeometry): void {
    const ya = this.geometrias.get(geometria);
    if (!ya) return;
    this.malla.deleteGeometry(ya.id);
    this.geometrias.delete(geometria);
    this.huecoV += ya.v;
  }

  crear(geometria: THREE.BufferGeometry, matriz: THREE.Matrix4, etiqueta?: Etiqueta): number {
    const idGeo = this.registrar(geometria);
    if (this.instancias >= this.maxInst) {
      this.maxInst *= 2;
      this.malla.setInstanceCount(this.maxInst);
    }
    const inst = this.malla.addInstance(idGeo);
    this.instancias++;
    this.malla.setMatrixAt(inst, matriz);
    if (etiqueta) this.etiquetas.set(inst, etiqueta);
    return inst;
  }

  mover(instancia: number, matriz: THREE.Matrix4): void {
    this.malla.setMatrixAt(instancia, matriz);
  }

  tenir(instancia: number, color: THREE.ColorRepresentation): void {
    this.malla.setColorAt(instancia, _color.set(color));
  }

  mostrar(instancia: number, visible: boolean): void {
    this.malla.setVisibleAt(instancia, visible);
  }

  quitar(instancia: number): void {
    this.malla.deleteInstance(instancia);
    this.etiquetas.delete(instancia);
    this.instancias--;
  }
}

export class Lotes {
  readonly grupo = new THREE.Group();
  private readonly porMaterial = new Map<THREE.Material, Lote>();

  constructor() {
    this.grupo.name = 'lotes';
  }

  lote(material: THREE.Material): Lote {
    let l = this.porMaterial.get(material);
    if (!l) {
      l = new Lote(material, material.userData['sinSombra'] !== true);
      this.porMaterial.set(material, l);
      this.grupo.add(l.malla);
    }
    return l;
  }

  crear(geometria: THREE.BufferGeometry, material: THREE.Material, matriz: THREE.Matrix4, etiqueta?: Etiqueta): Ficha {
    const lote = this.lote(material);
    return { lote, instancia: lote.crear(geometria, matriz, etiqueta) };
  }

  quitar(ficha: Ficha): void {
    ficha.lote.quitar(ficha.instancia);
  }

  soltarGeometria(geometria: THREE.BufferGeometry): void {
    for (const l of this.porMaterial.values()) l.soltarGeometria(geometria);
  }

  /** Primera pieza etiquetada que toca el rayo, con su distancia. */
  bajoRayo(rayo: THREE.Raycaster): { etiqueta: Etiqueta; distancia: number; punto: THREE.Vector3 } | null {
    const toques = rayo.intersectObjects(this.grupo.children, false);
    for (const t of toques) {
      if (t.batchId === undefined) continue;
      for (const l of this.porMaterial.values()) {
        if (l.malla !== t.object) continue;
        const e = l.etiquetas.get(t.batchId);
        if (e) return { etiqueta: e, distancia: t.distance, punto: t.point };
      }
    }
    return null;
  }
}
