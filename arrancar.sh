#!/bin/bash
# Arranca Pedrafonte en este Mac: base de datos, mundo y juego.
#   ./arrancar.sh              arranca todo y abre el navegador
#   ./arrancar.sh --sin-abrir  lo mismo, sin abrir el navegador
#   ./arrancar.sh parar        para el mundo y el juego (la base de datos se queda)
set -euo pipefail
cd "$(dirname "$0")"

PUERTO_MUNDO=8765
PUERTO_JUEGO=5173
mkdir -p datos-locales

parar() {
  for f in datos-locales/mundo.pid datos-locales/juego.pid; do
    if [ -f "$f" ]; then kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; fi
  done
}

if [ "${1:-}" = "parar" ]; then parar; echo "Parado."; exit 0; fi

if [ ! -f .env ]; then
  echo "Falta .env. Cópialo de .env.ejemplo y pon una contraseña:  cp .env.ejemplo .env"; exit 1
fi
if [ ! -d juego/public/modelos ] || [ -z "$(ls juego/public/modelos/*.glb 2>/dev/null)" ]; then
  echo "Faltan los modelos optimizados. Mira assets/LEEME.md y ejecuta:  node herramientas/optimizar-modelos.mjs"
fi

parar

if grep -q '^ALDEA_BD_URL=postgresql' .env; then
  if docker info >/dev/null 2>&1; then
    docker compose -f docker-compose.local.yml up -d --wait bd
  else
    echo "Docker no está arrancado y .env pide PostgreSQL."
    echo "Arranca Docker, o cambia en .env:  ALDEA_BD_URL=sqlite:///datos-locales/aldea.sqlite"; exit 1
  fi
fi

[ -d mundo/.venv ] || (cd mundo && uv venv --python 3.12 .venv && uv pip install -p .venv/bin/python -e ".[dev]")
[ -d juego/node_modules ] || (cd juego && npm install)

for puerto in $PUERTO_MUNDO $PUERTO_JUEGO; do
  if lsof -iTCP:"$puerto" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "El puerto $puerto ya está ocupado por otro programa. Ciérralo (o ./arrancar.sh parar) y vuelve a probar."; exit 1
  fi
done

# Cada servidor en segundo plano, con su registro y su número de proceso (para poder pararlo luego).
cd mundo
nohup .venv/bin/uvicorn aldea.api.app:app --host 127.0.0.1 --port $PUERTO_MUNDO > ../datos-locales/mundo.log 2>&1 < /dev/null &
echo $! > ../datos-locales/mundo.pid
cd ../juego
nohup node_modules/.bin/vite --port $PUERTO_JUEGO --strictPort > ../datos-locales/juego.log 2>&1 < /dev/null &
echo $! > ../datos-locales/juego.pid
cd ..

LISTO=no
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PUERTO_MUNDO/api/salud" >/dev/null && curl -sf "http://127.0.0.1:$PUERTO_JUEGO/" >/dev/null; then LISTO=si; break; fi
  sleep 0.5
done
if [ "$LISTO" != si ]; then
  echo "Algo no ha arrancado. Mira datos-locales/mundo.log y datos-locales/juego.log"; exit 1
fi

echo "Mundo:  http://127.0.0.1:$PUERTO_MUNDO/api/salud   (registro en datos-locales/mundo.log)"
echo "Juego:  http://127.0.0.1:$PUERTO_JUEGO              (registro en datos-locales/juego.log)"
if [ "${1:-}" != "--sin-abrir" ]; then open "http://127.0.0.1:$PUERTO_JUEGO" 2>/dev/null || true; fi
