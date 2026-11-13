"""Economía y construcción: lo material lo decide el motor."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from aldea import datos
from aldea.motor import ciclo, construccion, economia, estado, mapa as mapas, tiempo
from aldea.motor.construccion import NoSePuede

from .conftest import INICIO

OTONO = date(2026, 10, 15)
VERANO = date(2026, 7, 15)
INVIERNO = date(2027, 1, 15)


def rico(aldea, **extra):
    estado.recursos(aldea).update({"grano": 500, "madera": 500, "piedra": 500, "oro": 500, **extra})
    aldea.tocar()


def presentar(s, aldea, *claves):
    for clave in claves:
        a = estado.aldeano_por_clave(s, aldea, clave)
        a.presente = True
    s.flush()


# --- Fundación --------------------------------------------------------------------------------------

def test_fundacion_claro_choza_hoguera_y_cuatro_colonos(s, aldea):
    claves = sorted(e.clave for e in estado.edificios(s, aldea))
    assert claves == ["choza", "hoguera"]
    colonos = estado.aldeanos(s, aldea)
    assert [a.clave for a in colonos] == ["lenador", "viuda", "pastor", "escriba"]
    assert len(estado.aldeanos(s, aldea, solo_presentes=False)) == 12
    assert estado.recursos(aldea)["grano"] == 70


def test_todas_las_tablas_llevan_aldea_id():
    from aldea.modelos import Base

    for tabla in Base.metadata.tables.values():
        if tabla.name != "aldeas":
            assert "aldea_id" in tabla.columns, tabla.name


# --- Mapa y construcción ----------------------------------------------------------------------------

def test_el_mapa_tiene_rio_puente_y_camino():
    m = mapas.mapa("valle")
    tipos = {m.tipo(x, z) for x in range(56) for z in range(56)}
    assert tipos == {"tierra", "agua", "orilla", "puente", "camino"}
    assert m.tipo(34, 29) == "puente"
    assert m.tipo(0, 31) == "camino"


def test_construir_cobra_y_ocupa(s, aldea):
    antes = estado.recursos(aldea)["madera"]
    casa = construccion.construir(s, aldea, "casa", 26, 22)
    assert estado.recursos(aldea)["madera"] == antes - 16
    with pytest.raises(NoSePuede, match="ocupado"):
        construccion.construir(s, aldea, "campo", 27, 23)
    assert casa.id is not None


def test_no_se_construye_en_el_rio_ni_fuera_ni_sin_recursos(s, aldea):
    m = mapas.mapa("valle")
    agua = next((x, z) for x in range(56) for z in range(56) if m.tipo(x, z) == "agua")
    with pytest.raises(NoSePuede, match="río"):
        construccion.construir(s, aldea, "valla", *agua)
    with pytest.raises(NoSePuede, match="valle"):
        construccion.construir(s, aldea, "casa", 55, 55)
    with pytest.raises(NoSePuede, match="camino real"):
        construccion.construir(s, aldea, "valla", 0, 31)
    estado.recursos(aldea)["madera"] = 3
    with pytest.raises(NoSePuede, match="No alcanza"):
        construccion.construir(s, aldea, "casa", 26, 22)


def test_requisitos_del_catalogo(s, aldea):
    rico(aldea)
    with pytest.raises(NoSePuede, match="orilla"):
        construccion.construir(s, aldea, "molino", 10, 20)
    with pytest.raises(NoSePuede, match="Molino"):
        construccion.construir(s, aldea, "panaderia", 26, 22)
    with pytest.raises(NoSePuede, match="vecinos"):
        construccion.construir(s, aldea, "iglesia", 26, 22)
    solar = datos.paisaje("valle")["solar_molino"]
    construccion.construir(s, aldea, "molino", *solar)
    construccion.construir(s, aldea, "panaderia", 26, 22)
    construccion.construir(s, aldea, "casa_senor", 10, 20)
    with pytest.raises(NoSePuede, match="Solo puede"):
        construccion.construir(s, aldea, "casa_senor", 10, 36)


def test_derribar_devuelve_la_mitad_y_girar_respeta_el_sitio(s, aldea):
    rico(aldea)
    granero = construccion.construir(s, aldea, "granero", 26, 20)  # 3 × 4
    construccion.construir(s, aldea, "valla", 29, 20)  # justo al lado: no cabe girado
    with pytest.raises(NoSePuede):
        construccion.girar(s, aldea, granero.id)
    madera = estado.recursos(aldea)["madera"]
    devuelto = construccion.derribar(s, aldea, granero.id)
    assert devuelto == {"madera": 9, "piedra": 2}
    assert estado.recursos(aldea)["madera"] == madera + 9
    campo = construccion.construir(s, aldea, "campo", 26, 21)
    assert construccion.girar(s, aldea, campo.id).rot == 1


# --- Trabajo y producción ---------------------------------------------------------------------------

def test_cada_uno_a_su_oficio_y_los_huecos_con_quien_quede(s, aldea):
    rico(aldea)
    cabana = construccion.construir(s, aldea, "cabana_lenador", 26, 20)
    campo = construccion.construir(s, aldea, "campo", 10, 20)
    cantera = construccion.construir(s, aldea, "cantera", 10, 36)
    economia.asignar_trabajos(s, aldea)
    por_clave = {a.clave: a for a in estado.aldeanos(s, aldea)}
    assert por_clave["lenador"].trabajo_id == cabana.id
    assert por_clave["viuda"].trabajo_id == campo.id
    # La cantera no tiene a nadie del oficio: la cubre uno de los que quedan libres.
    assert sum(1 for a in por_clave.values() if a.trabajo_id == cantera.id) == 1


def test_el_campo_rinde_segun_la_estacion(s, aldea):
    construccion.construir(s, aldea, "campo", 10, 20)
    economia.asignar_trabajos(s, aldea)
    cosechas = {}
    for nombre, fecha in (("verano", VERANO), ("otono", OTONO), ("invierno", INVIERNO)):
        estado.recursos(aldea)["grano"] = 0
        cosechas[nombre] = economia.producir(s, aldea, fecha, "despejado")["producido"]["grano"]
    assert cosechas["verano"] > cosechas["otono"] > cosechas["invierno"] > 0
    assert cosechas["verano"] == pytest.approx(cosechas["otono"] * 1.5, rel=0.01)


def test_quien_no_es_del_oficio_rinde_menos(s, aldea):
    construccion.construir(s, aldea, "campo", 10, 20)
    economia.asignar_trabajos(s, aldea)
    con_oficio = economia.producir(s, aldea, OTONO, "despejado")["producido"]["grano"]
    estado.aldeano_por_clave(s, aldea, "viuda").presente = False
    economia.asignar_trabajos(s, aldea)
    sin_oficio = economia.producir(s, aldea, OTONO, "despejado")["producido"]["grano"]
    assert sin_oficio == pytest.approx(con_oficio * 0.6, rel=0.02)


def test_cadena_campo_molino_panaderia(s, aldea):
    rico(aldea, grano=100, harina=0, pan=0)
    presentar(s, aldea, "molinero", "panadera")
    construccion.construir(s, aldea, "molino", *datos.paisaje("valle")["solar_molino"])
    construccion.construir(s, aldea, "panaderia", 26, 22)
    economia.asignar_trabajos(s, aldea)
    resultado = economia.producir(s, aldea, OTONO, "despejado")
    r = estado.recursos(aldea)
    assert resultado["producido"]["harina"] > 0 and resultado["producido"]["pan"] > 0
    assert r["grano"] < 100  # el molino se comió grano
    assert r["pan"] > 0
    # El pan cunde más que el grano crudo: con 8 de grano salen más de 8 raciones.
    assert resultado["producido"]["pan"] / resultado["gastado"]["harina"] > 1


def test_sin_grano_el_molino_no_muele(s, aldea):
    rico(aldea, grano=0, harina=0)
    presentar(s, aldea, "molinero")
    construccion.construir(s, aldea, "molino", *datos.paisaje("valle")["solar_molino"])
    economia.asignar_trabajos(s, aldea)
    assert "harina" not in economia.producir(s, aldea, OTONO, "despejado")["producido"]


# --- Comida, hambre y población ---------------------------------------------------------------------

def test_se_come_pan_antes_que_grano(s, aldea):
    estado.recursos(aldea).update({"pan": 3, "grano": 30})
    comida = economia.comer(s, aldea, OTONO)
    assert comida["pan"] == 3
    assert comida["grano"] == pytest.approx(1.5)  # la cuarta ración, en grano
    assert comida["hambrientos"] == []


def test_sin_comida_hay_hambre_y_pasa_primero_el_mas_pobre(s, aldea):
    estado.recursos(aldea).update({"pan": 2, "grano": 0, "harina": 0})
    comida = economia.comer(s, aldea, OTONO)
    hambrientos = {a.clave for a in estado.aldeanos(s, aldea) if a.id in comida["hambrientos"]}
    assert hambrientos == {"pastor", "lenador"}  # las dos bolsas más flacas
    assert aldea.estado["hambre_dias"] == 1


def test_el_hambre_larga_hace_que_alguien_se_marche_pero_no_todos(s, aldea):
    estado.recursos(aldea).update({"pan": 0, "grano": 0, "harina": 0})
    for dia in range(8):
        aldea.estado["dia"] = dia + 1
        economia.cierre(s, aldea, OTONO + timedelta(days=dia), "despejado")
    quedan = estado.aldeanos(s, aldea)
    assert 2 <= len(quedan) < 4  # se van, pero de uno en uno y nunca todos: cuesta perder


def test_llegan_vecinos_cuando_hay_casa_y_comida(s, aldea):
    rico(aldea)
    assert economia.llegadas(s, aldea) == []  # 4 colonos y 2 plazas: no cabe nadie
    construccion.construir(s, aldea, "casa", 26, 22)
    construccion.construir(s, aldea, "casa", 26, 18)
    nuevos = economia.llegadas(s, aldea)
    assert [a.clave for a in nuevos] == ["mozo"]  # el siguiente del reparto
    estado.recursos(aldea).update({"grano": 0, "pan": 0})
    assert economia.llegadas(s, aldea) == []  # sin comida no viene nadie


def test_impuestos_dan_oro_y_cuestan_opinion(s, aldea):
    def un_dia(nivel):
        for a in estado.aldeanos(s, aldea):
            a.opinion_senor, a.dinero = 10, 10
        aldea.estado["impuestos"] = nivel
        estado.recursos(aldea).update({"oro": 0, "grano": 200, "pan": 50})
        economia.cierre(s, aldea, OTONO, "despejado")
        gente = estado.aldeanos(s, aldea)
        return estado.recursos(aldea)["oro"], sum(a.opinion_senor for a in gente) / len(gente)

    oro_leve, opinion_leve = un_dia(1)
    oro_abusivo, opinion_abusivo = un_dia(4)
    assert oro_abusivo > oro_leve
    assert opinion_abusivo < opinion_leve


def test_en_invierno_se_quema_lena_y_sin_granero_hay_merma(s, aldea):
    estado.recursos(aldea).update({"madera": 10, "grano": 160})
    resultado = economia.lena_y_merma(s, aldea, INVIERNO)
    assert resultado["lena"] == 1 and not resultado["frio"]
    assert resultado["merma"] == pytest.approx(3.0)
    estado.recursos(aldea)["madera"] = 0
    assert economia.lena_y_merma(s, aldea, INVIERNO)["frio"]
    rico(aldea, grano=160)
    construccion.construir(s, aldea, "granero", 26, 20)
    assert economia.lena_y_merma(s, aldea, OTONO)["merma"] == 0


# --- El reloj ---------------------------------------------------------------------------------------

def test_avanzar_procesa_horas_y_cierra_el_dia(s, aldea):
    assert aldea.estado["ultima_hora"] == "2026-10-15T10"
    grano = estado.recursos(aldea)["grano"]
    resumen = ciclo.avanzar(s, aldea, INICIO.replace(hour=22))
    assert resumen == {"horas": 12, "dias": 0, "balances": []}
    resumen = ciclo.avanzar(s, aldea, INICIO.replace(hour=23, minute=30))
    assert resumen["dias"] == 1
    assert estado.recursos(aldea)["grano"] < grano  # han cenado
    assert aldea.estado["ultimo_balance"]["estacion"] == "otono"
    assert ciclo.avanzar(s, aldea, INICIO.replace(hour=23, minute=45))["horas"] == 0


def test_adelantar_dia_suma_desfase_y_procesa_24_horas(s, aldea):
    resumen = ciclo.adelantar_dia(s, aldea, real=INICIO)
    assert resumen["horas"] == 24 and resumen["dias"] == 1
    assert aldea.estado["desfase_dias"] == 1
    assert aldea.estado["dia"] == 2
    assert tiempo.ahora_juego(aldea, INICIO) == INICIO + timedelta(days=1)


def test_un_apagon_largo_se_recupera_sin_revivirlo_todo(s, aldea):
    rico(aldea)
    resumen = ciclo.avanzar(s, aldea, INICIO + timedelta(days=90))
    assert resumen["dias"] == ciclo.MAX_DIAS_ATRASADOS
    assert aldea.estado["dia"] == 91


def test_una_aldea_bien_llevada_aguanta_un_mes(s, aldea):
    """Con un campo, una cabaña y casas, treinta días de otoño sin hambre: cuesta perder."""
    construccion.construir(s, aldea, "campo", 10, 20)
    construccion.construir(s, aldea, "cabana_lenador", 26, 20)
    construccion.construir(s, aldea, "casa", 26, 16)
    for _ in range(30):
        ciclo.adelantar_dia(s, aldea, real=INICIO)
    assert len(estado.aldeanos(s, aldea)) >= 4
    assert aldea.estado["hambre_dias"] == 0
    assert not aldea.estado["perdida"]
