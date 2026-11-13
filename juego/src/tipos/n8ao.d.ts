// Tipos mínimos de n8ao (el paquete no los trae).
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export interface ConfiguracionN8AO {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    renderMode: number;
    transparencyAware: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: ConfiguracionN8AO;
    setQualityMode(modo: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(ancho: number, alto: number): void;
  }
}
