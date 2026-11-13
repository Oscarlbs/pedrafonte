"""La API de punta a punta, sobre SQLite y con migraciones de Alembic: el camino «sin Docker»."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aldea import bd


@pytest.fixture(scope="module")
def cliente(tmp_path_factory):
    ruta = tmp_path_factory.mktemp("bd") / "aldea.sqlite"
    mp = pytest.MonkeyPatch()
    mp.setenv("ALDEA_BD_URL", f"sqlite:///{ruta}")
    mp.setenv("ALDEA_MOTOR_IA", "simulado")
    bd._motor = bd._fabrica = None
    from aldea.api.app import app

    with TestClient(app) as c:
        yield c
    bd._motor = bd._fabrica = None
    mp.undo()


def test_al_arrancar_hay_migraciones_y_una_aldea_fundada(cliente):
    assert cliente.get("/api/salud").json() == {"ok": True, "motor_ia": "simulado"}
    aldeas = cliente.get("/api/aldeas").json()
    assert [a["nombre"] for a in aldeas] == ["Pedrafonte"]
    estado = cliente.get("/api/aldeas/1").json()
    assert estado["pergamino"] == {"pendiente": True, "dia": 0}  # la primera hoja del escriba espera al señor
    assert "Primera hoja" in cliente.get("/api/aldeas/1/pergamino").json()["cronica"]["texto"]
    assert len(estado["consejo"]) == 2  # y ya hay quien pide audiencia
    assert {"aldea", "tiempo", "clima", "recursos", "poblacion", "gobierno", "edificios", "aldeanos", "consejo",
            "mensajes", "visitantes", "escenas", "pergamino", "vecinos", "balance"} <= set(estado)
    assert len(estado["aldeanos"]) == 4 and all("sitio" in a for a in estado["aldeanos"])
    assert sorted(e["clave"] for e in estado["edificios"]) == ["choza", "hoguera"]
    assert len(estado["vecinos"]) == 8


def test_configuracion_para_el_juego(cliente):
    config = cliente.get("/api/config").json()
    assert len(config["catalogo"]) >= 30 and {"valle", "ribera", "montana", "bosque"} <= set(config["paisajes"])
    assert set(config["tonos"]) == {"cuento", "crudo", "fantasia", "comedia"}
    assert config["ubicacion"]["nombre"].startswith("Vigo")
    assert cliente.get("/api/clima").json()["origen"] == "simulado"  # en las pruebas no hay red


def test_construir_girar_derribar_y_errores_claros(cliente):
    r = cliente.post("/api/aldeas/1/construir", json={"clave": "casa", "cx": 26, "cz": 16})
    assert r.status_code == 200 and r.json()["recursos"]["madera"] == 29
    casa = r.json()["construidos"][0]
    assert cliente.post("/api/aldeas/1/comprobar", json={"clave": "casa", "cx": 26, "cz": 16}).json() == {
        "valido": False, "motivo": "Ese sitio ya está ocupado."}
    r = cliente.post("/api/aldeas/1/construir", json={"clave": "molino", "cx": 10, "cz": 10})
    assert r.status_code == 409 and "orilla" in r.json()["detail"]
    r = cliente.post("/api/aldeas/1/construir", json={"clave": "camino", "celdas": [[24, 20], [24, 21], [26, 16]]})
    assert len(r.json()["construidos"]) == 2 and len(r.json()["fallos"]) == 1  # arrastre: lo que cabe, cabe
    assert cliente.post("/api/aldeas/1/girar", json={"id": casa["id"]}).json()["rot"] == 1
    assert cliente.post("/api/aldeas/1/derribar", json={"id": casa["id"]}).json()["devuelto"] == {"madera": 8, "piedra": 2}
    assert cliente.post("/api/aldeas/99/construir", json={"clave": "casa", "cx": 1, "cz": 1}).status_code == 404


def test_adelantar_un_dia_trae_consejo_cronica_y_pergamino(cliente):
    cliente.post("/api/aldeas/1/construir", json={"clave": "campo", "cx": 10, "cz": 20})
    r = cliente.post("/api/aldeas/1/adelantar").json()
    assert r["resumen"] == {"horas": 24, "dias": 1}
    estado = r["estado"]
    assert estado["tiempo"]["desfase_dias"] == 1 and estado["balance"]["producido"]
    assert 1 <= len(estado["consejo"]) <= 3 and estado["pergamino"]["pendiente"]
    pergamino = cliente.get("/api/aldeas/1/pergamino").json()
    assert "Pedrafonte" in pergamino["cronica"]["texto"] and pergamino["cronica"]["opiniones"]
    cliente.post("/api/aldeas/1/pergamino/leido")
    assert not cliente.get("/api/aldeas/1").json()["pergamino"]["pendiente"]
    peticion = estado["consejo"][0]
    opcion = next(o for o in peticion["opciones"] if o["disponible"])
    r = cliente.post(f"/api/aldeas/1/consejo/{peticion['id']}", json={"opcion": opcion["clave"]}).json()
    assert r["peticion"]["estado"] == "resuelta" and r["peticion"]["resultado"]
    assert len(cliente.get("/api/aldeas/1/sucesos").json()) >= 3
    assert len(cliente.get("/api/aldeas/1/cronicas").json()) == 2  # la hoja de bienvenida y la del primer día


def test_hablar_con_un_vecino_y_ver_su_ficha(cliente):
    viuda = next(a for a in cliente.get("/api/aldeas/1").json()["aldeanos"] if a["clave"] == "viuda")
    ficha = cliente.get(f"/api/aldeas/1/aldeanos/{viuda['id']}").json()
    assert ficha["caracter"] and ficha["objetivo"] and ficha["secreto"] is None  # el secreto no se enseña
    assert ficha["relaciones"] and ficha["recuerdos"]
    r = cliente.post(f"/api/aldeas/1/aldeanos/{viuda['id']}/charla", json={"texto": "Buenos días, doña Aldonza"}).json()
    assert "Dios os guarde" in r["respuesta"] and r["ficha"]["id"] == viuda["id"]
    assert cliente.post(f"/api/aldeas/1/aldeanos/{viuda['id']}/charla", json={"texto": ""}).status_code == 422


def test_tributos_y_leyes(cliente):
    estado = cliente.post("/api/aldeas/1/impuestos", json={"nivel": 3}).json()
    assert estado["gobierno"]["impuestos_nombre"] == "Gravoso"
    estado = cliente.post("/api/aldeas/1/leyes", json={"clave": "racionamiento", "activa": True}).json()
    assert estado["gobierno"]["leyes"] == ["racionamiento"]
    assert cliente.post("/api/aldeas/1/leyes", json={"clave": "diezmo", "activa": True}).status_code == 409
    assert cliente.post("/api/aldeas/1/impuestos", json={"nivel": 7}).status_code == 422


def test_varias_aldeas_independientes_con_su_paisaje_tono_y_dificultad(cliente):
    nueva = cliente.post("/api/aldeas", json={"nombre": "Penalba", "paisaje": "montana", "tono": "comedia", "dificultad": "dificil"}).json()
    assert nueva["id"] == 2 and nueva["tono"] == "comedia"
    una, otra = cliente.get("/api/aldeas/1").json(), cliente.get("/api/aldeas/2").json()
    assert otra["recursos"]["grano"] == 49 and otra["aldea"]["paisaje"] == "montana"  # 70 × 0,7
    assert len(otra["edificios"]) == 2 and len(una["edificios"]) > 2  # lo construido en una no aparece en otra
    assert otra["gobierno"]["impuestos"] == 1 and una["gobierno"]["impuestos"] == 3
    assert {a["id"] for a in una["aldeanos"]}.isdisjoint({a["id"] for a in otra["aldeanos"]})
    assert otra["edificios"][0]["cx"] == 33  # la choza está donde dice el paisaje de montaña
    assert cliente.delete("/api/aldeas/2").json() == {"ok": True}
    assert cliente.delete("/api/aldeas/1").status_code == 409  # la última no se puede abandonar


def test_el_websocket_cuenta_lo_que_pasa(cliente):
    with cliente.websocket_connect("/ws/1") as ws:
        r = cliente.post("/api/aldeas/1/construir", json={"clave": "valla", "cx": 10, "cz": 40})
        assert r.status_code == 200
        eventos = ws.receive_json()["eventos"]
    assert any(e["tipo"] == "edificio" and e["accion"] == "construido" for e in eventos)


def test_tutorial_mapa_tropas_y_campana_por_la_api(cliente):
    nueva = cliente.post("/api/aldeas", json={"nombre": "Lanzada"}).json()
    base = f"/api/aldeas/{nueva['id']}"
    estado = cliente.get(base).json()
    assert estado["tutorial"]["clave"] == "mirar" and estado["tutorial"]["manual"]
    estado = cliente.post(f"{base}/tutorial", json={"orden": "entendido"}).json()["estado"]
    assert estado["tutorial"]["clave"] == "choza" and estado["tutorial"]["paso"] == 2
    assert cliente.post(f"{base}/tutorial", json={"orden": "bailar"}).status_code == 409
    mundo = cliente.get(f"{base}/mundo").json()
    assert len(mundo["territorios"]) == 8 and mundo["aldea"]["titulo"] == "Señor" and mundo["paz_hasta"] == 14
    assert cliente.post(f"{base}/tropas", json={"unidad": "lanceros", "cantidad": 2}).status_code == 409  # sin cuartel
    r = cliente.post(f"{base}/tropas", json={"unidad": "milicia", "cantidad": 2}).json()
    assert r["mundo"]["tropas"]["milicia"] == 2 and r["estado"]["guerra"]["tropas"] == 2
    r = cliente.post(f"{base}/mundo/vilanova", json={"accion": "regalo"}).json()
    assert "presente" in r["texto"] and r["estado"]["recursos"]["oro"] == 10
    r = cliente.post(f"{base}/campana", json={"vecino": "vilanova", "objetivo": "saquear", "tropas": {"milicia": 2}}).json()
    assert r["mundo"]["campana"]["fase"] == "ida" and r["estado"]["guerra"]["campana"]["nombre"] == "Vilanova do Souto"
    assert cliente.post(f"{base}/campana", json={"vecino": "meiras", "objetivo": "saquear", "tropas": {"milicia": 1}}).status_code == 409
    # Reiniciar: mismo sitio, primer día, sin tropa ni campaña, con el tutorial desde el principio.
    estado = cliente.post(f"{base}/reiniciar").json()["estado"]
    assert estado["aldea"]["id"] == nueva["id"] and estado["aldea"]["nombre"] == "Lanzada"
    assert estado["guerra"]["tropas"] == 0 and estado["guerra"]["campana"] is None and estado["tutorial"]["paso"] == 1
    assert estado["tiempo"]["dia"] == 1 and len(estado["edificios"]) == 2 and estado["pergamino"]["pendiente"]
    assert cliente.delete(base).json() == {"ok": True}
