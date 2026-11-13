"""El mapa: qué es cada celda según el paisaje. Mismo contrato que usa el juego para dibujar.

Regla común (docs/DISENO.md §2): una celda es agua si su centro dista del eje del río menos de
anchura/2; orilla si dista menos de anchura/2 + 2. Los puntos de paisajes.yaml (río, camino) son celdas,
es decir, centros de celda. El puente manda sobre el agua y el camino sobre la orilla.
"""

from __future__ import annotations

import math
from functools import lru_cache

from .. import datos

CELDAS = 56

TIERRA, AGUA, ORILLA, PUENTE, CAMINO = "tierra", "agua", "orilla", "puente", "camino"


def _dist_segmento(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
    dx, dz = bx - ax, bz - az
    largo2 = dx * dx + dz * dz
    t = 0.0 if largo2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / largo2))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def _dist_polilinea(px: float, pz: float, puntos: list[list[float]]) -> float:
    return min(
        _dist_segmento(px, pz, a[0], a[1], b[0], b[1]) for a, b in zip(puntos, puntos[1:], strict=False)
    )


def _celdas_de_polilinea(puntos: list[list[int]]) -> set[tuple[int, int]]:
    """Celdas que pisa una polilínea, unidas por los lados (sin saltos en diagonal).

    Es el mismo algoritmo que usa el juego (juego/src/juego/cuadricula.ts): tienen que dar las mismas celdas.
    """
    celdas: set[tuple[int, int]] = set()
    for a, b in zip(puntos, puntos[1:], strict=False):
        x, z = int(a[0]), int(a[1])
        x1, z1 = int(b[0]), int(b[1])
        dx, dz = abs(x1 - x), abs(z1 - z)
        sx = 1 if x < x1 else -1
        sz = 1 if z < z1 else -1
        error = dx - dz
        celdas.add((x, z))
        while (x, z) != (x1, z1):
            # Avanza un solo eje cada vez para que la fila de celdas quede unida por los lados.
            if error > 0 or (error == 0 and dx >= dz):
                error -= 2 * dz
                x += sx
            else:
                error += 2 * dx
                z += sz
            celdas.add((x, z))
    return {(x, z) for x, z in celdas if 0 <= x < CELDAS and 0 <= z < CELDAS}


class Mapa:
    def __init__(self, clave: str):
        self.clave = clave
        p = datos.paisaje(clave)
        self.paisaje = p
        self.n = int(p.get("celdas", CELDAS))
        rio = p["rio"]
        self._rio = [[float(x), float(z)] for x, z in rio["puntos"]]
        self._media = float(rio["anchura"]) / 2
        puente = p.get("puente") or {}
        self.puente: set[tuple[int, int]] = set()
        if puente:
            px, pz = puente["celda"]
            ancho, fondo = puente["tam"]
            self.puente = {(px + i, pz + j) for i in range(ancho) for j in range(fondo)}
        self.camino_fijo: set[tuple[int, int]] = set()
        for tramo in p.get("camino", []):
            self.camino_fijo |= _celdas_de_polilinea(tramo)
        self.camino_fijo -= self.puente
        self._bosques = [tuple(b) for b in p.get("bosques", [])]
        self._rocas = [tuple(r) for r in p.get("rocas", [])]
        self._tipos: dict[tuple[int, int], str] = {}

    def dentro(self, cx: int, cz: int) -> bool:
        return 0 <= cx < self.n and 0 <= cz < self.n

    def dist_rio(self, cx: int, cz: int) -> float:
        # Los puntos del río de paisajes.yaml son celdas, o sea, el centro de esa celda (como en el juego).
        return _dist_polilinea(cx, cz, self._rio)

    def tipo(self, cx: int, cz: int) -> str:
        clave = (cx, cz)
        if clave not in self._tipos:
            if clave in self.puente:
                t = PUENTE
            else:
                d = self.dist_rio(cx, cz)
                if d < self._media:
                    t = AGUA
                elif clave in self.camino_fijo:
                    t = CAMINO
                elif d < self._media + 2:
                    t = ORILLA
                else:
                    t = TIERRA
            self._tipos[clave] = t
        return self._tipos[clave]

    def es_bosque(self, cx: int, cz: int) -> bool:
        return any(math.hypot(cx - bx, cz - bz) <= r for bx, bz, r, *_ in self._bosques)

    def bosque_cerca(self, cx: int, cz: int, radio: float = 8) -> bool:
        return any(math.hypot(cx - bx, cz - bz) <= r + radio for bx, bz, r, *_ in self._bosques)

    def roca_cerca(self, cx: int, cz: int, radio: float = 8) -> bool:
        return any(math.hypot(cx - rx, cz - rz) <= r + radio for rx, rz, r, *_ in self._rocas)

    def entradas(self) -> list[tuple[int, int]]:
        """Celdas del borde por donde entra el camino real (por ahí llegan mercaderes y colonos)."""
        borde = [c for c in self.camino_fijo if c[0] in (0, self.n - 1) or c[1] in (0, self.n - 1)]
        return sorted(borde) or [(0, self.n // 2)]


@lru_cache
def mapa(clave: str) -> Mapa:
    return Mapa(clave)


def huella(cx: int, cz: int, tam: list[int], rot: int) -> list[tuple[int, int]]:
    """Celdas que ocupa un edificio de `tam` puesto en (cx, cz) con giro `rot` (cuartos de vuelta)."""
    ancho, fondo = (tam[1], tam[0]) if rot % 2 else (tam[0], tam[1])
    return [(cx + i, cz + j) for i in range(ancho) for j in range(fondo)]
