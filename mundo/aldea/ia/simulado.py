"""Motor de IA simulado: plantillas (mundo/datos/dialogos.yaml) y azar con semilla. Sin coste.

Hace el mismo papel que una IA de verdad: recibe el contexto, devuelve una propuesta. No toca el estado.
"""

from __future__ import annotations

import random
import re

from .. import datos


class _Huecos(dict):
    def __missing__(self, clave: str) -> str:
        return "…"


def _rellenar(texto: str, huecos: dict) -> str:
    try:
        return pulir(texto.format_map(_Huecos(huecos)).strip())
    except (ValueError, IndexError):
        return texto


def pulir(texto: str) -> str:
    """Contracciones que una plantilla no sabe hacer sola: «a el forastero» → «al forastero»."""
    return texto.replace(" a el ", " al ").replace(" de el ", " del ").replace("A el ", "Al ").replace("De el ", "Del ")


def _lista(nombres: list[str]) -> str:
    return nombres[0] if len(nombres) == 1 else ", ".join(nombres[:-1]) + " y " + nombres[-1]


def _cantidad(valor: float) -> str:
    return f"{round(valor):d}"


def _minuscula(texto: str) -> str:
    return texto[:1].lower() + texto[1:] if texto else texto


def _sin_punto(texto: str) -> str:
    return texto.rstrip(" .")


_CAMPOS_VECINO = {"a", "b", "aldeano", "origen", "sobre", "de"}


class MotorSimulado:
    nombre = "simulado"

    def __init__(self) -> None:
        self.d = datos.cargar("dialogos")
        self.tonos = datos.cargar("tonos") or {}

    # --- Escenas --------------------------------------------------------------------------------

    def escena(self, ctx: dict) -> dict:
        azar = random.Random(f"escena|{ctx.get('semilla')}")
        tema = ctx["tema"]
        gente = {p["clave"]: p for p in ctx["participantes"]}
        orden = [c for c in (tema.get("a"), tema.get("b")) if c in gente]
        orden += [c for c in gente if c not in orden]
        roles = dict(zip("abcd", orden, strict=False))
        plantillas = self.d["escenas"].get(tema["tipo"]) or self.d["escenas"]["tiempo"]
        # Mejor una plantilla en la que hablen todos los papeles que hay.
        utiles = [p for p in plantillas if sum(1 for rol, _ in p["lineas"] if rol in roles) >= 2] or plantillas
        plantilla = azar.choice(utiles)

        rumor_texto = None
        huecos = self._huecos_escena(ctx, roles, gente, azar)
        if ctx.get("rumor"):
            r = ctx["rumor"]
            cuenta = gente.get(r["de"], {})
            rumor_texto = self._deformar(r["texto"], cuenta.get("rasgos", []), azar)
            huecos["rumor"] = _sin_punto(rumor_texto)
            huecos["sobre"] = r["sobre"]["apodo"]

        lineas = []
        ya_muletilla: set[str] = set()
        for rol, texto in plantilla["lineas"]:
            if rol not in roles:
                continue
            clave = roles[rol]
            frase = _rellenar(texto, huecos)
            muletillas = (gente[clave].get("habla") or {}).get("muletillas") or []
            if muletillas and clave not in ya_muletilla and len(frase) < 90 and azar.random() < 0.15:
                frase = f"{azar.choice(muletillas)} {frase}"
                ya_muletilla.add(clave)
            lineas.append({"quien": clave, "texto": frase})
        coletillas = (self.tonos.get(ctx["aldea"].get("tono", "cuento")) or {}).get("coletillas") or []
        if coletillas and lineas and azar.random() < 0.5:
            lineas[-1]["texto"] = f"{lineas[-1]['texto']} {azar.choice(coletillas)}"

        cambios = []
        for c in plantilla.get("cambios", []):
            nuevo = {}
            for campo, valor in c.items():
                if campo in _CAMPOS_VECINO and campo != "tipo":
                    if valor not in roles:
                        nuevo = None
                        break
                    nuevo[campo] = roles[valor]
                elif isinstance(valor, str) and campo == "texto":
                    nuevo[campo] = _rellenar(valor, huecos)
                else:
                    nuevo[campo] = valor
            if nuevo:
                cambios.append(nuevo)
        return {"lineas": lineas, "cambios": cambios, "rumor_texto": rumor_texto}

    def _huecos_escena(self, ctx: dict, roles: dict, gente: dict, azar: random.Random) -> dict:
        aldea = ctx["aldea"]
        tema = ctx["tema"]
        huecos: dict = {
            "lugar": _minuscula(ctx.get("lugar", "la aldea")),
            "estacion": aldea.get("estacion_texto", "tiempo"),
            "aldea": aldea.get("nombre", "la aldea"),
            "frase_clima": azar.choice(self.d["clima"].get(aldea.get("clima", "nubes"), self.d["clima"]["nubes"])),
            "cantidad": tema.get("cantidad", "unas"),
            "fiesta": tema.get("fiesta", "la fiesta"),
            "suceso": tema.get("suceso", "Ha pasado algo."),
            "visitante": tema.get("visitante", "un forastero"),
        }
        for rol, clave in roles.items():
            p = gente[clave]
            huecos[rol] = p.get("apodo", p["nombre"])
            huecos[f"pulla_{rol}"] = azar.choice(self.d["pullas"].get(p["oficio"], ["mala sombra"]))
            huecos[f"queja_{rol}"] = azar.choice(self.d["quejas"].get(p["oficio"], ["Mucho trabajo y poca paga."]))
            huecos[f"o_{rol}"] = "a" if p.get("genero") == "f" else "o"
        return huecos

    # --- Rumores --------------------------------------------------------------------------------

    def deformar_rumor(self, ctx: dict) -> dict:
        azar = random.Random(f"rumor|{ctx.get('semilla')}")
        return {"texto": self._deformar(ctx["texto"], ctx.get("cuenta", {}).get("rasgos", []), azar)}

    def _deformar(self, texto: str, rasgos: list[str], azar: random.Random) -> str:
        """Hincha un rumor: sube una cifra, cambia una expresión por otra más gorda o le cuelga una cola."""
        tabla = self.d["rumores"]
        nuevo = _sin_punto(texto)
        for _ in range(2 if "exagerado" in rasgos else 1):
            hinchado = self._subir_cifra(nuevo, tabla["numeros"], azar)
            if hinchado == nuevo:
                hinchado = self._cambiar_expresion(nuevo, tabla["cambios"])
            if hinchado == nuevo:
                hinchado = self._colgar(nuevo, tabla["colas"], azar, list(tabla["colas"]) + list(tabla["colas_rasgo"].values()))
            nuevo = hinchado
        cola_rasgo = next((tabla["colas_rasgo"][r] for r in rasgos if r in tabla["colas_rasgo"]), None)
        todas = list(tabla["colas"]) + list(tabla["colas_rasgo"].values())
        if cola_rasgo and cola_rasgo not in nuevo and azar.random() < 0.4:
            nuevo = self._colgar(nuevo, [cola_rasgo], azar, todas)
        elif nuevo == _sin_punto(texto) or azar.random() < 0.3:
            nuevo = self._colgar(nuevo, tabla["colas"], azar, todas)
        while len(nuevo) > 236 and ", " in nuevo:  # si no cabe, se cae la última cola
            nuevo = nuevo[: nuevo.rindex(", ")]
        return nuevo[:236]

    @staticmethod
    def _subir_cifra(texto: str, escalera: list[str], azar: random.Random) -> str:
        hallados = [
            (m, i) for i, palabra in enumerate(escalera[:-1])
            for m in re.finditer(rf"\b{re.escape(palabra)}\b", texto, flags=re.IGNORECASE)
        ]
        if hallados:
            m, i = azar.choice(hallados)
            return texto[: m.start()] + escalera[min(len(escalera) - 1, i + azar.choice([1, 1, 2]))] + texto[m.end():]
        cifra = re.search(r"\b\d+\b", texto)
        if cifra:
            return texto[: cifra.start()] + str(int(cifra.group()) * 2) + texto[cifra.end():]
        return texto

    @staticmethod
    def _cambiar_expresion(texto: str, cambios: list[list[str]]) -> str:
        for de, a in cambios:
            if a in texto:
                continue
            m = re.search(rf"\b{re.escape(de)}\b", texto)
            if m:
                return texto[: m.start()] + a + texto[m.end():]
        return texto

    @staticmethod
    def _colgar(texto: str, colas: list[str], azar: random.Random, todas: list[str]) -> str:
        """Cuelga una coletilla. Como mucho lleva dos: si ya las tiene, la nueva sustituye a la última."""
        libres = [c for c in colas if c not in texto]
        if not libres:
            return texto
        puestas = sorted((c for c in todas if c in texto), key=texto.rindex)
        if len(puestas) >= 2:
            texto = texto.replace(puestas[-1], "", 1)
        return texto + azar.choice(libres)

    # --- Reflexión nocturna -----------------------------------------------------------------------

    def reflexion(self, ctx: dict) -> dict:
        tabla = self.d["reflexion"]
        reflexiones = []
        for a in ctx["aldeanos"]:
            azar = random.Random(f"reflexion|{ctx.get('semilla')}|{a['clave']}")
            if a.get("hambre", 0) > 0:
                tramo = "hambre"
            else:
                tramo = "alto" if a["animo"] >= 62 else "bajo" if a["animo"] < 40 else "medio"
            partes = [azar.choice(tabla["apertura"][tramo])]
            recuerdos = a.get("recuerdos_hoy") or []
            if recuerdos:
                partes.append(_rellenar(azar.choice(tabla["con_recuerdo"]), {"recuerdo": _minuscula(recuerdos[0])}))
            else:
                partes.append(azar.choice(tabla["sin_recuerdos"]))
            rasgo = next((r for r in a.get("rasgos", []) if r in tabla["cierre"]), "defecto")
            partes.append(tabla["cierre"][rasgo])
            cambios = []
            if tramo == "hambre":
                cambios.append({"tipo": "opinion_senor", "aldeano": a["clave"], "delta": -2})
            elif tramo == "alto":
                cambios.append({"tipo": "opinion_senor", "aldeano": a["clave"], "delta": 1})
            if a.get("dia_malo"):
                cambios.append({"tipo": "animo", "aldeano": a["clave"], "delta": -2})
            elif a.get("dia_bueno"):
                cambios.append({"tipo": "animo", "aldeano": a["clave"], "delta": 2})
            reflexiones.append({"aldeano": a["clave"], "texto": " ".join(partes)[:300], "cambios": cambios})
        return {"reflexiones": reflexiones}

    # --- Charla con el señor ----------------------------------------------------------------------

    def charla(self, ctx: dict) -> dict:
        azar = random.Random(f"charla|{ctx.get('semilla')}")
        tabla = self.d["charla"]
        a = ctx["aldeano"]
        mensaje = ctx["mensaje"].lower()
        respuestas = tabla["respuestas"]
        rasgos = set(a.get("rasgos", []))
        habla = a.get("habla") or {}
        huecos = {
            "saludo": habla.get("saludo", "Señor."),
            "muletilla": azar.choice(habla.get("muletillas") or ["Pues…"]),
            "queja": azar.choice(self.d["quejas"].get(a["oficio"], ["Se hace lo que se puede."])),
            "oficio": a.get("oficio_nombre", a["oficio"]),
            "objetivo": a.get("objetivo", "Vivir tranquilo."),
            "secreto": a.get("secreto", ""),
        }
        clave = a["clave"]
        cambios: list[dict] = []

        # ¿Pregunta por otro vecino?
        otro = next(
            (v for v in ctx.get("vecinos", []) if v["clave"] != clave and any(
                re.search(rf"\b{re.escape(n.lower())}\b", mensaje)
                for n in {v["nombre"].split()[0], v["apodo"], v["oficio_nombre"]} if len(n) > 2
            )),
            None,
        )
        intencion = next(
            (nombre for nombre, palabras in tabla["intenciones"].items() if any(p in mensaje for p in palabras)), None
        )
        if otro is not None and intencion not in ("secreto", "amenaza", "halago"):
            intencion = "sobre_otro"

        def elegir(nombre: str) -> str:
            return _rellenar(azar.choice(respuestas[nombre]), huecos)

        estado = ctx.get("estado", {})
        if intencion == "sobre_otro" and otro is not None:
            relacion = next((r for r in a.get("relaciones", []) if r["clave"] == otro["clave"]), {"valor": 0, "nota": ""})
            huecos["otro"] = otro["apodo"]
            huecos["nota"] = relacion.get("nota", "") if abs(relacion["valor"]) >= 30 and relacion.get("publica", True) else ""
            tramo = "sobre_bien" if relacion["valor"] >= 20 else "sobre_mal" if relacion["valor"] <= -20 else "sobre_regular"
            respuesta = elegir(tramo)
            rumor = next((r for r in a.get("rumores", []) if r["sobre"] == otro["clave"]), None)
            if rumor and a["opinion"] >= 15:
                respuesta += " " + _rellenar(azar.choice(respuestas["rumor_cuenta"]), {"rumor": _sin_punto(rumor["texto"])})
        elif intencion == "secreto":
            confianza = ctx.get("confianza", "niega")
            huecos["otro"] = (a.get("secreto_sobre") or {}).get("apodo", "alguien")
            respuesta = elegir({"revela": "secreto_revela", "pista": "secreto_pista"}.get(confianza, "secreto_niega"))
        elif intencion == "rumores":
            rumores = a.get("rumores", [])
            if not rumores:
                respuesta = elegir("rumor_nada")
            elif a["opinion"] < 0 or ("callado" in rasgos and a["opinion"] < 30):
                respuesta = elegir("rumor_calla")
            else:
                huecos["rumor"] = _sin_punto(azar.choice(rumores)["texto"])
                respuesta = elegir("rumor_cuenta")
        elif intencion == "hambre":
            dias = estado.get("dias_comida", 9)
            respuesta = elegir("hambre_mal" if a.get("hambre", 0) > 0 or dias < 2 else "hambre_justo" if dias < 6 else "hambre_bien")
        elif intencion == "impuestos":
            nivel = estado.get("impuestos", 1)
            respuesta = elegir("impuestos_bajo" if nivel <= 1 else "impuestos_medio" if nivel == 2 else "impuestos_alto")
        elif intencion == "trabajo":
            sitio = a.get("edificio_oficio") or {}
            if sitio.get("nombre") and not sitio.get("existe", True):
                huecos["edificio"] = _minuscula(sitio["nombre"])
                respuesta = elegir("trabajo_sin_sitio")
            else:
                respuesta = elegir("trabajo")
        elif intencion == "halago":
            respuesta = elegir("halago")
            cambios += [
                {"tipo": "opinion_senor", "aldeano": clave, "delta": 3},
                {"tipo": "animo", "aldeano": clave, "delta": 2},
            ]
        elif intencion == "amenaza":
            respuesta = elegir("amenaza_orgulloso" if "orgulloso" in rasgos or "terco" in rasgos else "amenaza_miedoso" if "miedoso" in rasgos else "amenaza")
            cambios += [
                {"tipo": "opinion_senor", "aldeano": clave, "delta": -6},
                {"tipo": "animo", "aldeano": clave, "delta": -4},
                {"tipo": "recuerdo", "aldeano": clave, "texto": "El señor me habló con malos modos. No se me olvida.", "importancia": 6},
            ]
        elif intencion == "deseo":
            respuesta = elegir("deseo")
        elif intencion == "amor":
            respuesta = elegir("amor")
        elif intencion == "senor":
            respuesta = elegir("senor_bien" if a["opinion"] >= 30 else "senor_mal" if a["opinion"] < -5 else "senor_regular")
        elif intencion == "estado":
            respuesta = elegir(
                "estado_hambre" if a.get("hambre", 0) > 0 else
                "estado_alto" if a["animo"] >= 62 else "estado_bajo" if a["animo"] < 40 else "estado_medio"
            )
        elif intencion == "despedida":
            respuesta = elegir("despedida")
        elif intencion == "saludo":
            respuesta = elegir("saludo")
        else:
            intencion = "otra"
            respuesta = elegir("defecto")
        if not any(c["tipo"] == "recuerdo" for c in cambios) and intencion not in ("saludo", "despedida", "otra"):
            cambios.append({
                "tipo": "recuerdo", "aldeano": clave, "importancia": 3,
                "texto": f"El señor vino a hablar conmigo. Me dijo: «{ctx['mensaje'].strip()[:120]}»",
            })
        return {"respuesta": respuesta, "intencion": intencion, "cambios": cambios}

    # --- Crónica del escriba ----------------------------------------------------------------------

    def cronica(self, ctx: dict) -> dict:
        azar = random.Random(f"cronica|{ctx.get('semilla')}")
        aldea = ctx["aldea"]
        tono = (self.tonos.get(aldea.get("tono", "cuento")) or self.tonos.get("cuento") or {}).get("cronica", {})
        b = ctx.get("balance") or {}
        g = ctx.get("gobierno", {})
        huecos = {"aldea": aldea["nombre"], "fecha": ctx.get("fecha_texto", ""), "dia": aldea.get("dia", 1)}
        parrafos = [_rellenar(azar.choice(tono.get("apertura", ["En {aldea}, a {fecha}."])), huecos)]

        frases_clima = {
            "despejado": "Amaneció claro y así siguió.", "nubes": "Día de nubes, de los que no se comprometen.",
            "lluvia": "Llovió, que es lo suyo.", "niebla": "Hubo niebla espesa, de la que se queda a vivir.",
            "tormenta": "Tronó de firme y más de uno durmió con la manta por la cabeza.",
            "nieve": "Nevó, y el valle amaneció callado y blanco.",
        }
        cuerpo = [frases_clima.get(b.get("clima", ""), "El tiempo hizo lo que quiso.")]
        producido = b.get("producido") or {}
        nombres = {"grano": "grano", "madera": "madera", "piedra": "piedra", "harina": "harina", "pan": "pan", "oro": "oro"}
        if producido:
            lista = _lista([f"{_cantidad(valor)} de {nombres.get(k, k)}" for k, valor in producido.items() if valor >= 0.5] or ["poca cosa"])
            if lista:
                cuerpo.append(f"Se sacó adelante la faena: {lista}.")
        else:
            cuerpo.append("De producir, hoy no se produjo nada que merezca tinta.")
        if b.get("hambrientos"):
            n = b["hambrientos"]
            cuerpo.append(f"{'Un vecino se acostó' if n == 1 else f'{n} vecinos se acostaron'} sin cenar, y eso no se arregla con discursos.")
        elif g.get("dias_comida", 9) < 4:
            cuerpo.append("Se comió, pero la despensa empieza a sonar a hueco.")
        else:
            cuerpo.append("Se cenó caliente en todas las casas.")
        if b.get("frio"):
            cuerpo.append("Faltó leña y se pasó frío del que cala.")
        if b.get("sin_techo"):
            n = b["sin_techo"]
            cuerpo.append(f"{'Uno duerme' if n == 1 else f'{n} duermen'} todavía al raso, arrimados a la lumbre.")
        oro = (b.get("oro") or {}).get("oro", 0)
        if oro:
            cuerpo.append(f"Entraron {_cantidad(oro)} monedas en el arca de vuestra merced.")
        for nombre in b.get("llegan", []):
            cuerpo.append(f"Llegó {nombre} por el camino, y ya somos uno más a repartir y a opinar.")
        for nombre in b.get("se_van", []):
            cuerpo.append(f"{nombre} se marchó valle abajo. Mala señal cuando la gente prefiere el camino.")
        parrafos.append(" ".join(cuerpo))

        sucesos = [s for s in ctx.get("sucesos", []) if s][:5]
        if sucesos:
            parrafos.append("Sucedidos del día: " + " ".join(s if s.endswith((".", "!", "?")) else s + "." for s in sucesos))
        escenas = ctx.get("escenas", [])
        if escenas:
            frases = []
            for e in escenas[:3]:
                nombres_e = _lista(e["nombres"][:2] + (["alguno más"] if len(e["nombres"]) > 2 else []))
                como = {
                    "rivalidad": "tuvieron palabras", "deuda": "hablaron de dineros, que es hablar de penas",
                    "rumor": "cuchichearon más de la cuenta", "amor_solos": "se cruzaron, por pura casualidad según ellos",
                    "amor_disimulo": "disimularon con poco arte", "hambre": "se quejaron del hambre, con razón",
                    "impuestos": "murmuraron de los tributos", "fiesta": "celebraron como es debido",
                    "amistad": "se hicieron compañía", "senor_mal": "hablaron de vuestra merced, y no os gustaría",
                    "senor_bien": "hablaron bien de vuestra merced, que conste",
                }.get(e["tema"], "echaron un rato de charla")
                frases.append(pulir(f"{nombres_e} {como} en {_minuscula(e['lugar'])}."))
            parrafos.append("De puertas afuera: " + " ".join(frases))
        decisiones = ctx.get("decisiones", [])
        if decisiones:
            parrafos.append("En el consejo: " + " ".join(decisiones[:3]))
        parrafos.append(azar.choice(tono.get("cierre", ["Y con esto doy fe."])))

        opiniones = self._opiniones(ctx, azar)
        return {"texto": "\n\n".join(parrafos), "opiniones": opiniones}

    @staticmethod
    def _opiniones(ctx: dict, azar: random.Random) -> list[str]:
        """Lo que el escriba piensa del gobierno del señor, según cómo va la aldea de verdad."""
        g = ctx.get("gobierno", {})
        b = ctx.get("balance") or {}
        opiniones: list[str] = []
        if b.get("hambrientos"):
            opiniones.append("Con el debido respeto: una aldea con hambre no escucha razones. Antes pan que murallas.")
        elif g.get("dias_comida", 9) < 4:
            opiniones.append("Dicho sea sin alarmar: queda comida para muy pocos días. Yo sembraría, o compraría, o rezaría; por ese orden.")
        elif g.get("dias_comida", 0) >= 12:
            opiniones.append("La despensa está como para presumir. Lo apunto para que conste que alguna vez fue así.")
        nivel = g.get("impuestos", 1)
        if nivel >= 3:
            opiniones.append("Los tributos aprietan. Lo sé porque me lo dicen a mí, que soy quien los apunta, como si la pluma tuviese la culpa.")
        elif nivel == 0:
            opiniones.append("Sin tributos el pueblo os quiere mucho y el arca os quiere poco. Vos veréis qué amor preferís.")
        if b.get("sin_techo", 0) >= 2:
            opiniones.append("Hay gente durmiendo al raso. Una casa se levanta en un día y una mala fama dura años.")
        if g.get("revuelta", {}).get("activa"):
            opiniones.append("Hay revuelta, señor. No lo escribo más grande porque no me cabe en el pliego.")
        elif g.get("tension", 0) >= 60:
            opiniones.append("El ambiente está como un odre demasiado lleno. Yo, de vos, soltaría algo de presión antes de que reviente.")
        elif g.get("opinion_media", 0) >= 35:
            opiniones.append("La gente habla bien de vuestra merced, lo cual me deja sin apenas material.")
        elif g.get("opinion_media", 0) <= -20:
            opiniones.append("Os lo digo por escrito porque de palabra no me atrevo: el pueblo murmura, y no bajito.")
        if g.get("poblacion", 0) <= 4 and g.get("dia", 1) > 5:
            opiniones.append("Seguimos siendo cuatro gatos. Sin casas no viene nadie, y sin gente esto no es aldea sino merienda.")
        if not opiniones:
            opiniones.append(azar.choice([
                "Hoy no tengo queja, y me inquieta. Mañana buscaré mejor.",
                "Gobernáis sin estruendo, que es como menos se rompe.",
                "Nada que objetar. Lo anoto con cierta decepción profesional.",
            ]))
        if not ctx.get("escriba", {}).get("presente", True):
            opiniones = ["(El escriba no está en la aldea; esto lo apunta quien quedó con la pluma, con peor letra.)"] + opiniones
        return opiniones[:4]

    # --- Mensajes de fuera ------------------------------------------------------------------------

    def mensaje(self, ctx: dict) -> dict:
        azar = random.Random(f"mensaje|{ctx.get('semilla')}")
        plantillas = ctx.get("plantillas") or ["{remitente} os manda saludos."]
        return {"texto": _rellenar(azar.choice(plantillas), ctx.get("huecos", {}))}
