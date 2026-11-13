"""Evaluador seguro de condiciones escritas en los YAML (peticiones, sucesos, fiestas…).

Admite comparaciones, `and`/`or`/`not`, sumas y restas, números, textos y nombres de variables:
    "dias_comida < 4 and poblacion >= 6"
    "estacion == 'invierno' and not tiene_granero"
Nada de llamadas ni atributos: lo que no sea eso, lanza ValueError.
"""

from __future__ import annotations

import ast
import operator
from functools import lru_cache
from typing import Any

_COMPARA = {
    ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge,
    ast.Eq: operator.eq, ast.NotEq: operator.ne,
    ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
}
_OPERA = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
}


@lru_cache(maxsize=512)
def _arbol(texto: str) -> ast.expr:
    return ast.parse(texto.strip(), mode="eval").body


def _evaluar(nodo: ast.AST, variables: dict[str, Any]) -> Any:
    if isinstance(nodo, ast.Constant) and isinstance(nodo.value, (int, float, str, bool)):
        return nodo.value
    if isinstance(nodo, ast.Name):
        # Variable desconocida = 0/falso: así un YAML puede preguntar por edificios que aún no existen.
        return variables.get(nodo.id, 0)
    if isinstance(nodo, ast.BoolOp):
        valores = (_evaluar(v, variables) for v in nodo.values)
        return all(valores) if isinstance(nodo.op, ast.And) else any(valores)
    if isinstance(nodo, ast.UnaryOp) and isinstance(nodo.op, ast.Not):
        return not _evaluar(nodo.operand, variables)
    if isinstance(nodo, ast.UnaryOp) and isinstance(nodo.op, ast.USub):
        return -_evaluar(nodo.operand, variables)
    if isinstance(nodo, ast.BinOp) and type(nodo.op) in _OPERA:
        return _OPERA[type(nodo.op)](_evaluar(nodo.left, variables), _evaluar(nodo.right, variables))
    if isinstance(nodo, ast.Compare):
        izquierda = _evaluar(nodo.left, variables)
        for op, derecha_nodo in zip(nodo.ops, nodo.comparators, strict=True):
            derecha = _evaluar(derecha_nodo, variables)
            if type(op) not in _COMPARA or not _COMPARA[type(op)](izquierda, derecha):
                return False
            izquierda = derecha
        return True
    if isinstance(nodo, (ast.List, ast.Tuple)):
        return [_evaluar(e, variables) for e in nodo.elts]
    raise ValueError(f"Expresión no permitida en condición: {ast.dump(nodo)[:80]}")


def cumple(condicion: str | None, variables: dict[str, Any]) -> bool:
    """True si la condición (texto) se cumple. Una condición vacía siempre se cumple."""
    if condicion is None or str(condicion).strip() == "":
        return True
    return bool(_evaluar(_arbol(str(condicion)), variables))
