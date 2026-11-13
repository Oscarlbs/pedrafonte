"""El consejo diario, los impuestos, las leyes, las promesas y las revueltas."""

from __future__ import annotations

import string

import pytest
from sqlalchemy import select

from aldea import datos, ia
from aldea.modelos import Cronica, Peticion, Suceso
from aldea.motor import ciclo, condiciones, consejo, construccion, drama, economia, efectos, estado, gobierno, rumores
from aldea.motor.construccion import NoSePuede

from .conftest import INICIO


def todos_presentes(s, aldea):
    for a in estado.aldeanos(s, aldea, solo_presentes=False):
        a.presente = True
    s.flush()
    return {a.clave: a for a in estado.aldeanos(s, aldea)}


def claves(peticiones):
    return {p.clave for p in peticiones}


# --- Las peticiones nacen del estado real -----------------------------------------------------------

def test_condiciones_seguras():
    v = {"grano": 3, "estacion": "invierno", "tiene_pozo": 0}
    assert condiciones.cumple("grano < 4 and estacion == 'invierno' and not tiene_pozo", v)
    assert condiciones.cumple("", v) and condiciones.cumple(None, v)
    assert not condiciones.cumple("edificio_que_no_existe", v)  # lo desconocido vale 0
    assert condiciones.cumple("estacion in ['otono', 'invierno']", v)
    for trampa in ("__import__('os').system('ls')", "grano.__class__", "open('x')", "[x for x in (1,)]"):
        with pytest.raises((ValueError, SyntaxError)):
            condiciones.cumple(trampa, v)


def test_de_dos_a_tres_peticiones_al_dia(s, aldea):
    peticiones = consejo.generar(s, aldea)
    assert len(peticiones) == 2  # con cuatro vecinos, dos
    todos_presentes(s, aldea)
    for p in consejo.abiertas(s, aldea):
        consejo.resolver(s, aldea, p.id, p.defecto)
    aldea.estado["dia"] += 1
    aldea.estado["enfriamientos"] = {}
    assert len(consejo.generar(s, aldea)) == 3  # con doce, tres


def test_las_peticiones_salen_de_lo_que_pasa_de_verdad(s, aldea):
    # Recién fundada: 4 vecinos y 2 plazas → hay gente al raso, y lo dicen.
    assert "gente_al_raso" in claves(consejo.generar(s, aldea, cuantas=20))
    # Sin comida aparece la despensa vacía; con comida, no.
    aldea.estado["enfriamientos"] = {}
    for p in consejo.abiertas(s, aldea):
        s.delete(p)
    estado.recursos(aldea).update({"grano": 3, "pan": 0})
    assert "despensa_vacia" in claves(consejo.generar(s, aldea, cuantas=20))
    # Los tributos altos solo se discuten si son altos.
    assert "tributos_altos" not in claves(consejo.abiertas(s, aldea))
    aldea.estado["impuestos"] = 4
    aldea.estado["enfriamientos"] = {}
    assert "tributos_altos" in claves(consejo.generar(s, aldea, cuantas=20))
    # Los pleitos necesitan a sus protagonistas: el molinero y la panadera aún no han llegado.
    assert "harina_con_testigos" not in claves(consejo.abiertas(s, aldea))
    todos_presentes(s, aldea)
    aldea.estado["enfriamientos"] = {}
    todas = claves(consejo.generar(s, aldea, cuantas=30)) | claves(consejo.abiertas(s, aldea))
    assert {"harina_con_testigos", "rezos_o_hierbas", "deuda_vieja"} <= todas


def test_un_secreto_que_corre_acaba_en_el_consejo(s, aldea):
    gente = todos_presentes(s, aldea)
    assert "la_maquila" not in claves(consejo.generar(s, aldea, cuantas=30))
    rumores.soltar_secreto(s, aldea, gente["molinero"], gente["tabernero"])
    aldea.estado["enfriamientos"] = {}
    assert "la_maquila" in claves(consejo.generar(s, aldea, cuantas=30))


# --- Decidir tiene consecuencias, y las aplica el motor ---------------------------------------------

def peticion(s, aldea, clave):
    return next(p for p in consejo.abiertas(s, aldea) if p.clave == clave)


def test_resolver_aplica_coste_y_efectos(s, aldea):
    estado.recursos(aldea).update({"grano": 3, "pan": 0, "oro": 20})
    consejo.generar(s, aldea, cuantas=20)
    p = peticion(s, aldea, "despensa_vacia")
    opinion = estado.aldeanos(s, aldea)[0].opinion_senor
    consejo.resolver(s, aldea, p.id, "comprar")
    assert estado.recursos(aldea)["oro"] == 5 and estado.recursos(aldea)["grano"] == 43
    assert estado.aldeanos(s, aldea)[0].opinion_senor == opinion + 3
    assert p.estado == "resuelta" and "grano" in p.resultado
    with pytest.raises(NoSePuede, match="ya está resuelta"):
        consejo.resolver(s, aldea, p.id, "racionar")
    assert s.scalar(select(Suceso).where(Suceso.tipo == "consejo")) is not None


def test_no_se_puede_elegir_lo_que_no_se_puede_pagar(s, aldea):
    estado.recursos(aldea).update({"grano": 3, "pan": 0, "oro": 2})
    consejo.generar(s, aldea, cuantas=20)
    p = peticion(s, aldea, "despensa_vacia")
    with pytest.raises(NoSePuede, match="arca"):
        consejo.resolver(s, aldea, p.id, "comprar")
    with pytest.raises(NoSePuede, match="no existe"):
        consejo.resolver(s, aldea, p.id, "invadir_francia")
    consejo.resolver(s, aldea, p.id, "racionar")
    assert "racionamiento" in aldea.estado["leyes"]


def test_un_pleito_contenta_a_uno_y_enfada_a_otro(s, aldea):
    gente = todos_presentes(s, aldea)
    consejo.generar(s, aldea, cuantas=30)
    p = peticion(s, aldea, "harina_con_testigos")
    antes = {c: gente[c].opinion_senor for c in ("panadera", "molinero")}
    consejo.resolver(s, aldea, p.id, "panadera")
    assert gente["panadera"].opinion_senor == antes["panadera"] + 8
    assert gente["molinero"].opinion_senor == antes["molinero"] - 10


def test_lo_que_no_se_decide_caduca_por_la_opcion_de_dejadez(s, aldea):
    estado.recursos(aldea).update({"grano": 3, "pan": 0})
    consejo.generar(s, aldea, cuantas=20)
    p = peticion(s, aldea, "despensa_vacia")
    aldea.estado["dia"] += 1
    assert consejo.caducar(s, aldea) == 0  # un día de gracia
    assert consejo.generar(s, aldea) == []  # y mientras haya pendientes no se amontonan más
    aldea.estado["dia"] += 1
    assert consejo.caducar(s, aldea) >= 1
    assert p.estado == "caducada" and p.elegida == "aguantar"
    assert p.resultado.startswith("No dijisteis ni que sí ni que no.")


def test_promesa_cumplida_y_promesa_rota(s, aldea):
    consejo.generar(s, aldea, cuantas=20)
    consejo.resolver(s, aldea, peticion(s, aldea, "gente_al_raso").id, "prometer")
    assert aldea.estado["promesas"][0]["clave"] == "casas"
    base = estado.aldeanos(s, aldea)[0].opinion_senor
    aldea.estado["dia"] += 6  # pasa el plazo sin casas
    consejo.revisar_promesas(s, aldea)
    assert estado.aldeanos(s, aldea)[0].opinion_senor == base - 8
    assert aldea.estado["promesas"] == []
    # Otra vez, pero cumpliendo.
    aldea.estado["enfriamientos"] = {}
    consejo.generar(s, aldea, cuantas=20)
    consejo.resolver(s, aldea, peticion(s, aldea, "gente_al_raso").id, "prometer")
    estado.recursos(aldea).update({"madera": 100, "piedra": 100})
    construccion.construir(s, aldea, "casa", 26, 16)
    base = estado.aldeanos(s, aldea)[0].opinion_senor
    consejo.revisar_promesas(s, aldea)
    assert estado.aldeanos(s, aldea)[0].opinion_senor == base + 5


def test_todas_las_peticiones_del_yaml_se_pueden_resolver_por_todas_sus_opciones(s, aldea):
    gente = todos_presentes(s, aldea)
    for a in gente.values():
        rumores.soltar_secreto(s, aldea, a, None)
    estado.recursos(aldea).update({"grano": 999, "madera": 999, "piedra": 999, "oro": 999})
    fichas = datos.cargar("peticiones")
    assert len(fichas) >= 20
    probadas = 0
    for ficha in fichas:
        for opcion in ficha["opciones"]:
            sujetos = efectos.resolver_sujetos(s, aldea, ficha.get("sujetos"), estado.azar(aldea, ficha["clave"]))
            if sujetos is None:
                continue
            valores = efectos.huecos(aldea, sujetos, estado.variables(s, aldea))
            for texto in (ficha["titulo"], ficha["texto"], opcion["texto"], opcion.get("resultado", "")):
                huecos = {campo for _, campo, _, _ in string.Formatter().parse(texto) if campo}
                assert huecos <= set(valores), (ficha["clave"], huecos - set(valores))
            punto = s.begin_nested()
            efectos.aplicar(s, aldea, opcion.get("efectos"), sujetos)
            punto.rollback()
            probadas += 1
        assert any(o["clave"] == ficha["defecto"] for o in ficha["opciones"]), ficha["clave"]
    assert probadas >= 60


# --- Impuestos y leyes ------------------------------------------------------------------------------

def test_subir_tributos_duele_y_bajarlos_se_agradece_menos(s, aldea):
    a = estado.aldeanos(s, aldea)[0]
    base = a.opinion_senor
    gobierno.fijar_impuestos(s, aldea, 3)
    assert a.opinion_senor == base - 6
    gobierno.fijar_impuestos(s, aldea, 1)
    assert a.opinion_senor == base - 4
    with pytest.raises(NoSePuede):
        gobierno.fijar_impuestos(s, aldea, 9)


def test_las_leyes_cambian_la_economia_y_la_opinion_por_oficio(s, aldea):
    gente = todos_presentes(s, aldea)
    estado.recursos(aldea).update({"grano": 500, "pan": 0})
    normal = economia.comer(s, aldea, INICIO.date())["grano"]
    gobierno.promulgar(s, aldea, "racionamiento", True)
    racionado = economia.comer(s, aldea, INICIO.date())["grano"]
    assert racionado == pytest.approx(normal * 0.75)
    gobierno.promulgar(s, aldea, "vino_solo_en_fiestas", True)
    from aldea.motor import leyes

    assert leyes.opinion_de(aldea, gente["tabernero"]) < leyes.opinion_de(aldea, gente["cura"])
    with pytest.raises(NoSePuede, match="Aún no"):
        gobierno.promulgar(s, aldea, "diezmo", True)  # no hay iglesia
    gobierno.promulgar(s, aldea, "racionamiento", False)
    assert aldea.estado["leyes"] == ["vino_solo_en_fiestas"]


# --- Hambre y revueltas: riesgo moderado ------------------------------------------------------------

def malestar(s, aldea):
    for a in estado.aldeanos(s, aldea):
        a.opinion_senor = -60
    aldea.estado["tension"] = 80


def test_la_revuelta_necesita_varios_dias_de_malestar(s, aldea):
    balance = {}
    malestar(s, aldea)
    gobierno.cierre(s, aldea, balance)
    gobierno.cierre(s, aldea, balance)
    assert not aldea.estado["revuelta"]["activa"]  # dos días de aviso no bastan
    gobierno.cierre(s, aldea, balance)
    assert aldea.estado["revuelta"]["activa"]
    assert s.scalar(select(Suceso).where(Suceso.tipo == "revuelta", Suceso.texto.like("¡Revuelta!%"))) is not None


def test_la_revuelta_se_apaga_si_se_gobierna_mejor(s, aldea):
    malestar(s, aldea)
    for _ in range(3):
        gobierno.cierre(s, aldea, {})
    for a in estado.aldeanos(s, aldea):
        a.opinion_senor = 0
    gobierno.cierre(s, aldea, {})
    assert not aldea.estado["revuelta"]["activa"] and not aldea.estado["perdida"]


def test_cuesta_perder_pero_se_puede_y_hay_segunda_oportunidad(s, aldea):
    dias = 0
    while not aldea.estado["perdida"]:
        malestar(s, aldea)
        gobierno.cierre(s, aldea, {})
        dias += 1
        assert dias < 30
    assert dias == gobierno.AVISOS_PARA_REVUELTA + gobierno.DIAS_PARA_PERDER  # diez días seguidos de desgobierno
    assert ciclo.avanzar(s, aldea, INICIO.replace(year=2027))["horas"] == 0  # la aldea ya no obedece
    gobierno.pedir_perdon(s, aldea)
    assert not aldea.estado["perdida"] and estado.recursos(aldea)["oro"] == 0
    assert all(a.opinion_senor >= -5 for a in estado.aldeanos(s, aldea))


def test_gobernar_fatal_un_mes_lleva_al_desastre_pero_despacio(s, aldea):
    """Tributos abusivos y ni una casa: la aldea se enfada poco a poco, no de golpe."""
    motor = ia.obtener(aldea)
    gobierno.fijar_impuestos(s, aldea, 4)
    gobierno.promulgar(s, aldea, "jornada_larga", True)
    opiniones = []
    for _ in range(12):
        ciclo.adelantar_dia(s, aldea, ia=motor, real=INICIO)
        gente = estado.aldeanos(s, aldea)
        opiniones.append(sum(a.opinion_senor for a in gente) / len(gente))
    assert opiniones[-1] < opiniones[0] < 0
    assert not aldea.estado["perdida"]  # en doce días aún no os han echado
    assert opiniones[2] > -50  # y tampoco se hunde en tres


# --- El pergamino -----------------------------------------------------------------------------------

def test_cronica_diaria_con_opiniones_del_escriba_sobre_el_gobierno(s, aldea):
    motor = ia.obtener(aldea)
    gobierno.fijar_impuestos(s, aldea, 4)
    peticiones = consejo.generar(s, aldea)
    consejo.resolver(s, aldea, peticiones[0].id, peticiones[0].opciones[0]["clave"])
    ciclo.adelantar_dia(s, aldea, ia=motor, real=INICIO)
    cronica = s.scalar(select(Cronica).where(Cronica.dia == 1))
    assert "Pedrafonte" in cronica.texto
    assert any("tributos" in o.lower() for o in cronica.opiniones)  # opina de lo que de verdad pasa
    assert any("raso" in o for o in cronica.opiniones)
    assert "En el consejo:" in cronica.texto
    assert s.scalar(select(Peticion).where(Peticion.dia == 2, Peticion.estado == "abierta")) is not None  # hoy, otras


def test_el_director_no_dispara_durante_una_revuelta_pero_la_tension_se_enfria_sola(s, aldea):
    aldea.estado["tension"] = 90
    for _ in range(12):
        drama.actualizar_tension(s, aldea)
    assert aldea.estado["tension"] < 20
