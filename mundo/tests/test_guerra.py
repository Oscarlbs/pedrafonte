"""La guerra: tropas, campañas, huestes que vienen, asedios, vasallos, títulos y el mapa de la comarca."""

from __future__ import annotations

import pytest

from aldea.motor import ciclo, construccion, estado, exterior, fundacion, guerra
from aldea.motor.construccion import NoSePuede

from .conftest import INICIO
from .test_exterior import rico, todos_presentes


def con_cuartel(s, aldea, cuarteles=1):
    todos_presentes(s, aldea)
    rico(aldea)
    construccion.construir(s, aldea, "herreria", 10, 12)
    for i in range(cuarteles):
        construccion.construir(s, aldea, "cuartel", 5 + i * 5, 40)


def noche(s, aldea, dias=1):
    for _ in range(dias):
        aldea.estado["dia"] += 1
        guerra.cierre(s, aldea)


# --- Territorios ------------------------------------------------------------------------------------

def test_la_comarca_va_de_menos_a_mas_y_todos_tienen_sitio_en_el_mapa(s, aldea):
    lista = guerra.asegurar(s, aldea)
    assert len(lista) == 8
    fuerzas = [v.datos["fuerza"] for v in lista]
    assert min(fuerzas) < 10 and max(fuerzas) >= 60  # hay con quién empezar y con quién acabar
    assert all(len(v.datos["pos"]) == 2 and guerra.situacion(v) == "libre" for v in lista)
    assert all(1 <= guerra.dias_de_marcha(v) <= 4 for v in lista)
    claves = {v.clave for v in lista} | {"aldea"}
    assert all(a in claves and b in claves for a, b in guerra.cfg()["caminos"])


def test_una_aldea_vieja_recibe_los_territorios_que_le_faltan(s, aldea):
    from aldea.modelos import Vecino
    from sqlalchemy import delete

    s.execute(delete(Vecino).where(Vecino.aldea_id == aldea.id, Vecino.clave != "castrovello"))
    viejo = exterior.vecinos(s, aldea)[0]
    viejo.datos = {"estilo": "ceremonioso"}  # como las de antes de la guerra: sin fuerza ni sitio en el mapa
    s.flush()
    lista = guerra.asegurar(s, aldea)
    assert len(lista) == 8 and viejo.datos["fuerza_ahora"] == 22 and viejo.datos["pos"] == [72, 46]


# --- Tropas -----------------------------------------------------------------------------------------

def test_sin_cuartel_solo_hay_milicia_y_no_pasa_de_medio_pueblo(s, aldea):
    rico(aldea)
    with pytest.raises(NoSePuede, match="cuartel"):
        guerra.reclutar(s, aldea, "lanceros", 2)
    guerra.reclutar(s, aldea, "milicia", 2)  # cuatro colonos: dos milicianos como mucho
    with pytest.raises(NoSePuede, match="brazos"):
        guerra.reclutar(s, aldea, "milicia", 1)
    assert guerra.tropas(aldea)["milicia"] == 2 and estado.variables(s, aldea)["tropas_total"] == 2


def test_reclutar_cuesta_cabe_en_el_cuartel_y_suma_a_la_defensa(s, aldea):
    con_cuartel(s, aldea)
    oro = estado.recursos(aldea)["oro"]
    defensa = estado.defensa(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 6)
    assert estado.recursos(aldea)["oro"] == oro - 36
    assert estado.defensa(s, aldea) == defensa + 12  # 6 lanceros × 2, sin muro
    with pytest.raises(NoSePuede, match="caben"):
        guerra.reclutar(s, aldea, "arqueros", 7)  # el cuartel es de doce
    guerra.reclutar(s, aldea, "arqueros", 6)
    for i in range(10):
        construccion.construir(s, aldea, "empalizada", 5 + i, 5)
    partes = estado.partes_defensa(s, aldea)
    assert partes["tropas"] == 6 * 2.5 + 6 * 4  # tras un muro, los arqueros valen más que nadie
    guerra.licenciar(s, aldea, "arqueros", 6)
    assert guerra.tropas(aldea)["arqueros"] == 0


def test_la_tropa_cobra_cada_noche_y_si_no_hay_con_que_deserta(s, aldea):
    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 10)
    oro, grano = estado.recursos(aldea)["oro"], estado.recursos(aldea)["grano"]
    noche(s, aldea)
    assert estado.recursos(aldea)["oro"] == pytest.approx(oro - 3) and estado.recursos(aldea)["grano"] == pytest.approx(grano - 5)
    estado.recursos(aldea).update({"oro": 0})
    noche(s, aldea)
    assert guerra.tropas(aldea)["lanceros"] < 10


# --- Campañas ---------------------------------------------------------------------------------------

def test_someter_a_un_vecino_debil_da_vasallo_tributo_y_titulo(s, aldea):
    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 12)
    lista = guerra.asegurar(s, aldea)
    assert guerra.titulo(lista) == "Señor"
    campana = guerra.lanzar(s, aldea, "vilanova", "someter", {"lanceros": 12})
    assert guerra.tropas(aldea)["lanceros"] == 0 and estado.partes_defensa(s, aldea)["tropas"] == 0  # la aldea queda sin ellos
    with pytest.raises(NoSePuede, match="campaña"):
        guerra.lanzar(s, aldea, "meiras", "saquear", {"lanceros": 1})
    noche(s, aldea, campana["dia_batalla"] - aldea.estado["dia"])
    vilanova = guerra.territorio(s, aldea, "vilanova")
    assert guerra.situacion(vilanova) == "vasallo" and aldea.estado["campana"]["fase"] == "vuelta"
    oro = estado.recursos(aldea)["oro"]
    noche(s, aldea, 3)
    assert aldea.estado["campana"] is None and guerra.tropas(aldea)["lanceros"] >= 8  # vuelven casi todos
    assert estado.recursos(aldea)["oro"] > oro - 12  # cobra tributo cada noche (los sueldos se llevan más)
    assert guerra.tributo_de(vilanova) == {"oro": 2.0, "grano": 3.6}
    assert guerra.titulo(guerra.asegurar(s, aldea)) == "Barón" and estado.variables(s, aldea)["dominios"] == 1
    assert aldea.estado["partes_guerra"][-1]["victoria"] is True


def test_cuatro_labradores_contra_el_conde_vuelven_escarmentados(s, aldea):
    todos_presentes(s, aldea)
    rico(aldea)
    guerra.reclutar(s, aldea, "milicia", 5)
    guerra.lanzar(s, aldea, "santamarina", "conquistar", {"milicia": 5})
    noche(s, aldea, 4)
    c = aldea.estado.get("campana") or aldea.estado["partes_guerra"][-1]
    assert c["victoria"] is False
    assert guerra.situacion(guerra.territorio(s, aldea, "santamarina")) == "libre"


def test_saquear_trae_botin_y_enfada_a_la_comarca(s, aldea):
    con_cuartel(s, aldea, cuarteles=2)
    guerra.reclutar(s, aldea, "lanceros", 20)
    antes = {v.clave: v.relacion for v in guerra.asegurar(s, aldea)}
    guerra.lanzar(s, aldea, "meiras", "saquear", {"lanceros": 20})
    noche(s, aldea, 3)
    parte = aldea.estado["partes_guerra"][-1]
    assert parte["victoria"] and parte["botin"]["oro"] > 0 and parte["botin"]["grano"] > 0
    ahora = {v.clave: v.relacion for v in guerra.asegurar(s, aldea)}
    assert ahora["meiras"] < antes["meiras"] - 30 and ahora["castrovello"] < antes["castrovello"]
    assert guerra.situacion(guerra.territorio(s, aldea, "meiras")) == "libre"  # saquear no es mandar


def test_conquistar_deja_guarnicion_y_rinde_mas(s, aldea):
    con_cuartel(s, aldea, cuarteles=2)
    guerra.reclutar(s, aldea, "lanceros", 24)
    guerra.lanzar(s, aldea, "vilanova", "conquistar", {"lanceros": 24})
    noche(s, aldea, 2)
    vilanova = guerra.territorio(s, aldea, "vilanova")
    assert guerra.situacion(vilanova) == "conquistado"
    assert guerra.tributo_de(vilanova)["oro"] == pytest.approx(3.2)
    assert aldea.estado["partes_guerra"][-1]["texto"].count("guarnición") == 1
    with pytest.raises(NoSePuede, match="vuestra"):
        guerra.lanzar(s, aldea, "vilanova", "saquear", {"lanceros": 1})


def test_un_vasallo_se_rebela_si_deja_de_temeros(s, aldea):
    guerra.asegurar(s, aldea)
    ribadouro = guerra.territorio(s, aldea, "ribadouro")
    ribadouro.datos = {**ribadouro.datos, "estado": "vasallo"}
    for _ in range(80):  # sin una lanza en casa, tarde o temprano deja de pagar
        noche(s, aldea)
    assert guerra.situacion(ribadouro) == "libre" and ribadouro.relacion < -10


# --- Huestes que vienen -----------------------------------------------------------------------------

def hueste(s, aldea, clave, fuerza):
    aldea.estado["amenaza"] = {"clave": "hueste", "vecino": clave, "fuerza": fuerza, "dia_golpe": aldea.estado["dia"], "ficha": {"nombre": "la hueste"}}
    exterior.amenazas(s, aldea)


def test_no_hay_huestes_en_los_primeros_dias_ni_de_quien_os_aprecia(s, aldea):
    todos_presentes(s, aldea)
    for v in guerra.asegurar(s, aldea):
        v.relacion = -80
    for _ in range(12):
        noche(s, aldea)
    assert not aldea.estado.get("amenaza")  # paz inicial
    for v in guerra.asegurar(s, aldea):
        v.relacion = 20
    aldea.estado["dia"] = 40
    for _ in range(60):
        noche(s, aldea)
    assert not aldea.estado.get("amenaza")  # nadie os tiene ojeriza


def test_quien_os_odia_acaba_viniendo_y_avisa_antes(s, aldea):
    todos_presentes(s, aldea)
    rico(aldea)
    aldea.estado["dia"] = 30
    guerra.territorio(s, aldea, "lobeira").relacion = -80
    for _ in range(200):
        noche(s, aldea)
        if aldea.estado.get("amenaza"):
            break
        estado.recursos(aldea).update({"grano": 500})
    amenaza = aldea.estado["amenaza"]
    assert amenaza["clave"] == "hueste" and amenaza["vecino"] == "lobeira"
    assert amenaza["dia_golpe"] - aldea.estado["dia"] >= 2 and 25 <= amenaza["fuerza"] <= 42


def test_una_hueste_se_estrella_contra_buena_defensa(s, aldea):
    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 12)
    oro = estado.recursos(aldea)["oro"]
    lobo = guerra.territorio(s, aldea, "meiras")
    hueste(s, aldea, "meiras", 12)
    assert estado.recursos(aldea)["oro"] > oro  # rescate de los prisioneros
    assert lobo.datos["fuerza_ahora"] < 13 and estado.variables(s, aldea)["hecho_defensa"] == 1


def test_sin_muros_entran_a_saco_y_si_os_doblan_os_hacen_vasallo(s, aldea):
    todos_presentes(s, aldea)
    rico(aldea)
    aldea.estado["dia"] = 30
    hueste(s, aldea, "lobeira", 40)
    r = estado.recursos(aldea)
    assert r["oro"] < 500 and r["grano"] < 500
    assert aldea.estado["vasallo_de"] == "lobeira"
    oro = r["oro"]
    noche(s, aldea)
    assert estado.recursos(aldea)["oro"] == oro - 3  # tributo al Lobo
    guerra.accion(s, aldea, "lobeira", "rescate")
    assert aldea.estado["vasallo_de"] is None


def test_con_muros_y_pan_hay_asedio_y_el_cerco_se_levanta(s, aldea):
    con_cuartel(s, aldea)
    for i in range(25):
        construccion.construir(s, aldea, "empalizada", 5 + i, 5)
    guerra.reclutar(s, aldea, "arqueros", 6)
    defensa = estado.defensa(s, aldea)
    hueste(s, aldea, "ribadouro", defensa + 8)
    assert aldea.estado["asedio"]["vecino"] == "ribadouro" and estado.variables(s, aldea)["asedio"]
    with pytest.raises(NoSePuede, match="cercados"):
        guerra.lanzar(s, aldea, "vilanova", "saquear", {"arqueros": 1})
    grano = estado.recursos(aldea)["grano"]
    noche(s, aldea, 3)
    assert aldea.estado["asedio"] is None  # los arqueros los han ido menguando
    assert estado.recursos(aldea)["grano"] < grano and estado.variables(s, aldea)["hecho_defensa"] == 1


def test_un_cerco_sin_comida_acaba_en_rendicion(s, aldea):
    todos_presentes(s, aldea)
    rico(aldea)
    for i in range(25):
        construccion.construir(s, aldea, "empalizada", 5 + i, 5)
    hueste(s, aldea, "santamarina", 60)
    assert aldea.estado["asedio"]
    estado.recursos(aldea).update({"grano": 0, "pan": 0, "harina": 0})
    noche(s, aldea)
    assert aldea.estado["asedio"] is None and estado.recursos(aldea)["oro"] < 500


# --- Embajadas --------------------------------------------------------------------------------------

def test_presente_alianza_y_exigir_tributo(s, aldea):
    con_cuartel(s, aldea, cuarteles=3)
    castro = guerra.territorio(s, aldea, "castrovello")
    guerra.accion(s, aldea, "castrovello", "regalo")
    assert castro.relacion == 18
    with pytest.raises(NoSePuede, match="Hoy ya"):
        guerra.accion(s, aldea, "castrovello", "regalo")
    with pytest.raises(NoSePuede, match="no se fía"):
        guerra.accion(s, aldea, "castrovello", "alianza")
    castro.relacion = 95
    guerra.accion(s, aldea, "castrovello", "alianza")
    assert aldea.estado["alianzas"] == ["castrovello"]
    # Sin hueste, exigir tributo es hacer el ridículo; con el triple de lanzas, pagan sin rechistar.
    guerra.accion(s, aldea, "vilanova", "exigir")
    vilanova = guerra.territorio(s, aldea, "vilanova")
    assert guerra.situacion(vilanova) == "libre" and vilanova.relacion == -20  # 5, menos 5 por la alianza ajena, menos 20 por el desplante
    guerra.reclutar(s, aldea, "lanceros", 30)
    aldea.estado["dia"] += 5
    for _ in range(6):
        if guerra.situacion(vilanova) == "vasallo":
            break
        guerra.accion(s, aldea, "vilanova", "exigir")
        aldea.estado["dia"] += 4
    assert guerra.situacion(vilanova) == "vasallo"
    guerra.accion(s, aldea, "vilanova", "liberar")
    assert guerra.situacion(vilanova) == "libre"


def test_atacar_a_un_aliado_rompe_la_alianza_y_la_fama(s, aldea):
    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 4)
    aldea.estado["alianzas"] = ["castrovello"]
    ribadouro = guerra.territorio(s, aldea, "ribadouro").relacion
    guerra.lanzar(s, aldea, "castrovello", "saquear", {"lanceros": 4})
    assert aldea.estado["alianzas"] == [] and guerra.territorio(s, aldea, "ribadouro").relacion == ribadouro - 15


# --- Mapa y ciclo -----------------------------------------------------------------------------------

def test_el_mapa_lo_cuenta_todo_y_las_lanzas_ajenas_de_cinco_en_cinco(s, aldea):
    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 3)
    m = guerra.mapa(s, aldea)
    assert m["aldea"]["titulo"] == "Señor" and m["aldea"]["pos"] == [50, 58] and m["tropas"]["lanceros"] == 3
    assert len(m["territorios"]) == 8 and m["cupos"]["sueldo"] == 12 and m["cupos"]["sueldo_usado"] == 3
    lobeira = next(t for t in m["territorios"] if t["clave"] == "lobeira")
    assert lobeira["fuerza"] % 5 == 0 and not lobeira["fuerza_exacta"] and lobeira["hostil"] is False
    assert {"regalo", "alianza", "exigir", "saquear", "someter", "conquistar"} == set(lobeira["acciones"])
    assert [u["clave"] for u in m["unidades"]] == ["milicia", "lanceros", "arqueros", "jinetes"]
    assert all(u["disponible"] for u in m["unidades"])


def test_un_mes_de_juego_con_guerra_no_rompe_nada(s, aldea):
    todos_presentes(s, aldea)
    rico(aldea)
    construccion.construir(s, aldea, "cuartel", 5, 40)
    guerra.reclutar(s, aldea, "lanceros", 8)
    guerra.lanzar(s, aldea, "vilanova", "someter", {"lanceros": 8})
    for _ in range(30):
        ciclo.adelantar_dia(s, aldea, real=INICIO)
        estado.recursos(aldea).update({"grano": max(200, estado.recursos(aldea)["grano"])})
    assert aldea.estado["dia"] >= 30 and aldea.estado.get("campana") is None
    assert aldea.estado["partes_guerra"]


# --- Reiniciar --------------------------------------------------------------------------------------

def test_reiniciar_deja_la_aldea_como_el_primer_dia_en_el_mismo_sitio(s, aldea):
    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 5)
    aldea.estado["dia"] = 40
    identificador = aldea.id
    fundacion.reiniciar(s, aldea, ahora=INICIO)
    assert aldea.id == identificador and aldea.estado["dia"] == 1 and "tropas" not in aldea.estado
    assert sorted(e.clave for e in estado.edificios(s, aldea)) == ["choza", "hoguera"]
    assert len(estado.aldeanos(s, aldea)) == 4 and len(guerra.asegurar(s, aldea)) == 8
    assert aldea.estado["tutorial"] == {"paso": 0, "activo": True, "oculto": False}


def test_los_textos_concuerdan_y_el_pronostico_no_engana(s, aldea):
    from sqlalchemy import select

    from aldea.modelos import Suceso

    con_cuartel(s, aldea)
    guerra.reclutar(s, aldea, "lanceros", 1)
    textos = [x.texto for x in s.scalars(select(Suceso).where(Suceso.aldea_id == aldea.id, Suceso.tipo == "guerra"))]
    assert textos[-1] == "Se alista un lancero. Ya hay un hombre en armas en Pedrafonte."
    assert estado.pulir("venció a la mesnada de el mayordomo Paio. el abad calla") == "Venció a la mesnada del mayordomo Paio. El abad calla"
    m = guerra.mapa(s, aldea)
    vilanova = next(t for t in m["territorios"] if t["clave"] == "vilanova")
    assert vilanova["fuerza"] == 10  # siete lanzas: los pastores cuentan por lo alto, nunca por lo bajo
    assert 0.8 <= m["moral"] <= 1.15 and vilanova["refuerzos"] == 0
    assert m["precios"] == {"regalo": 10, "relacion_alianza": 30, "rescate": 60}

