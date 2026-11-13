"""Varias aldeas: cada paisaje, tono y dificultad funciona, y unas no pisan a otras."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from aldea import datos
from aldea.ia.simulado import MotorSimulado
from aldea.modelos import Edificio, Escena
from aldea.motor import ciclo, construccion, estado, fundacion, mapa as mapas

from .conftest import INICIO


@pytest.mark.parametrize("paisaje", ["valle", "ribera", "montana", "bosque"])
def test_cada_paisaje_tiene_rio_puente_camino_y_sitio_para_empezar(s, paisaje):
    aldea = fundacion.fundar(s, f"Aldea de {paisaje}", paisaje=paisaje, semilla=3, ahora=INICIO, bienvenida=False)
    m = mapas.mapa(paisaje)
    tipos = [m.tipo(x, z) for x in range(m.n) for z in range(m.n)]
    assert {"tierra", "agua", "orilla", "puente", "camino"} == set(tipos)
    assert len(m.entradas()) >= 2  # el camino real entra y sale
    p = datos.paisaje(paisaje)
    # El puente cruza agua de verdad y el camino llega hasta él.
    px, pz = p["puente"]["celda"]
    ancho, fondo = p["puente"]["tam"]
    sobre_agua = sum(m.dist_rio(px + i, pz + j) < m._media for i in range(ancho) for j in range(fondo))
    assert sobre_agua >= ancho * fondo * 0.4
    # Los colonos y el señor empiezan en tierra firme, y hay solar para el molino.
    for c in p["inicio"]["colonos"] + [p["inicio"]["senor"]]:
        assert m.tipo(*c) in ("tierra", "orilla")
    estado.recursos(aldea).update({"madera": 99, "piedra": 99})
    construccion.construir(s, aldea, "molino", *p["solar_molino"])
    assert len(estado.aldeanos(s, aldea)) == 4
    ciclo.adelantar_dia(s, aldea, ia=MotorSimulado(), real=INICIO)  # un día entero sin tropiezos


def test_dos_aldeas_no_se_mezclan(s):
    una = fundacion.fundar(s, "Pedrafonte", semilla=1, ahora=INICIO, bienvenida=False)
    otra = fundacion.fundar(s, "Penalba", paisaje="montana", tono="crudo", dificultad="dificil", semilla=2, ahora=INICIO, bienvenida=False)
    assert estado.recursos(una)["grano"] == 70 and estado.recursos(otra)["grano"] == 49
    construccion.construir(s, una, "casa", 26, 16)
    for _ in range(3):
        ciclo.adelantar_dia(s, una, ia=MotorSimulado(), real=INICIO)
    assert una.estado["dia"] == 4 and otra.estado["dia"] == 1
    assert len(estado.edificios(s, otra)) == 2
    assert {a.aldea_id for a in estado.aldeanos(s, otra)} == {otra.id}
    assert s.scalar(select(Escena).where(Escena.aldea_id == otra.id)) is None
    assert all(e.aldea_id == una.id for e in s.scalars(select(Edificio).where(Edificio.clave == "casa")))


def test_el_tono_cambia_la_voz(s):
    crudo = fundacion.fundar(s, "Lamas", tono="crudo", semilla=5, ahora=INICIO, bienvenida=False)
    cuento = fundacion.fundar(s, "Pedrafonte", tono="cuento", semilla=5, ahora=INICIO, bienvenida=False)
    coletillas = set(datos.cargar("tonos")["crudo"]["coletillas"])
    for aldea in (crudo, cuento):
        for _ in range(4):
            ciclo.adelantar_dia(s, aldea, ia=MotorSimulado(), real=INICIO)

    def frases(aldea):
        return [l["texto"] for e in s.scalars(select(Escena).where(Escena.aldea_id == aldea.id)) for l in e.dialogo]

    assert any(c in f for f in frases(crudo) for c in coletillas)
    assert not any(c in f for f in frases(cuento) for c in coletillas)


def test_valores_raros_al_fundar_caen_en_los_de_siempre(s):
    aldea = fundacion.fundar(s, "  ", paisaje="luna", tono="terror", dificultad="imposible", ahora=INICIO, bienvenida=False)
    assert (aldea.nombre, aldea.paisaje, aldea.tono, aldea.dificultad) == ("Pedrafonte", "valle", "cuento", "normal")
