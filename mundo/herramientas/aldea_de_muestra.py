"""Funda una aldea de muestra ya crecida, para verla sin esperar días (y para las capturas).

    cd mundo && .venv/bin/python herramientas/aldea_de_muestra.py [días] [nombre]

Copia la composición del «Escaparate» del juego (juego/src/vistas/escaparate.ts), la levanta en una aldea
nueva y deja pasar los días con el motor de IA simulado: llegan los vecinos, corren los rumores, hay
consejo, cartas, mercaderes y crónicas. No toca las demás aldeas.

Conviene lanzarlo con el servidor del mundo parado (`./arrancar.sh parar`) para que su reloj no pise
a este guion mientras trabaja. Usa la base de datos de ALDEA_BD_URL (.env).
"""

from __future__ import annotations

import re
import sys

from aldea import bd, config, datos
from aldea.ia.simulado import MotorSimulado
from aldea.modelos import Edificio
from aldea.motor import ciclo, clima, economia, estado, fundacion, mapa as mapas


def composicion() -> list[tuple[str, int, int, int]]:
    """Lee EDIFICIOS, TRAMOS y ADORNOS del Escaparate del juego."""
    texto = (config.RAIZ / "juego" / "src" / "vistas" / "escaparate.ts").read_text(encoding="utf-8")

    def bloque(nombre: str) -> str:
        inicio = texto.index(f"const {nombre}")
        return texto[inicio:texto.index("];", inicio)]

    piezas: list[tuple[str, int, int, int]] = []
    for nombre in ("EDIFICIOS", "ADORNOS"):
        for clave, cx, cz, rot in re.findall(r"\['(\w+)',\s*(\d+),\s*(\d+)(?:,\s*(\d+))?\]", bloque(nombre)):
            piezas.append((clave, int(cx), int(cz), int(rot or 0)))
    for clave, x0, z0, x1, z1 in re.findall(r"\['(\w+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]", bloque("TRAMOS")):
        for x in range(min(int(x0), int(x1)), max(int(x0), int(x1)) + 1):
            for z in range(min(int(z0), int(z1)), max(int(z0), int(z1)) + 1):
                piezas.append((clave, x, z, 0))
    return piezas


def main() -> None:
    dias = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    nombre = sys.argv[2] if len(sys.argv) > 2 else "Vilar da Mostra"
    config.cargar_env()
    clima.SIN_RED = True  # los días adelantados usan clima simulado; no hace falta la red
    catalogo = datos.catalogo()
    with bd.sesion() as s:
        aldea = fundacion.fundar(s, nombre, paisaje="valle", tono="cuento", dificultad="normal")
        m = mapas.mapa(aldea.paisaje)
        for e in estado.edificios(s, aldea):  # fuera la choza y la hoguera del principio: la plaza va en otro sitio
            s.delete(e)
        s.flush()
        ocupadas: set[tuple[int, int]] = set()
        solar = datos.paisaje("valle")["solar_molino"]
        puestos = 0
        for clave, cx, cz, rot in [*composicion(), ("molino", solar[0], solar[1], 0), ("choza", 6, 26, 3)]:
            if clave not in catalogo:
                continue
            celdas = mapas.huella(cx, cz, catalogo[clave]["tam"], rot)
            if any(c in ocupadas or not m.dentro(*c) or m.tipo(*c) in ("agua", "puente") for c in celdas):
                continue
            ocupadas.update(celdas)
            s.add(Edificio(aldea_id=aldea.id, clave=clave, cx=cx, cz=cz, rot=rot, dia=1))
            puestos += 1
        estado.recursos(aldea).update({"grano": 420, "madera": 260, "piedra": 150, "oro": 80, "harina": 30, "pan": 80})
        aldea.tocar()
        s.flush()
        economia.asignar_casas(s, aldea)
        economia.asignar_trabajos(s, aldea)
        motor = MotorSimulado()
        for _ in range(dias):
            ciclo.adelantar_dia(s, aldea, ia=motor)
        gente = estado.aldeanos(s, aldea)
        print(f"Aldea de muestra «{aldea.nombre}» (id {aldea.id}): {puestos} edificios, {len(gente)} vecinos, día {aldea.estado['dia']}.")
        print("Recursos:", {k: round(v) for k, v in estado.recursos(aldea).items()})
        estado.vaciar_eventos(aldea.id)


if __name__ == "__main__":
    main()
