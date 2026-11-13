// Sistema de sonido de Pedrafonte: ambiente, música y efectos, SIN archivos de audio.
//
// Todo se genera al vuelo con Web Audio (ruido filtrado para viento, río y lluvia; osciladores para
// pájaros, grillos, campana y demás). Si algún día hay grabaciones de verdad, basta con dejarlas en
// juego/public/audio/ junto a un manifiesto.json (ver docs/AUDIO.md): cada nombre que aparezca ahí
// sustituye a su versión generada, sin tocar el resto del juego.
//
// El navegador no deja sonar nada hasta que el jugador pulsa algo: por eso empieza apagado y se
// enciende con el botón «Sonido».

export type Canal = 'ambiente' | 'musica' | 'efectos';
export type Efecto = 'obra' | 'derribo' | 'sello' | 'monedas' | 'campana' | 'pergamino' | 'no' | 'voz';

interface Ambiente {
  clima: string;
  noche: boolean;
  vecinos: number;
}

type Manifiesto = Partial<Record<string, string>>;

const VOLUMEN: Record<Canal, number> = { ambiente: 0.5, musica: 0.35, efectos: 0.6 };

export class Sonido {
  private ctx: AudioContext | null = null;
  private maestro: GainNode | null = null;
  private readonly canales = new Map<Canal, GainNode>();
  private readonly capas = new Map<string, GainNode>();
  private readonly grabaciones = new Map<string, AudioBuffer>();
  private manifiesto: Manifiesto = {};
  private relojVida = 0;
  private musicaActual: AudioBufferSourceNode | null = null;
  private ambiente: Ambiente = { clima: 'nubes', noche: false, vecinos: 4 };
  activo = false;

  /** Enciende o apaga el sonido. Devuelve cómo queda. Hay que llamarlo desde un clic del jugador. */
  alternar(): boolean {
    if (this.activo) this.silenciar();
    else this.activar();
    return this.activo;
  }

  activar(): void {
    if (!this.ctx) this.montar();
    void this.ctx?.resume();
    this.activo = true;
    this.maestro?.gain.setTargetAtTime(1, this.ctx!.currentTime, 0.4);
    this.aplicarAmbiente();
    window.clearInterval(this.relojVida);
    this.relojVida = window.setInterval(() => this.vida(), 2600);
    void this.musica('tema');
  }

  silenciar(): void {
    this.activo = false;
    if (this.ctx && this.maestro) this.maestro.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    window.clearInterval(this.relojVida);
  }

  parar(): void {
    this.silenciar();
    this.musicaActual?.stop();
    this.musicaActual = null;
  }

  volumen(canal: Canal, valor: number): void {
    VOLUMEN[canal] = Math.max(0, Math.min(1, valor));
    const nodo = this.canales.get(canal);
    if (nodo && this.ctx) nodo.gain.setTargetAtTime(VOLUMEN[canal], this.ctx.currentTime, 0.1);
  }

  /** El juego avisa de cómo está el valle; las capas de ambiente se ajustan solas. */
  ambientar(ambiente: Ambiente): void {
    this.ambiente = ambiente;
    if (this.activo) this.aplicarAmbiente();
  }

  // ───────────── montaje ─────────────

  private montar(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.maestro = ctx.createGain();
    this.maestro.gain.value = 0;
    this.maestro.connect(ctx.destination);
    for (const canal of ['ambiente', 'musica', 'efectos'] as Canal[]) {
      const nodo = ctx.createGain();
      nodo.gain.value = VOLUMEN[canal];
      nodo.connect(this.maestro);
      this.canales.set(canal, nodo);
    }
    // Capas continuas de ambiente: ruido filtrado.
    this.capaRuido('viento', 'lowpass', 380, 0.7);
    this.capaRuido('rio', 'bandpass', 1100, 0.9);
    this.capaRuido('lluvia', 'highpass', 2200, 0.5);
    void this.cargarManifiesto();
  }

  private ruido(segundos = 2): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * segundos), ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let anterior = 0;
    for (let i = 0; i < datos.length; i++) {
      // Ruido algo «rosa»: más grave y menos áspero que el blanco.
      anterior = 0.96 * anterior + 0.04 * (Math.random() * 2 - 1);
      datos[i] = anterior * 6 + (Math.random() * 2 - 1) * 0.15;
    }
    return buffer;
  }

  private capaRuido(nombre: string, tipo: BiquadFilterType, frecuencia: number, q: number): void {
    const ctx = this.ctx!;
    const fuente = ctx.createBufferSource();
    fuente.buffer = this.ruido(3);
    fuente.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = tipo;
    filtro.frequency.value = frecuencia;
    filtro.Q.value = q;
    const ganancia = ctx.createGain();
    ganancia.gain.value = 0;
    fuente.connect(filtro).connect(ganancia).connect(this.canales.get('ambiente')!);
    fuente.start();
    this.capas.set(nombre, ganancia);
  }

  private nivel(nombre: string, valor: number): void {
    const capa = this.capas.get(nombre);
    if (capa && this.ctx) capa.gain.setTargetAtTime(valor, this.ctx.currentTime, 1.5);
  }

  private aplicarAmbiente(): void {
    const { clima } = this.ambiente;
    this.nivel('viento', clima === 'tormenta' ? 0.5 : clima === 'nieve' || clima === 'niebla' ? 0.12 : 0.22);
    this.nivel('rio', 0.1);
    this.nivel('lluvia', clima === 'lluvia' ? 0.22 : clima === 'tormenta' ? 0.38 : 0);
  }

  /** Vida suelta: pájaros de día, grillos de noche, algún trueno si hay tormenta. */
  private vida(): void {
    if (!this.activo || !this.ctx || document.hidden) return;
    const { clima, noche } = this.ambiente;
    const tirada = Math.random();
    if (clima === 'tormenta' && tirada < 0.12) this.trueno();
    else if (noche && tirada < 0.7) this.grillo();
    else if (!noche && clima !== 'lluvia' && clima !== 'tormenta' && clima !== 'nieve' && tirada < 0.45) this.pajaro();
  }

  // ───────────── sonidos sueltos (generados) ─────────────

  private tono(frecuencia: number, duracion: number, volumen: number, canal: Canal, tipo: OscillatorType = 'sine', hasta?: number, cuando = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + cuando;
    const osc = ctx.createOscillator();
    osc.type = tipo;
    osc.frequency.setValueAtTime(frecuencia, t);
    if (hasta) osc.frequency.exponentialRampToValueAtTime(hasta, t + duracion);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volumen, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    osc.connect(g).connect(this.canales.get(canal)!);
    osc.start(t);
    osc.stop(t + duracion + 0.05);
  }

  private golpe(frecuencia: number, duracion: number, volumen: number, cuando = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + cuando;
    const fuente = ctx.createBufferSource();
    fuente.buffer = this.ruido(0.4);
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = frecuencia;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volumen, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    fuente.connect(filtro).connect(g).connect(this.canales.get('efectos')!);
    fuente.start(t);
    fuente.stop(t + duracion + 0.05);
  }

  private pajaro(): void {
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tono(base, 0.09, 0.05, 'ambiente', 'sine', base * (1.2 + Math.random() * 0.4), i * 0.13);
  }

  private grillo(): void {
    for (let i = 0; i < 6; i++) this.tono(4300, 0.035, 0.018, 'ambiente', 'square', undefined, i * 0.06);
  }

  private trueno(): void {
    this.golpe(90, 2.2, 0.9);
    this.golpe(60, 3.0, 0.6, 0.35);
  }

  /** Un efecto corto de la interfaz. Si hay grabación con ese nombre en el manifiesto, suena esa. */
  efecto(nombre: Efecto): void {
    if (!this.activo || !this.ctx) return;
    if (this.reproducir(`efecto.${nombre}`, 'efectos')) return;
    switch (nombre) {
      case 'obra':
        this.golpe(420, 0.12, 0.7);
        this.golpe(380, 0.12, 0.6, 0.18);
        this.golpe(460, 0.14, 0.7, 0.36);
        break;
      case 'derribo':
        this.golpe(140, 0.5, 1.0);
        this.golpe(900, 0.25, 0.3, 0.08);
        break;
      case 'sello':
        this.golpe(180, 0.18, 0.9);
        break;
      case 'monedas':
        this.tono(2400, 0.12, 0.12, 'efectos', 'triangle');
        this.tono(3100, 0.14, 0.1, 'efectos', 'triangle', undefined, 0.07);
        break;
      case 'campana':
        this.tono(660, 2.2, 0.22, 'efectos');
        this.tono(1320, 1.4, 0.08, 'efectos');
        this.tono(1975, 0.9, 0.04, 'efectos');
        break;
      case 'pergamino':
        this.golpe(2600, 0.35, 0.25);
        this.golpe(1800, 0.3, 0.2, 0.12);
        break;
      case 'no':
        this.tono(150, 0.22, 0.14, 'efectos', 'sawtooth', 110);
        break;
      case 'voz':
        this.tono(300 + Math.random() * 160, 0.07, 0.035, 'efectos', 'triangle');
        this.tono(340 + Math.random() * 160, 0.07, 0.03, 'efectos', 'triangle', undefined, 0.09);
        break;
    }
  }

  // ───────────── grabaciones (si algún día las hay) ─────────────

  private async cargarManifiesto(): Promise<void> {
    try {
      const respuesta = await fetch('/audio/manifiesto.json');
      if (!respuesta.ok || !respuesta.headers.get('content-type')?.includes('json')) return;
      this.manifiesto = (await respuesta.json()) as Manifiesto;
      for (const [nombre, ruta] of Object.entries(this.manifiesto)) {
        if (!ruta || !this.ctx) continue;
        const datos = await (await fetch(`/audio/${ruta}`)).arrayBuffer();
        this.grabaciones.set(nombre, await this.ctx.decodeAudioData(datos));
      }
      if (this.activo) void this.musica('tema');
    } catch {
      /* sin manifiesto o sin archivos: se queda todo generado, que es lo previsto */
    }
  }

  private reproducir(nombre: string, canal: Canal, bucle = false): AudioBufferSourceNode | null {
    const grabacion = this.grabaciones.get(nombre);
    if (!grabacion || !this.ctx) return null;
    const fuente = this.ctx.createBufferSource();
    fuente.buffer = grabacion;
    fuente.loop = bucle;
    fuente.connect(this.canales.get(canal)!);
    fuente.start();
    return fuente;
  }

  /** Música suave de fondo. Solo suena si hay grabación «musica.<pista>» en el manifiesto. */
  async musica(pista: string): Promise<void> {
    this.musicaActual?.stop();
    this.musicaActual = this.reproducir(`musica.${pista}`, 'musica', true);
  }
}
