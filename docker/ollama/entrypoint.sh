#!/bin/sh
# Warm-up entrypoint pre Ollamu (rozhodnutie #137). Vlastník P5.
#
# Stiahne modely, ktoré appka reálne používa, a jeden krátky dopyt ich zahreje,
# aby prvá odpoveď v chate nečakala na load z NVMe. Beh je idempotentný —
# `ollama pull` už stiahnutý model preskočí.
#
# ZAPOJENIE (patch pre integrátora, `docker-compose.yml` je zdieľaný súbor):
#
#   ollama:
#     image: ollama/ollama:latest
#     entrypoint: ["/bin/sh", "/entrypoint.sh"]
#     volumes:
#       - ./docker/ollama/entrypoint.sh:/entrypoint.sh:ro
#       - ollamadata:/root/.ollama
#
# Bez patchu beží Ollama s pôvodným entrypointom a modely sa načítajú pri prvom
# dopyte — appka funguje, len prvá odpoveď je pomalšia.

set -e

# Modely musia zodpovedať config/llm.php. qwen3:4b = router (100 % presnosť v SK),
# bge-m3 = embeddingy (nulový prekryv SK↔EN). Merania: docs/BENCHMARK-LLM.md.
MODELS="${AURAAI_OLLAMA_MODELS:-qwen3:4b bge-m3}"

/bin/ollama serve &
OLLAMA_PID=$!

# Server je hore, keď odpovie na /api/tags. 60 × 2 s = 2 min strop, potom sa
# warm-up preskočí — nikdy neblokuje štart kontajnera.
i=0
while [ "$i" -lt 60 ]; do
    if /bin/ollama list >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 2
done

for model in $MODELS; do
    echo "[ollama warm-up] pull $model"
    /bin/ollama pull "$model" || echo "[ollama warm-up] pull $model zlyhal — pokračujem"
done

# Zahriatie: jeden krátky dopyt na generatívny model naplní KV cache a
# `keep_alive` ho podrží v RAM. Zlyhanie sa ignoruje.
FIRST_MODEL=$(echo "$MODELS" | awk '{print $1}')
if [ -n "$FIRST_MODEL" ]; then
    echo "[ollama warm-up] rozohrievam $FIRST_MODEL"
    /bin/ollama run "$FIRST_MODEL" "ok" >/dev/null 2>&1 || true
fi

echo "[ollama warm-up] hotovo"

wait "$OLLAMA_PID"
