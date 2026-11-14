#!/bin/sh
# Audio de prueba para el emulador (no se sube al repositorio): silencio largo para los «directos»
# y una canción corta para los catálogos. Requiere ffmpeg.
cd "$(dirname "$0")" && mkdir -p fixtures
ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=8000:cl=mono -t 900 -b:a 8k fixtures/silence-long.mp3
ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=8000:cl=mono -t 20 -b:a 8k fixtures/silence-short.mp3
echo "Audio de prueba en $(pwd)/fixtures"
