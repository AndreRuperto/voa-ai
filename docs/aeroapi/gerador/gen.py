"""Gera HTML da documentação AeroAPI a partir da spec OpenAPI oficial + tabela de preços."""
import json, sys, html, hashlib, re, datetime
from collections import defaultdict, Counter
import yaml, markdown

spec_path, prices_path, out_path = sys.argv[1:4]
S = yaml.safe_load(open(spec_path))
PRICES = {p[0]: p[2].replace('/result set', '') for p in json.load(open(prices_path))}
METHODS = ('get', 'post', 'put', 'patch', 'delete')
esc = html.escape

def md(t):
    t = re.sub(r'(?m)^(?!\s*[-*] |\s*$)(.+)\n(\s*[-*] )', r'\1\n\n\2', t or '')
    return markdown.markdown(t or '', extensions=['tables', 'fenced_code'])

def md_inline(t):
    h = md(t).strip()
    return re.sub(r'^<p>(.*)</p>$', r'\1', h, flags=re.S) if h.count('<p>') == 1 else h

# ---------- deduplicação de schemas grandes ----------
def key(o):
    return hashlib.sha1(json.dumps(o, sort_keys=True, default=str).encode()).hexdigest()

counts, names = Counter(), defaultdict(Counter)
def walk(o, name):
    if isinstance(o, dict):
        if o.get('type') == 'object' and len(o.get('properties', {})) >= 6:
            k = key(o); counts[k] += 1; names[k][o.get('title') or name] += 1
        for kk, v in o.items():
            if kk == 'properties' and isinstance(v, dict):
                for pn, pv in v.items(): walk(pv, pn)
            elif kk == 'items': walk(v, name)
            else: walk(v, name)
    elif isinstance(o, list):
        for v in o: walk(v, name)
walk(S['paths'], 'response')

MODELS, used_names = {}, set()
def pretty(n):
    n = ''.join(w[:1].upper() + w[1:] for w in re.split(r'[^A-Za-z0-9]+', n) if w)
    return n[:-1] if n.endswith('s') and not n.endswith('us') and len(n) > 4 else n
for k, c in counts.items():
    if c >= 2:
        base = pretty(next((x for x, _ in names[k].most_common() if x != 'response'), 'Model'))
        n, i = base, 2
        while n in used_names: n, i = f'{base}{i}', i + 1
        used_names.add(n); MODELS[k] = n
MODEL_SCHEMAS = {}

def typ(s):
    if not isinstance(s, dict): return ''
    for comb in ('oneOf', 'anyOf', 'allOf'):
        if comb in s and 'type' not in s:
            return ' | '.join(filter(None, (typ(x) for x in s[comb]))) or comb
    t = s.get('type', '')
    if t == 'array': return f"array&lt;{typ(s.get('items', {})) or 'any'}&gt;"
    if t == 'object' and key(s) in MODELS:
        MODEL_SCHEMAS[MODELS[key(s)]] = s
        return f'<a href="#model-{MODELS[key(s)]}">{MODELS[key(s)]}</a>'
    f = s.get('format') or ' / '.join(x.get('format', '') for x in s.get('oneOf', []) if isinstance(x, dict) and x.get('format'))
    out = t + (f' ({f})' if f else '')
    if s.get('nullable'): out += ' · nullable'
    return out

def fields(s, depth=0, prefix='', rows=None, req=()):
    rows = [] if rows is None else rows
    if not isinstance(s, dict) or depth > 6: return rows
    if s.get('type') == 'array': return fields(s.get('items', {}), depth, prefix + '[]', rows)
    if 'allOf' in s:
        for x in s['allOf']: fields(x, depth, prefix, rows, req)
        return rows
    for comb in ('oneOf', 'anyOf'):
        if comb in s and not s.get('properties'):
            for i, x in enumerate(s[comb]):
                if isinstance(x, dict) and (x.get('properties') or x.get('type') == 'array'):
                    fields(x, depth, prefix + f' ⟨opção {i+1}⟩', rows)
            return rows
    reqs = set(s.get('required', []))
    for pn, pv in (s.get('properties') or {}).items():
        path = f'{prefix}.{pn}' if prefix else pn
        rows.append((depth, path, pn, pv, pn in reqs))
        inner = pv.get('items', pv) if isinstance(pv, dict) and pv.get('type') == 'array' else pv
        if isinstance(inner, dict) and inner.get('type') == 'object' and key(inner) in MODELS:
            MODEL_SCHEMAS[MODELS[key(inner)]] = inner
            continue
        fields(pv, depth + 1, path, rows)
    return rows

def field_table(s):
    if isinstance(s, dict) and s.get('type') == 'object' and key(s) in MODELS and depth_root_ok(s):
        MODEL_SCHEMAS[MODELS[key(s)]] = s
        return f'<p class="ref">Retorna o modelo <a href="#model-{MODELS[key(s)]}">{MODELS[key(s)]}</a>.</p>'
    rows = fields(s)
    if not rows:
        return f'<p class="ref">Tipo: <code>{typ(s) or "—"}</code></p>' if s else ''
    out = ['<table class="fields"><thead><tr><th>Campo</th><th>Tipo</th><th>Descrição</th></tr></thead><tbody>']
    for depth, path, pn, pv, rq in rows:
        pv = pv if isinstance(pv, dict) else {}
        extra = ''
        if pv.get('enum'): extra += '<div class="enum">Valores: ' + ', '.join(f'<code>{esc(str(e))}</code>' for e in pv['enum']) + '</div>'
        if 'example' in pv: extra += f'<div class="ex">Ex.: <code>{esc(json.dumps(pv["example"], default=str))}</code></div>'
        out.append(f'<tr><td style="padding-left:{6+depth*14}px"><code>{esc(pn)}</code>{"<span class=req>*</span>" if rq else ""}</td>'
                   f'<td class="t">{typ(pv)}</td><td>{md_inline(pv.get("description", ""))}{extra}</td></tr>')
    out.append('</tbody></table>')
    return ''.join(out)

def depth_root_ok(s): return True

def params_table(params):
    if not params: return ''
    out = ['<table class="params"><thead><tr><th>Parâmetro</th><th>Em</th><th>Tipo</th><th>Descrição</th></tr></thead><tbody>']
    for p in params:
        sc = p.get('schema', {})
        extra = ''
        if sc.get('enum'): extra += '<div class="enum">Valores: ' + ', '.join(f'<code>{esc(str(e))}</code>' for e in sc['enum']) + '</div>'
        if 'default' in sc: extra += f'<div class="ex">Padrão: <code>{esc(str(sc["default"]))}</code></div>'
        rng = []
        if 'minimum' in sc: rng.append(f'mín {sc["minimum"]}')
        if 'maximum' in sc: rng.append(f'máx {sc["maximum"]}')
        if rng: extra += f'<div class="ex">{", ".join(rng)}</div>'
        exs = p.get('examples') or ({'_': {'value': p['example']}} if 'example' in p else {})
        if exs: extra += '<div class="ex">Ex.: ' + ', '.join(f'<code>{esc(str(v.get("value")))}</code>' for v in exs.values() if isinstance(v, dict)) + '</div>'
        out.append(f'<tr><td><code>{esc(p["name"])}</code>{"<span class=req>*</span>" if p.get("required") else ""}</td>'
                   f'<td>{p.get("in")}</td><td class="t">{typ(sc)}</td><td>{md_inline(p.get("description", ""))}{extra}</td></tr>')
    out.append('</tbody></table>')
    return ''.join(out)

def slug(m, p): return re.sub(r'[^a-z0-9]+', '-', f'{m}-{p}'.lower()).strip('-')

# ---------- montar ----------
tags = S.get('tags', [])
tag_names = [t['name'] for t in tags]
ops_by_tag = defaultdict(list)
for path, item in S['paths'].items():
    common = item.get('parameters', [])
    for m in METHODS:
        if m in item:
            op = item[m]
            ops_by_tag[(op.get('tags') or ['outros'])[0]].append((m, path, op, common + op.get('parameters', [])))
for t in ops_by_tag:
    if t not in tag_names: tag_names.append(t)

TAG_PT = {'flights': 'Voos', 'foresight': 'Foresight (ETAs preditivos)', 'airports': 'Aeroportos', 'operators': 'Operadoras',
          'alerts': 'Alertas', 'history': 'Histórico', 'miscellaneous': 'Diversos', 'account': 'Conta'}

body = []
info = S['info']
today = datetime.date.today().strftime('%d/%m/%Y')
def surl(sv):
    u = sv['url']
    for k, v in sv.get('variables', {}).items(): u = u.replace('{' + k + '}', str(v.get('default', '')))
    return u
servers = ', '.join(f'<code>{esc(surl(s))}</code>' for s in S.get('servers', []))

body.append(f'''<section class="cover">
<div class="kicker">RepoPrint · Documentação de integração</div>
<h1>FlightAware AeroAPI</h1>
<div class="ver">Referência completa · versão {esc(str(info["version"]))}</div>
<p class="lead">API REST/JSON de status e rastreamento de voos, aeroportos, operadoras, alertas e histórico.</p>
<table class="meta">
<tr><td>Base URL</td><td>{servers}</td></tr>
<tr><td>Autenticação</td><td>Header <code>x-apikey: &lt;sua chave&gt;</code></td></tr>
<tr><td>Endpoints</td><td>{sum(len(v) for v in ops_by_tag.values())} operações em {len(ops_by_tag)} grupos</td></tr>
<tr><td>Fonte</td><td>Especificação OpenAPI oficial (flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml) e página de preços da FlightAware, obtidas em {today}</td></tr>
</table>
<p class="note">As descrições dos endpoints e campos são as originais da FlightAware, em inglês. As seções introdutórias foram escritas em português para o projeto.</p>
</section>''')

# Sumário
toc = ['<section class="toc"><h2>Sumário</h2><ol>',
       '<li><a href="#guia">Guia rápido</a></li><li><a href="#planos">Planos e preços</a></li><li><a href="#oficial">Visão geral oficial</a></li>']
for t in tag_names:
    if t in ops_by_tag:
        toc.append(f'<li><a href="#tag-{t}">{TAG_PT.get(t, t.title())}</a><ul>' + ''.join(
            f'<li><a href="#{slug(m, p)}"><span class="m m-{m}">{m.upper()}</span> {esc(p)}</a></li>' for m, p, _, _ in ops_by_tag[t]) + '</ul></li>')
toc.append('<li><a href="#modelos">Modelos de dados</a></li></ol></section>')
body.append(''.join(toc))

body.append('''<section id="guia"><h2>Guia rápido</h2>
<h3>Autenticação</h3>
<p>Toda requisição precisa do header <code>x-apikey</code> com a chave gerada no portal da AeroAPI (<em>Account → API Keys</em>). Use sempre HTTPS. Não exponha a chave no cliente (app mobile, desktop ou navegador): faça as chamadas pelo servidor.</p>
<pre><code>curl -H "x-apikey: $AEROAPI_KEY" \\
  "https://aeroapi.flightaware.com/aeroapi/flights/TAM3054"</code></pre>
<pre><code>// Node.js (fetch nativo)
const res = await fetch("https://aeroapi.flightaware.com/aeroapi/flights/TAM3054", {
  headers: { "x-apikey": process.env.AEROAPI_KEY },
});
if (!res.ok) throw new Error(`AeroAPI ${res.status}`);
const { flights } = await res.json();</code></pre>
<h3>Result sets e paginação</h3>
<ul>
<li>A cobrança é feita por <strong>result set</strong>, que equivale a <strong>15 registros</strong> (1 página).</li>
<li><code>max_pages</code> limita quantas páginas (e portanto quanto custo) uma chamada pode gerar. O padrão é 1.</li>
<li>Respostas paginadas trazem <code>links.next</code> e <code>num_pages</code>. Para continuar, chame a URL de <code>links.next</code> ou passe o parâmetro <code>cursor</code>.</li>
</ul>
<h3>Identificadores</h3>
<ul>
<li><code>ident</code>: designador do voo (prefira o ICAO, ex.: <code>TAM3054</code>, a IATA <code>JJ3054</code>) ou matrícula da aeronave (ex.: <code>PR-XBA</code>).</li>
<li><code>fa_flight_id</code> (<code>{id}</code> nas rotas): ID único de um voo específico, retornado por <code>/flights/{ident}</code>. É exigido em <code>/position</code>, <code>/track</code>, <code>/route</code> e <code>/map</code>.</li>
<li>Aeroportos aceitam código ICAO (<code>SBGR</code>), IATA (<code>GRU</code>) ou LID. Prefira o ICAO.</li>
<li>Datas e horários seguem ISO 8601 em UTC.</li>
</ul>
<h3>Erros comuns</h3>
<table class="params"><thead><tr><th>Status</th><th>Significado</th></tr></thead><tbody>
<tr><td>400</td><td>Parâmetro inválido ou ausente</td></tr>
<tr><td>401</td><td>Chave ausente ou inválida</td></tr>
<tr><td>404</td><td>Recurso não encontrado (voo, aeroporto, etc.)</td></tr>
<tr><td>429</td><td>Limite de taxa do plano excedido. Aguarde e tente de novo com <em>backoff</em>.</td></tr>
<tr><td>5xx</td><td>Erro do servidor da FlightAware. Tente de novo.</td></tr>
</tbody></table>
<h3>Boas práticas de custo</h3>
<ul>
<li>Faça cache das respostas. Status de voo raramente muda em menos de 1–2 minutos.</li>
<li>Para acompanhar um voo, prefira <strong>alertas</strong> entregues por webhook em vez de consultar o status repetidamente. Criar, listar e apagar alertas é gratuito, mas <strong>cada alerta entregue custa US$ 0,020</strong>. Por isso, ative só os eventos necessários.</li>
<li>Use os endpoints <code>/canonical</code> (US$ 0,001) para validar identificadores antes de buscas caras.</li>
<li>Defina sempre <code>max_pages</code> e acompanhe o gasto em <code>GET /account/usage</code> (gratuito).</li>
</ul>
</section>''')

# Planos
price_rows = ''.join(f'<tr><td><span class="m m-{p[0].split()[0].lower()}">{esc(p[0].split()[0])}</span> <code>{esc(p[0].split(" ",1)[1])}</code></td><td>{esc(p[1])}</td><td class="num">{esc(p[2].replace("/result set",""))}</td></tr>'
                     for p in json.load(open(prices_path)))
body.append(f'''<section id="planos"><h2>Planos e preços</h2>
<p class="note">Valores em USD, conforme a página oficial da FlightAware em {today}. Os preços podem mudar.</p>
<table class="params plans"><thead><tr><th></th><th>Personal</th><th>Standard</th><th>Premium</th></tr></thead><tbody>
<tr><td>Mínimo mensal</td><td>Nenhum</td><td>US$ 100</td><td>US$ 1.000</td></tr>
<tr><td>Uso gratuito</td><td>US$ 5/mês (US$ 10 para feeders ADS-B)</td><td>—</td><td>—</td></tr>
<tr><td>Limite de taxa</td><td>10 result sets/minuto</td><td>5 result sets/segundo</td><td>100 result sets/segundo</td></tr>
<tr><td>Histórico</td><td>—</td><td>500.000 result sets/mês</td><td>500.000 result sets/mês</td></tr>
<tr><td>Uso permitido</td><td>Pessoal e acadêmico</td><td>Interno e B2C</td><td>Interno, B2C e B2B</td></tr>
<tr><td>Desconto por volume</td><td>Não</td><td>Sim</td><td>Sim</td></tr>
<tr><td>SLA 99,5%</td><td>Não</td><td>Não</td><td>Sim</td></tr>
</tbody></table>
<h3>Desconto por volume (Standard e Premium)</h3>
<p>O desconto é progressivo: cada percentual vale só para a parte do gasto que cai naquela faixa. Exemplo: US$ 3.000 a preço de lista saem por 1.000 + 700 + 490 = <strong>US$ 2.190</strong>.</p>
<table class="params"><thead><tr><th>Faixa mensal (preço de lista)</th><th>Desconto</th></tr></thead><tbody>
<tr><td>US$ 0 – 1.000</td><td>0%</td></tr><tr><td>1.000 – 2.000</td><td>30%</td></tr><tr><td>2.000 – 4.000</td><td>51%</td></tr>
<tr><td>4.000 – 8.000</td><td>65%</td></tr><tr><td>8.000 – 16.000</td><td>76%</td></tr><tr><td>16.000 – 32.000</td><td>83%</td></tr>
<tr><td>32.000 – 64.000</td><td>88%</td></tr><tr><td>Acima de 64.000</td><td>94%</td></tr></tbody></table>
<h3>Preço por endpoint (por result set)</h3>
<table class="params prices"><thead><tr><th>Endpoint</th><th>Função</th><th>USD</th></tr></thead><tbody>{price_rows}</tbody></table>
</section>''')

body.append(f'<section id="oficial"><h2>Visão geral oficial</h2><div class="desc">{md(info.get("description", ""))}</div></section>')

for t in tag_names:
    if t not in ops_by_tag: continue
    tdesc = next((x.get('description', '') for x in tags if x['name'] == t), '')
    body.append(f'<section class="tag" id="tag-{t}"><h2>{TAG_PT.get(t, t.title())} <span class="tagname">{esc(t)}</span></h2><div class="desc">{md(tdesc)}</div>')
    for m, p, op, params in ops_by_tag[t]:
        price = PRICES.get(f'{m.upper()} {p}')
        body.append(f'<article class="op" id="{slug(m, p)}"><div class="ophead"><span class="m m-{m}">{m.upper()}</span> <code class="path">{esc(p)}</code>'
                    + (f'<span class="price">{esc(price)} / result set</span>' if price else '') + '</div>')
        body.append(f'<h4>{esc(op.get("summary", ""))}</h4><div class="desc">{md(op.get("description", ""))}</div>')
        if params: body.append('<h5>Parâmetros</h5>' + params_table(params))
        rb = op.get('requestBody')
        if rb:
            for ct, c in rb.get('content', {}).items():
                body.append(f'<h5>Corpo da requisição <span class="ct">{esc(ct)}</span></h5>{md(rb.get("description", ""))}' + field_table(c.get('schema', {})))
        body.append('<h5>Respostas</h5>')
        for code, r in op.get('responses', {}).items():
            body.append(f'<div class="resp"><span class="code c{str(code)[0]}">{esc(str(code))}</span> {md_inline(r.get("description", ""))}</div>')
            for ct, c in (r.get('content') or {}).items():
                if str(code).startswith('2') and 'schema' in c:
                    if ct != 'application/json': body.append(f'<p class="ref">Conteúdo: <code>{esc(ct)}</code></p>')
                    body.append(field_table(c['schema']))
        body.append('</article>')
    body.append('</section>')

# Modelos: renderiza até estabilizar (modelos podem citar outros modelos)
body.append('<section id="modelos"><h2>Modelos de dados</h2><p>Objetos que aparecem em várias respostas. Cada um é descrito uma vez só e referenciado pelo nome nas tabelas.</p>')
done = set()
while True:
    pending = sorted(n for n in MODEL_SCHEMAS if n not in done)
    if not pending: break
    for n in pending:
        done.add(n)
        s = MODEL_SCHEMAS[n]
        rows_html = fields_html = None
        body.append(f'<article class="model" id="model-{n}"><h3>{n}</h3>{md(s.get("description", ""))}')
        tmp = dict(s)  # evita autorreferência retornar apenas o link
        MODELS_SAVE = MODELS.pop(key(s), None)
        body.append(field_table(tmp))
        if MODELS_SAVE: MODELS[key(s)] = MODELS_SAVE
        body.append('</article>')
body.append('</section>')

CSS = open(sys.argv[4]).read()
open(out_path, 'w').write(f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>FlightAware AeroAPI — Documentação</title><style>{CSS}</style></head><body>{"".join(body)}</body></html>')
print('ops', sum(len(v) for v in ops_by_tag.values()), 'models', len(MODEL_SCHEMAS), 'unpriced', [f'{m.upper()} {p}' for v in ops_by_tag.values() for m, p, _, _ in v if f'{m.upper()} {p}' not in PRICES])
