"""Gera os ícones da PWA a partir da marca do Voa Aí (docs/10 e docs/11):
arco tracejado em céu (#5CC8FF) chegando a um ponto âmbar (#FFB547) sobre noite (#0B1426).

Mesma geometria do símbolo #i-marca (viewBox 30x22):
    <path d="M2 20 Q 10 2 24 6" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 4.5"/>
    <circle cx="25" cy="6" r="4"/>

Uso (na raiz do projeto):  python public/icones/gerar.py
Precisa do Pillow. Saída: icone.svg, icone-180.png, icone-192.png, icone-512.png, badge-96.png nesta pasta.
"""
from pathlib import Path
from PIL import Image, ImageDraw

PASTA = Path(__file__).resolve().parent
NOITE, CEU, PISTA = (11, 20, 38), (92, 200, 255), (255, 181, 71)
P0, P1, P2 = (2, 20), (10, 2), (24, 6)
TRACO, VAZIO, LARGURA = 1.0, 4.5, 2.4
PONTO, RAIO = (25, 6), 4
CAIXA = (0.8, 2.0, 29.0, 21.2)          # limites da marca no viewBox (com as pontas arredondadas)


def bezier(t):
    u = 1 - t
    return (u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1])


def tracos():
    """Segmentos de 1 unidade a cada 5,5 ao longo do comprimento da curva."""
    amostras, total, ant = [(0.0, bezier(0))], 0.0, bezier(0)
    for i in range(1, 2001):
        p = bezier(i / 2000)
        total += ((p[0] - ant[0]) ** 2 + (p[1] - ant[1]) ** 2) ** .5
        amostras.append((total, p)); ant = p

    def em(s):
        for (s0, a), (s1, b) in zip(amostras, amostras[1:]):
            if s1 >= s:
                k = 0 if s1 == s0 else (s - s0) / (s1 - s0)
                return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)
        return amostras[-1][1]

    s, out = 0.0, []
    while s < total:
        out.append((em(s), em(min(total, s + TRACO))))
        s += TRACO + VAZIO
    return out


def desenhar(lado, ocupacao, fundo=True, mono=None, sobre=4):
    """ocupacao: fração do lado que a largura da marca ocupa (0,6 deixa a marca na zona segura do maskable)."""
    L = lado * sobre
    img = Image.new('RGBA', (L, L), NOITE + (255,) if fundo else (0, 0, 0, 0))
    g = ImageDraw.Draw(img)
    larg, alt = CAIXA[2] - CAIXA[0], CAIXA[3] - CAIXA[1]
    esc = ocupacao * L / larg
    ox, oy = (L - larg * esc) / 2 - CAIXA[0] * esc, (L - alt * esc) / 2 - CAIXA[1] * esc
    xy = lambda p: (ox + p[0] * esc, oy + p[1] * esc)
    r = LARGURA / 2 * esc
    cor_ceu = mono or CEU + (255,)
    for a, b in tracos():
        a, b = xy(a), xy(b)
        g.line([a, b], fill=cor_ceu, width=round(LARGURA * esc))
        for c in (a, b):
            g.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=cor_ceu)
    c = xy(PONTO)
    g.ellipse([c[0] - RAIO * esc, c[1] - RAIO * esc, c[0] + RAIO * esc, c[1] + RAIO * esc], fill=mono or PISTA + (255,))
    return img.resize((lado, lado), Image.LANCZOS)


def svg(ocupacao=0.6):
    larg, alt = CAIXA[2] - CAIXA[0], CAIXA[3] - CAIXA[1]
    esc = ocupacao * 512 / larg
    ox, oy = (512 - larg * esc) / 2 - CAIXA[0] * esc, (512 - alt * esc) / 2 - CAIXA[1] * esc
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" fill="#0B1426"/>'
            f'<g transform="translate({ox:.2f} {oy:.2f}) scale({esc:.4f})">'
            f'<path d="M2 20 Q 10 2 24 6" fill="none" stroke="#5CC8FF" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 4.5"/>'
            f'<circle cx="25" cy="6" r="4" fill="#FFB547"/></g></svg>\n')


if __name__ == '__main__':
    (PASTA / 'icone.svg').write_text(svg(), encoding='utf-8')
    for lado in (180, 192, 512):
        desenhar(lado, .6).convert('RGB').save(PASTA / f'icone-{lado}.png', optimize=True)
    # badge do Android: só a forma, em branco sobre transparente
    desenhar(96, .8, fundo=False, mono=(255, 255, 255, 255)).save(PASTA / 'badge-96.png', optimize=True)
    print('ícones gerados em', PASTA)
