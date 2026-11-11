"""Генерация тестовых PDF: скан с фото, текстовый документ, зашифрованный и повреждённый файлы."""
import io, os, subprocess, sys, random
from PIL import Image, ImageDraw, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

out = sys.argv[1] if len(sys.argv) > 1 else 'tests/.tmp/fixtures'
os.makedirs(out, exist_ok=True)
random.seed(1)

def photo(w, h, seed):
    random.seed(seed)
    img = Image.new('RGB', (w // 8, h // 8))
    d = ImageDraw.Draw(img)
    for _ in range(60):
        x, y = random.randrange(w // 8), random.randrange(h // 8)
        r = random.randrange(10, 120)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randrange(256), random.randrange(256), random.randrange(256)))
    img = img.filter(ImageFilter.GaussianBlur(6)).resize((w, h), Image.BICUBIC)
    # «шум сканера»
    noise = Image.effect_noise((w, h), 18).convert('RGB')
    return Image.blend(img, noise, 0.12)

# 1. Скан: 300 DPI A4 цветные страницы
c = canvas.Canvas(f'{out}/scan.pdf', pagesize=A4)
for p in range(4):
    im = photo(2480, 3508, p)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=92); buf.seek(0)
    c.drawImage(ImageReader(buf), 0, 0, width=A4[0], height=A4[1])
    c.showPage()
c.save()

# 2. Текстовый документ, 12 страниц
c = canvas.Canvas(f'{out}/text.pdf', pagesize=A4)
for p in range(12):
    c.setFont('Helvetica-Bold', 28); c.drawString(72, 760, f'Page {p + 1}')
    c.setFont('Helvetica', 11)
    for i in range(40):
        c.drawString(72, 720 - i * 16, f'Line {i}: lorem ipsum dolor sit amet, consectetur adipiscing elit {p}-{i}')
    c.showPage()
c.save()

# 3. Зашифрованный (пароль на открытие: secret)
subprocess.run(['qpdf', '--encrypt', 'secret', 'owner', '256', '--', f'{out}/text.pdf', f'{out}/locked.pdf'], check=True)

# 4. Повреждённый
with open(f'{out}/broken.pdf', 'wb') as f:
    f.write(b'%PDF-1.7\n' + os.urandom(4096))

# 5. Папка с вложенными файлами
os.makedirs(f'{out}/folder/sub', exist_ok=True)
import shutil
shutil.copy(f'{out}/text.pdf', f'{out}/folder/a.pdf')
shutil.copy(f'{out}/text.pdf', f'{out}/folder/sub/b.pdf')
open(f'{out}/folder/readme.txt', 'w').write('not a pdf')
print('ok')

# 6. Реалистичный скан документа: текст на «бумаге», 300 DPI, JPEG 85%
from PIL import ImageFont
def doc_scan(seed):
    random.seed(seed)
    w, h = 2480, 3508
    img = Image.new('RGB', (w, h), (246, 244, 236))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', 42)
    except Exception:
        font = ImageFont.load_default()
    y = 200
    while y < h - 250:
        line = ' '.join(''.join(random.choice('абвгдежзиклмнопрстуфхцчшщэюя') for _ in range(random.randint(2, 9))) for _ in range(random.randint(6, 11)))
        d.text((200, y), line, fill=(30, 30, 40), font=font)
        y += 64
    d.rectangle([1500, 2900, 2200, 3300], outline=(20, 60, 160), width=6)
    noise = Image.effect_noise((w, h), 10).convert('RGB')
    return Image.blend(img, noise, 0.06).filter(ImageFilter.GaussianBlur(0.6))

c = canvas.Canvas(f'{out}/docscan.pdf', pagesize=A4)
for p in range(3):
    buf = io.BytesIO(); doc_scan(p).save(buf, 'JPEG', quality=85); buf.seek(0)
    c.drawImage(ImageReader(buf), 0, 0, width=A4[0], height=A4[1])
    c.showPage()
c.save()
print('docscan ok')
