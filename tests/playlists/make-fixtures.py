"""Genera los archivos de prueba en tests/playlists/fixtures (no se suben al repositorio).

  audio/  seis WAV de 1 segundo (las escuchas cuentan al pasar la mitad)
  imgs/   portada.jpg (~0,9 MB), enorme.png (~20 MB, imagen real decodificable),
          foto01..16.jpg y falsa.jpg (texto con extensión .jpg)
Requiere Pillow.  Uso:  python3 make-fixtures.py
"""
import os, random, struct
from PIL import Image, ImageDraw

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(os.path.join(here, 'audio'), exist_ok=True)
os.makedirs(os.path.join(here, 'imgs'), exist_ok=True)

def wav(name, extra):
    sr = 8000; n = sr + extra
    with open(os.path.join(here, 'audio', name), 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + n) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr, 1, 8) + b'data' + struct.pack('<I', n) + bytes([128]) * n)

for i, name in enumerate(['rosalia - despecha.wav', 'Bad Bunny, Jhay Cortez - Dakiti.wav', 'Jhay Cortez, Bad Bunny - DÁKITI.wav',
                          'Otro - Única (Live).wav', 'Track 01.wav', 'Track 01 .wav']):
    wav(name, 145 + i)

random.seed(1)
w = 1400
im = Image.new('RGB', (w, w)); d = ImageDraw.Draw(im)
for y in range(w):
    t = y / w
    d.line([(0, y), (w, y)], fill=(int(230 - 120 * t), int(110 - 60 * t), int(60 + 140 * t)))
for _ in range(400):
    x0, y0 = random.randrange(w - 50), random.randrange(w - 50)
    d.ellipse([x0, y0, x0 + random.randrange(5, 300), y0 + random.randrange(5, 300)], outline=(255, 255, 255))
im.save(os.path.join(here, 'imgs', 'portada.jpg'), quality=92)
Image.frombytes('RGB', (2600, 2600), os.urandom(2600 * 2600 * 3)).save(os.path.join(here, 'imgs', 'enorme.png'))
for i in range(16):
    Image.new('RGB', (600, 750), ((i * 53) % 255, (i * 97) % 255, (i * 31) % 255)).save(os.path.join(here, 'imgs', f'foto{i + 1:02d}.jpg'), quality=85)
open(os.path.join(here, 'imgs', 'falsa.jpg'), 'w').write('esto no es una imagen')
print('Archivos de prueba en', here)
