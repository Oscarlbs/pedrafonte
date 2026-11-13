// Vista «Inicio»: como empieza la partida. Un claro vacío, una choza, una hoguera, los cuatro
// colonos y el señor, en las celdas que marca paisajes.yaml → inicio. Vale para cualquier paisaje.
import type { Vista } from './vista';
import { colocador } from './vista';

const COLONOS = [
  { id: 'colono-lenador', nombre: 'Xan do Machado', oficio: 'lenador', frase: '¡Leña hay para tres inviernos, señor!' },
  { id: 'colono-viuda', nombre: 'Dona Aldara', oficio: 'viuda', frase: 'Esta tierra es buena. La gente, ya se verá.' },
  { id: 'colono-pastor', nombre: 'Brais o Pastor', oficio: 'pastor', frase: 'Las ovejas vienen de camino. Creo.' },
  { id: 'colono-escriba', nombre: 'Frei Lopo', oficio: 'escriba', frase: 'Apuntado queda: hoy se fundó Pedrafonte.' },
];

export const vistaInicio: Vista = {
  clave: 'inicio',
  nombre: 'Inicio',
  montar(mundo) {
    mundo.vaciar();
    const ini = mundo.datosPaisaje().inicio;
    const poner = colocador(mundo, 'inicio');
    poner('choza', ini.choza[0], ini.choza[1], 0);
    poner('hoguera', ini.hoguera[0], ini.hoguera[1], 0);
    // La hoguera ocupa 2 × 2 celdas desde su esquina: todos miran a su centro.
    const fuego: [number, number] = [ini.hoguera[0] + 0.5, ini.hoguera[1] + 0.5];
    COLONOS.forEach((c, i) => {
      const celda = ini.colonos[i % ini.colonos.length];
      mundo.ponerFigura({ id: c.id, nombre: c.nombre, oficio: c.oficio });
      mundo.colocarFigura(c.id, celda[0], celda[1]);
      mundo.mirarFigura(c.id, fuego[0], fuego[1]);
    });
    mundo.ponerFigura({ id: 'senor', nombre: 'El señor', oficio: 'senor', esSenor: true });
    mundo.colocarFigura('senor', ini.senor[0], ini.senor[1]);
    mundo.mirarFigura('senor', fuego[0], fuego[1]);

    // De cuando en cuando un colono dice algo, para que se vean los bocadillos.
    let turno = 0;
    const hablar = () => {
      const c = COLONOS[turno++ % COLONOS.length];
      mundo.decir(c.id, c.frase, 5);
    };
    const primero = window.setTimeout(hablar, 6000);
    const reloj = window.setInterval(hablar, 9000);
    return () => {
      window.clearTimeout(primero);
      window.clearInterval(reloj);
    };
  },
  camara(mundo) {
    const ini = mundo.datosPaisaje().inicio;
    const { x, z } = mundo.celdaAMundo(ini.hoguera[0] - 0.5, ini.hoguera[1] - 0.5);
    return { x, z, azimut: -28, elevacion: 31, distancia: 46 };
  },
};
