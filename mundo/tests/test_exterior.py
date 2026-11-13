"""Mundo exterior: fiestas en su fecha, mercaderes, cartas de los vecinos y amenazas."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from aldea import datos
from aldea.ia.simulado import MotorSimulado
from aldea.modelos import Mensaje, Suceso, Visitante
from aldea.motor import ciclo, construccion, efectos, estado, exterior, gobierno
from aldea.motor.construccion import NoSePuede

from .conftest import INICIO


def todos_presentes(s, aldea):
    for a in estado.aldeanos(s, aldea, solo_presentes=False):
        a.presente = True
    s.flush()
    return {a.clave: a for a in estado.aldeanos(s, aldea)}


def rico(aldea):
    estado.recursos(aldea).update({"grano": 500, "madera": 500, "piedra": 500, "oro": 500})


# --- Fiestas ----------------------------------------------------------------------------------------

def test_pascua_y_fiestas_moviles():
    assert exterior.pascua(2026) == date(2026, 4, 5)
    assert exterior.pascua(2027) == date(2027, 3, 28)
    assert [f["clave"] for f in exterior.fiestas_del_dia(date(2027, 3, 28))] == ["pascua"]
    assert [f["clave"] for f in exterior.fiestas_del_dia(date(2027, 2, 9))] == ["entroido"]  # 47 días antes
    assert [f["clave"] for f in exterior.fiestas_del_dia(date(2026, 12, 24))] == ["nochebuena"]
    assert exterior.fiestas_del_dia(date(2026, 11, 13)) == []


def test_la_fiesta_sube_el_animo_y_gasta_despensa(s, aldea):
    animo = estado.aldeanos(s, aldea)[0].animo
    grano = estado.recursos(aldea)["grano"]
    exterior.celebrar_fiestas(s, aldea, date(2026, 6, 24))
    assert estado.aldeanos(s, aldea)[0].animo == animo + 8
    assert estado.recursos(aldea)["grano"] == grano - 6
    assert aldea.estado["banderas"]["fiesta"] == "San Xoán"
    aldea.estado["dia"] += 1
    efectos.caducar_banderas(aldea)
    assert "fiesta" not in aldea.estado["banderas"]


def test_sin_despensa_se_celebra_con_lo_puesto(s, aldea):
    estado.recursos(aldea).update({"grano": 0, "madera": 0})
    animo = estado.aldeanos(s, aldea)[0].animo
    exterior.celebrar_fiestas(s, aldea, date(2026, 6, 24))
    assert estado.aldeanos(s, aldea)[0].animo == animo + 2
    assert "con lo puesto" in s.scalar(select(Suceso).where(Suceso.tipo == "fiesta")).texto


# --- Mercaderes y viajeros --------------------------------------------------------------------------

def test_llega_un_mercader_con_ofertas_noticias_y_se_puede_tratar(s, aldea):
    rico(aldea)
    mercader = exterior.llegar(s, aldea, "mercader_grano")
    assert mercader.activo and mercader.datos["noticia"] and len(mercader.datos["ofertas"]) == 3
    assert aldea.estado["banderas"]["visitante"] == mercader.nombre
    exterior.comerciar(s, aldea, mercader.id, "grano")
    r = estado.recursos(aldea)
    assert r["grano"] == 530 and r["oro"] == 490
    for _ in range(2):
        exterior.comerciar(s, aldea, mercader.id, "grano")
    with pytest.raises(NoSePuede, match="ya no le queda"):
        exterior.comerciar(s, aldea, mercader.id, "grano")
    estado.recursos(aldea)["oro"] = 1
    with pytest.raises(NoSePuede, match="con qué pagar"):
        exterior.comerciar(s, aldea, mercader.id, "pan")


def test_el_visitante_se_marcha_y_a_veces_deja_un_lio(s, aldea):
    mercader = exterior.llegar(s, aldea, "juglar")
    aldea.estado["dia"] += 1

    class SiempreLio:
        def random(self): return 0.0
        def choice(self, lista): return lista[0]
        def sample(self, lista, n): return lista[:n]

    exterior.despedir_visitantes(s, aldea, SiempreLio())
    assert not mercader.activo and "visitante" not in aldea.estado["banderas"]
    assert "copla" in s.scalars(select(Suceso).where(Suceso.tipo == "visita").order_by(Suceso.id.desc())).first().texto
    with pytest.raises(NoSePuede):
        exterior.comerciar(s, aldea, mercader.id, "funcion")


def test_todos_los_visitantes_del_yaml_llegan_y_sus_tratos_funcionan(s, aldea):
    todos_presentes(s, aldea)
    for ficha in datos.cargar("mercaderes")["visitantes"]:
        rico(aldea)
        v = exterior.llegar(s, aldea, ficha["clave"])
        for oferta in ficha["ofertas"]:
            exterior.comerciar(s, aldea, v.id, oferta["clave"])
        for lio in ficha["lios"]:
            sujetos = efectos.resolver_sujetos(s, aldea, lio.get("sujetos"), estado.azar(aldea, "lio"))
            efectos.aplicar(s, aldea, lio["efectos"], sujetos)


# --- Vecinos ----------------------------------------------------------------------------------------

def vecino(s, aldea, clave):
    return next(v for v in exterior.vecinos(s, aldea) if v.clave == clave)


def test_ocho_territorios_vecinos_con_senor(s, aldea):
    vecinos = exterior.vecinos(s, aldea)
    assert len(vecinos) == 8 and {"castrovello", "ribadouro", "montefurado"} <= {v.clave for v in vecinos}
    assert all(v.senor and v.caracter for v in vecinos)


def test_comercio_por_carta(s, aldea):
    rico(aldea)
    mensaje = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="comercio", clave_vecino="castrovello")
    assert "Ordoño" in mensaje.texto and mensaje.estado == "abierto"
    assert [o["clave"] for o in mensaje.opciones] == ["aceptar", "regatear", "rechazar"]
    antes = dict(estado.recursos(aldea))
    exterior.responder(s, aldea, mensaje.id, "aceptar")
    r = estado.recursos(aldea)
    assert r["grano"] > antes["grano"] and r["madera"] < antes["madera"]  # Castrovello vende grano y compra madera
    assert vecino(s, aldea, "castrovello").relacion == 15
    with pytest.raises(NoSePuede, match="ya está contestado"):
        exterior.responder(s, aldea, mensaje.id, "rechazar")


def test_amenaza_pagar_negarse_o_plantar_cara(s, aldea):
    rico(aldea)
    mensaje = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="amenaza", clave_vecino="ribadouro")
    assert "plantar_cara" not in [o["clave"] for o in mensaje.opciones]  # sin defensas no hay con qué
    exterior.responder(s, aldea, mensaje.id, "negarse")
    amenaza = aldea.estado["amenaza"]
    assert amenaza["clave"] == "mesnada" and amenaza["vecino"] == "ribadouro"
    # Llega la mesnada y no hay defensa: se cobran con intereses.
    aldea.estado["dia"] = amenaza["dia_golpe"]
    exterior.amenazas(s, aldea)
    assert estado.recursos(aldea)["oro"] < 500 and aldea.estado["amenaza"] is None
    # Con torre y rondas, la próxima vez se puede plantar cara.
    aldea.estado["dia"] += 10
    gobierno.promulgar(s, aldea, "leva", True)
    estado.recursos(aldea).update({"madera": 500, "piedra": 500})
    for i in range(8):
        construccion.construir(s, aldea, "muralla", 10 + i, 10)
    assert estado.defensa(s, aldea) >= 10
    otro = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="amenaza", clave_vecino="ribadouro")
    assert "plantar_cara" in [o["clave"] for o in otro.opciones]


def test_alianza_da_defensa_y_enfria_a_los_demas(s, aldea):
    v = vecino(s, aldea, "castrovello")
    v.relacion = 40
    mensaje = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="alianza", clave_vecino="castrovello")
    defensa = estado.defensa(s, aldea)
    exterior.responder(s, aldea, mensaje.id, "aceptar")
    assert aldea.estado["alianzas"] == ["castrovello"]
    assert estado.defensa(s, aldea) == defensa + 5
    assert vecino(s, aldea, "ribadouro").relacion == -15


def test_boda_impuesta_a_quien_quiere_a_otra_trae_drama(s, aldea):
    gente = todos_presentes(s, aldea)
    mensaje = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="boda", clave_vecino="castrovello")
    mensaje.datos = {**mensaje.datos, "aldeano": gente["lenador"].id}  # piden la mano de Bieito
    antes = (gente["lenador"].opinion_senor, gente["panadera"].opinion_senor)
    poblacion = len(estado.aldeanos(s, aldea))
    exterior.responder(s, aldea, mensaje.id, "bendecir")
    assert gente["lenador"].opinion_senor == antes[0] - 18 and gente["panadera"].opinion_senor == antes[1] - 18
    assert len(estado.aldeanos(s, aldea)) == poblacion + 1  # llega la novia de fuera
    assert gente["lenador"].datos["casado"]
    assert "mirando al suelo" in mensaje.resultado


def test_si_deciden_los_novios_el_enamorado_dice_que_no(s, aldea):
    gente = todos_presentes(s, aldea)
    mensaje = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="boda", clave_vecino="castrovello")
    mensaje.datos = {**mensaje.datos, "aldeano": gente["panadera"].id}
    opinion = gente["panadera"].opinion_senor
    exterior.responder(s, aldea, mensaje.id, "que_decidan")
    assert gente["panadera"].opinion_senor == opinion + 8
    assert not gente["panadera"].datos.get("casado")
    assert "dice que no" in mensaje.resultado


def test_carta_sin_contestar_caduca_con_la_respuesta_por_defecto(s, aldea):
    mensaje = exterior.nuevo_mensaje(s, aldea, MotorSimulado(), tipo="cortesia", clave_vecino="montefurado")
    aldea.estado["dia"] += exterior.DIAS_MENSAJE
    exterior.caducar_mensajes(s, aldea)
    assert mensaje.estado == "caducado" and mensaje.respuesta == "excusarse"
    assert vecino(s, aldea, "montefurado").relacion == -2


# --- Bandidos, lobos y peste ------------------------------------------------------------------------

def test_las_murallas_y_la_guardia_dan_defensa_con_tope(s, aldea):
    todos_presentes(s, aldea)
    rico(aldea)
    assert estado.defensa(s, aldea) == 0
    for i in range(30):
        construccion.construir(s, aldea, "empalizada", 5 + i, 5)
    assert estado.defensa(s, aldea) == estado.MAX_DEFENSA_MUROS  # 30 × 0,7 = 21, pero los muros solos tienen tope
    construccion.construir(s, aldea, "herreria", 10, 12)
    construccion.construir(s, aldea, "torre_guardia", 14, 12)
    assert estado.defensa(s, aldea) == estado.MAX_DEFENSA_MUROS + 10  # la torre tiene guardia asignado


def golpe(s, aldea, clave, fuerza):
    aldea.estado["amenaza"] = {"clave": clave, "dia_golpe": aldea.estado["dia"], "fuerza": fuerza}
    exterior.amenazas(s, aldea)


def test_bandidos_sin_defensa_roban_y_con_defensa_se_van(s, aldea):
    rico(aldea)
    golpe(s, aldea, "bandidos", 12)
    r = estado.recursos(aldea)
    assert r["grano"] == 470 and r["oro"] == 485
    assert aldea.estado["enfriamientos"]["amenaza"] == aldea.estado["dia"] + exterior.DESCANSO_AMENAZA
    for i in range(30):
        construccion.construir(s, aldea, "empalizada", 5 + i, 5)
    opinion = estado.aldeanos(s, aldea)[0].opinion_senor
    golpe(s, aldea, "bandidos", 12)
    assert estado.recursos(aldea)["oro"] == 485  # esta vez no se llevan nada (las empalizadas costaron madera, no oro)
    assert estado.aldeanos(s, aldea)[0].opinion_senor == opinion + 5


def test_media_defensa_reduce_el_dano(s, aldea):
    rico(aldea)
    gobierno.promulgar(s, aldea, "leva", True)  # defensa 6
    golpe(s, aldea, "bandidos", 12)
    assert estado.recursos(aldea)["grano"] == 485  # la mitad de lo que se habrían llevado
    assert "gracias a ella no fue peor" in s.scalars(select(Suceso).where(Suceso.tipo == "amenaza").order_by(Suceso.id.desc())).first().texto


def test_primero_el_aviso_y_luego_el_golpe(s, aldea, monkeypatch):
    rico(aldea)
    aldea.estado["dia"] = 20
    monkeypatch.setattr(datos, "cargar", lambda n, _c=datos.cargar: [{**f, "probabilidad": 1.0} for f in _c(n) if f["clave"] == "bandidos"] if n == "amenazas" else _c(n))
    exterior.amenazas(s, aldea)
    amenaza = aldea.estado["amenaza"]
    assert amenaza["clave"] == "bandidos" and amenaza["dia_golpe"] == 22
    assert "bandidos" in s.scalar(select(Suceso).where(Suceso.tipo == "amenaza")).texto
    grano = estado.recursos(aldea)["grano"]
    aldea.estado["dia"] = 21
    exterior.amenazas(s, aldea)
    assert estado.recursos(aldea)["grano"] == grano  # aún no
    aldea.estado["dia"] = 22
    exterior.amenazas(s, aldea)
    assert estado.recursos(aldea)["grano"] < grano


def test_la_peste_enferma_pero_en_un_cuento_no_mata_y_la_curandera_ayuda(s, aldea):
    gente = todos_presentes(s, aldea)
    rico(aldea)
    aldea.estado["dia"] = 20
    golpe(s, aldea, "peste", 0)
    assert aldea.estado["peste"]["hasta"] == 25
    for dia in range(21, 26):
        aldea.estado["dia"] = dia
        exterior.amenazas(s, aldea)
    assert aldea.estado["peste"] is None
    assert len(estado.aldeanos(s, aldea)) == 12  # tono «cuento», dificultad normal: nadie muere
    sin_cuidados = sum(100 - a.salud for a in gente.values())
    assert sin_cuidados > 0
    # Otra vez, con pozo, curandera y cuarentena.
    for a in gente.values():
        a.salud = 90
    construccion.construir(s, aldea, "pozo", 10, 12)
    construccion.construir(s, aldea, "botica", 14, 12)
    gobierno.promulgar(s, aldea, "cuarentena", True)
    aldea.estado["dia"] = 60
    golpe(s, aldea, "peste", 0)
    for dia in range(61, 66):
        aldea.estado["dia"] = dia
        exterior.amenazas(s, aldea)
    assert sum(90 - a.salud for a in gente.values()) < sin_cuidados / 2


def test_un_mes_entero_con_todo_encendido_no_revienta(s, aldea):
    """Treinta días con vecinos, mercaderes, fiestas, amenazas, consejo y drama a la vez."""
    estado.recursos(aldea).update({"grano": 900, "madera": 600, "piedra": 400, "oro": 200})
    for clave, cx, cz in (("casa", 26, 16), ("casa", 26, 20), ("casa", 30, 16), ("casa", 30, 20), ("campo", 10, 20),
                          ("campo", 10, 14), ("cabana_lenador", 14, 34), ("pozo", 25, 24)):
        construccion.construir(s, aldea, clave, cx, cz)
    motor = MotorSimulado()
    for dia in range(30):
        if dia == 8:
            construccion.construir(s, aldea, "mercado", 14, 10)  # ya hay vecinos de sobra
        ciclo.adelantar_dia(s, aldea, ia=motor, real=INICIO)
    tipos = {x.tipo for x in s.scalars(select(Suceso))}
    assert {"visita", "vecinos", "consejo", "llegada", "drama", "fiesta"} <= tipos
    assert s.scalar(select(Visitante)) is not None and s.scalar(select(Mensaje)) is not None
    assert len(estado.aldeanos(s, aldea)) >= 8
    assert not aldea.estado["perdida"]
