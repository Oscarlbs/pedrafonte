"""Rutinas diarias: dónde está cada vecino a cada hora.

El motor lo calcula de forma determinista (misma aldea, día y hora → mismo sitio), así el juego puede
pintar a las figuritas andando y el motor sabe quién coincide con quién.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from sqlalchemy.orm import Session

from .. import datos
from ..modelos import Aldea, Aldeano, Edificio
from . import construccion, estado, mapa as mapas, tiempo

DORMIR, CASA, TRABAJO, PLAZA, TABERNA, IGLESIA, PASEO = "dormir", "casa", "trabajo", "plaza", "taberna", "iglesia", "paseo"

NOMBRE_ACTIVIDAD = {
    DORMIR: "durmiendo", CASA: "en casa", TRABAJO: "trabajando", PLAZA: "en la plaza",
    TABERNA: "en la taberna", IGLESIA: "en la iglesia", PASEO: "dando una vuelta",
}


@dataclass
class Sitio:
    actividad: str
    cx: int
    cz: int
    nombre: str
    edificio_id: int | None = None

    def clave_encuentro(self) -> str:
        """Los que comparten esta clave están juntos y pueden tener escena."""
        return f"e{self.edificio_id}" if self.edificio_id else f"c{self.cx // 3}-{self.cz // 3}"


def con_articulo(nombre: str) -> str:
    """«Taberna» → «la taberna», «Pozo» → «el pozo» (para decir «en la taberna»)."""
    primera = nombre.split()[0].lower()
    femenino = primera.endswith(("a", "ía", "ión")) or primera in ("torre",)
    return f"{'la' if femenino else 'el'} {nombre[:1].lower()}{nombre[1:]}"


class Lugares:
    """Foto de los edificios de la aldea para resolver rutinas sin repetir consultas."""

    def __init__(self, s: Session, aldea: Aldea):
        self.s, self.aldea = s, aldea
        self.catalogo = datos.catalogo()
        self.mapa = mapas.mapa(aldea.paisaje)
        self.edificios = estado.edificios(s, aldea)
        self.por_id = {e.id: e for e in self.edificios}
        self.por_clave: dict[str, list[Edificio]] = {}
        for e in self.edificios:
            self.por_clave.setdefault(e.clave, []).append(e)
        self._ocupadas = construccion.ocupadas(s, aldea)
        self._puertas: dict[int, tuple[int, int]] = {}
        centro = datos.paisaje(aldea.paisaje)["claro"]["centro"]
        self.claro = (int(centro[0]), int(centro[1]))

    def nombre(self, e: Edificio) -> str:
        return con_articulo(self.catalogo.get(e.clave, {}).get("nombre", e.clave))

    def puerta(self, e: Edificio) -> tuple[int, int]:
        if e.id not in self._puertas:
            self._puertas[e.id] = self._buscar_puerta(e)
        return self._puertas[e.id]

    def _buscar_puerta(self, e: Edificio) -> tuple[int, int]:
        tam = self.catalogo.get(e.clave, {"tam": [1, 1]})["tam"]
        ancho, fondo = (tam[1], tam[0]) if e.rot % 2 else (tam[0], tam[1])
        frentes = {
            0: [(e.cx + i, e.cz + fondo) for i in range(ancho)],
            1: [(e.cx - 1, e.cz + j) for j in range(fondo)],
            2: [(e.cx + i, e.cz - 1) for i in range(ancho)],
            3: [(e.cx + ancho, e.cz + j) for j in range(fondo)],
        }
        medio = (e.cx + (ancho - 1) / 2, e.cz + (fondo - 1) / 2)
        for k in range(4):
            lado = sorted(frentes[(e.rot + k) % 4], key=lambda c: abs(c[0] - medio[0]) + abs(c[1] - medio[1]))
            for c in lado:
                if self.libre(c):
                    return c
        return construccion.centro(e)

    def libre(self, c: tuple[int, int]) -> bool:
        if not self.mapa.dentro(*c) or self.mapa.tipo(*c) == mapas.AGUA:
            return False
        ocupante = self._ocupadas.get(c)
        return ocupante is None or bool(self.catalogo.get(ocupante.clave, {}).get("efecto", {}).get("camino"))

    def plaza(self) -> tuple[tuple[int, int], str, int | None]:
        """El sitio donde se junta la gente: hoguera, pozo o mercado; si no hay nada, el claro."""
        for clave in ("hoguera", "pozo", "mercado"):
            if self.por_clave.get(clave):
                e = self.por_clave[clave][0]
                return self.puerta(e), self.nombre(e), e.id
        return self.claro, "el claro", None


def actividad(a: Aldeano, hora: int, dia_semana: int, lugares: Lugares, azar: random.Random) -> str:
    """Qué hace este vecino a esta hora."""
    hay_taberna = bool(lugares.por_clave.get("taberna"))
    hay_iglesia = bool(lugares.por_clave.get("iglesia"))
    rasgos = set(a.rasgos or [])
    trabaja = a.trabajo_id in lugares.por_id
    if hora >= 22 or hora < 6:
        return DORMIR
    if hora == 6:
        return CASA
    if a.oficio == "tabernero" and hay_taberna and trabaja and 11 <= hora <= 21:
        return TRABAJO
    if hay_iglesia and dia_semana == 6 and hora in (10, 11):  # domingo: misa
        return IGLESIA if a.oficio == "cura" or azar.random() < (0.9 if "devoto" in rasgos else 0.6) else PLAZA
    if hora == 7:
        return PLAZA if azar.random() < 0.6 else CASA
    if 8 <= hora <= 12 or 14 <= hora <= 18:
        if trabaja:
            return TRABAJO
        return PLAZA if azar.random() < 0.5 else PASEO
    if hora == 13:
        return PLAZA if azar.random() < 0.7 else CASA
    # De 19 a 21: ocio.
    tirada = azar.random()
    if a.oficio == "cura" and hay_iglesia and tirada < 0.6:
        return IGLESIA
    if hay_taberna and tirada < (0.35 if "devoto" in rasgos or "callado" in rasgos else 0.7):
        return TABERNA
    if tirada < 0.85:
        return PLAZA
    return CASA


def sitio(aldea: Aldea, a: Aldeano, hora: int, dia: int, lugares: Lugares) -> Sitio:
    """Dónde está este vecino a esta hora de este día."""
    dia_semana = tiempo.fecha_de_dia(aldea, dia).weekday()
    azar = random.Random(f"rutina|{aldea.semilla}|{dia}|{hora}|{a.id}")
    que = actividad(a, hora, dia_semana, lugares, azar)
    plaza, nombre_plaza, plaza_id = lugares.plaza()

    if que in (DORMIR, CASA):
        casa = lugares.por_id.get(a.casa_id) if a.casa_id else None
        if casa is not None:
            return Sitio(que, *lugares.puerta(casa), lugares.nombre(casa), casa.id)
        # Sin techo: duerme al raso junto a la lumbre.
        return Sitio(que, *plaza, nombre_plaza, plaza_id)
    if que == TRABAJO:
        e = lugares.por_id[a.trabajo_id]
        ficha = lugares.catalogo.get(e.clave, {})
        if ficha.get("efecto", {}).get("estacional"):
            # En el campo se trabaja dentro, cada hora en un surco.
            celdas = mapas.huella(e.cx, e.cz, ficha["tam"], e.rot)
            return Sitio(que, *azar.choice(celdas), lugares.nombre(e), e.id)
        return Sitio(que, *lugares.puerta(e), lugares.nombre(e), e.id)
    if que == TABERNA:
        e = lugares.por_clave["taberna"][0]
        return Sitio(que, *lugares.puerta(e), lugares.nombre(e), e.id)
    if que == IGLESIA:
        e = lugares.por_clave["iglesia"][0]
        return Sitio(que, *lugares.puerta(e), lugares.nombre(e), e.id)
    if que == PASEO:
        for _ in range(12):
            c = (lugares.claro[0] + azar.randint(-7, 7), lugares.claro[1] + azar.randint(-7, 7))
            if lugares.libre(c):
                return Sitio(que, *c, "los alrededores")
    return Sitio(PLAZA, *plaza, nombre_plaza, plaza_id)


def donde_estan(s: Session, aldea: Aldea, hora: int | None = None, dia: int | None = None) -> dict[int, Sitio]:
    """Sitio de cada vecino presente a la hora dada (por defecto, la hora actual de la aldea)."""
    hora = aldea.estado.get("hora", 12) if hora is None else hora
    dia = aldea.estado.get("dia", 1) if dia is None else dia
    lugares = Lugares(s, aldea)
    return {a.id: sitio(aldea, a, hora, dia, lugares) for a in estado.aldeanos(s, aldea)}


def grupos(sitios: dict[int, Sitio]) -> list[list[int]]:
    """Vecinos que coinciden en un mismo sitio (de 2 en adelante), sin contar a los que duermen."""
    juntos: dict[str, list[int]] = {}
    for aldeano_id, lugar in sitios.items():
        if lugar.actividad == DORMIR:
            continue
        juntos.setdefault(lugar.clave_encuentro(), []).append(aldeano_id)
    return [sorted(ids) for ids in juntos.values() if len(ids) >= 2]
