/* Voa Aí · globo 3D (three.js). Vindo de prototipo/v2, agora alimentado por dados reais.
   Regras em docs/11-v2-visual.md:
   - Terra low-poly: icosaedro com uma cor por face, continentes do Natural Earth 110m (world-atlas).
   - Dia e noite pela hora real (ponto subsolar), recalculado a cada minuto.
   - Rota no grande círculo: voado sólido em céu, restante tracejado, destino aceso em âmbar.
   - Avião é marcador (silhueta do ícone num disco noite com anel céu), na posição ESTIMADA.
   - Câmera Avião / Destino / Livre; transições de 1,3 s; sem animação com prefers-reduced-motion. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COR = { ceu: 0x5CC8FF, pista: 0xFFB547, tinta: 0xF2F5FA, cancelado: 0xFF6B7A, atraso: 0xFF8A65,
  oceano: new THREE.Color('#0A152B'), terra: new THREE.Color('#33507F') };
const grau = Math.PI / 180;

export function vetor(lat, lon, r = 1) {
  const phi = (90 - lat) * grau, theta = (lon + 180) * grau;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}
function latLon(v) {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(n.y) / grau;
  let lon = Math.atan2(n.z, -n.x) / grau - 180;
  if (lon < -180) lon += 360;
  return [lat, lon];
}
// Ponto subsolar aproximado para um instante (declinação pelo dia do ano, longitude pela hora UTC).
function pontoSolar(ms) {
  const d = new Date(ms), dia = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = -23.44 * Math.cos(2 * Math.PI / 365 * (dia + 10));
  const horas = d.getUTCHours() + d.getUTCMinutes() / 60;
  return [decl, -(horas - 12) * 15];
}

const SILHUETA = [[10,3.5],[10.4,2.4],[11.5,2],[12.6,2.4],[13,3.5],[13,9],[21,14],[21,16],[13,13.5],[13,19],[15,20.5],[15,22],
  [11.5,21],[8,22],[8,20.5],[10,19],[10,13.5],[2,16],[2,14],[10,9]];        // mesmos pontos do símbolo #i-aviao

function descartar(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.();
    const m = o.material; if (Array.isArray(m)) m.forEach(x => x.dispose()); else m?.dispose?.();
  });
}

export function criarGlobo({ canvas, camadaRotulos, desktop, reduzir, aoArrastar = () => {} }) {
  const palco = canvas.parentElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .01, 200);
  const controles = new OrbitControls(camera, canvas);
  Object.assign(controles, { enablePan: false, enableDamping: true, dampingFactor: .08, minDistance: 1.6, maxDistance: 9, rotateSpeed: .5, autoRotateSpeed: .35 });

  /* ---- sol na hora real */
  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  const posicionarSol = () => sol.position.copy(vetor(...pontoSolar(Date.now()), 10));
  posicionarSol(); setInterval(posicionarSol, 60000);
  cena.add(sol, new THREE.AmbientLight(0x9DB4E0, .7));

  /* ---- globo low-poly */
  const geoGlobo = new THREE.IcosahedronGeometry(1, 22);
  const nFaces = geoGlobo.attributes.position.count / 3;
  geoGlobo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nFaces * 9), 3));
  function pintarGlobo(ehTerra) {
    const pos = geoGlobo.attributes.position, cor = geoGlobo.attributes.color, c = new THREE.Color(), v = new THREE.Vector3();
    for (let f = 0; f < nFaces; f++) {
      v.set(0, 0, 0);
      for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
      const [lat, lon] = latLon(v);
      const terra = ehTerra ? ehTerra(lat, lon) : false;
      const ruido = (Math.sin(f * 12.9898) * 43758.5453) % 1;           // variação fixa por face
      c.copy(terra ? COR.terra : COR.oceano).offsetHSL(0, 0, ruido * (terra ? .035 : .015));
      for (let k = 0; k < 3; k++) cor.setXYZ(f * 3 + k, c.r, c.g, c.b);
    }
    cor.needsUpdate = true;
  }
  pintarGlobo();
  cena.add(new THREE.Mesh(geoGlobo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  // Continentes: sem rede, o globo fica só com o oceano e o resto funciona.
  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json').then(r => r.json()).then(topo => {
    if (!window.topojson) return;
    const W = 1440, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.fillStyle = '#fff';
    const terra = window.topojson.feature(topo, topo.objects.land);
    for (const f of terra.features) {
      const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polis) {
        g.beginPath();
        for (const anel of p) anel.forEach(([lo, la], i) => { const x = (lo + 180) / 360 * W, y = (90 - la) / 180 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.fill('evenodd');
      }
    }
    const px = g.getImageData(0, 0, W, H).data;
    pintarGlobo((lat, lon) => {
      const x = Math.min(W - 1, Math.max(0, Math.round((lon + 180) / 360 * W))), y = Math.min(H - 1, Math.max(0, Math.round((90 - lat) / 180 * H)));
      return px[(y * W + x) * 4] > 127;
    });
  }).catch(() => { /* sem mapa: só o oceano */ });

  // Atmosfera e estrelas.
  cena.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 n; void main(){ n = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 n; void main(){ float i = pow(0.62 - dot(n, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.36,0.78,1.0,1.0) * i; }',
  })));
  {
    const n = 1400, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 30); p.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    cena.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xA9B6CC, size: 1.4, sizeAttenuation: false, transparent: true, opacity: .55 })));
  }

  /* ---- avião: marcador, não miniatura */
  function aviao() {
    const forma = new THREE.Shape(SILHUETA.map(([x, y]) => new THREE.Vector2(x - 11.5, 12 - y)));
    const geo = new THREE.ExtrudeGeometry(forma, { depth: .9, bevelEnabled: false })
      .translate(0, 0, -.45).rotateX(Math.PI / 2).scale(.0034, .0034, .0034);   // nariz para +Z, topo para +Y
    const mCorpo = new THREE.MeshBasicMaterial({ color: COR.tinta, transparent: true });
    const mDisco = new THREE.MeshBasicMaterial({ color: 0x0B1426, transparent: true, opacity: .88, depthWrite: false });
    const mAnel = new THREE.MeshBasicMaterial({ color: COR.ceu, transparent: true, side: THREE.DoubleSide });
    const g = new THREE.Group();
    const disco = new THREE.Mesh(new THREE.CircleGeometry(.05, 40).rotateX(-Math.PI / 2).translate(0, -.004, 0), mDisco);
    const anel = new THREE.Mesh(new THREE.RingGeometry(.05, .057, 48).rotateX(-Math.PI / 2).translate(0, -.0035, 0), mAnel);
    const corpo = new THREE.Mesh(geo, mCorpo);
    disco.renderOrder = 1; anel.renderOrder = 2; corpo.renderOrder = 3;
    g.add(disco, anel, corpo);
    g.userData.materiais = [mCorpo, mDisco, mAnel];
    return g;
  }

  /* ---- rotas
     tipo: 'voo' (avião na rota, t = fração estimada), 'cancelado', 'opcao' (arco sem avião). */
  const objetos = {};
  const assinatura = v => `${v.a.lat},${v.a.lon}|${v.b.lat},${v.b.lon}|${v.tipo}|${Math.round(v.t * 400)}`;
  function montar(v) {
    const a = vetor(v.a.lat, v.a.lon), b = vetor(v.b.lat, v.b.lon);
    const ang = a.angleTo(b), h = .012 + .16 * ang / Math.PI, pts = [];
    for (let i = 0; i <= 80; i++) {
      const u = i / 80, p = new THREE.Vector3().copy(a).lerp(b, u).normalize();
      const s = Math.sin(ang * (1 - u)), e = Math.sin(ang * u);
      if (ang > 1e-4) p.copy(a).multiplyScalar(s / Math.sin(ang)).add(b.clone().multiplyScalar(e / Math.sin(ang)));
      pts.push(p.normalize().multiplyScalar(1.003 + h * Math.sin(Math.PI * u)));
    }
    const curva = new THREE.CatmullRomCurve3(pts);
    const grupo = new THREE.Group(), mats = [];
    const cancelado = v.tipo === 'cancelado', comAviao = v.tipo === 'voo';
    const t = Math.max(0, Math.min(1, v.t || 0));
    const respiro = .075 / curva.getLength();          // o rastro para antes do marcador do avião
    if (comAviao && t > respiro) {
      const fim = t - respiro, sub = []; for (let i = 0; i <= 60; i++) sub.push(curva.getPoint(fim * i / 60));
      const m = new THREE.MeshBasicMaterial({ color: COR.ceu, transparent: true }); mats.push(m);
      grupo.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sub), 60, .0042, 6), m));
    }
    const tTrac = comAviao ? t : 0;
    const passo = .012 / Math.max(ang, .05), qtd = Math.max(4, Math.floor((1 - tTrac) / passo));
    const mPonto = new THREE.MeshBasicMaterial({ color: cancelado ? COR.cancelado : COR.tinta, transparent: true, opacity: .7 }); mats.push(mPonto);
    const pontos = new THREE.InstancedMesh(new THREE.SphereGeometry(.0028, 6, 4), mPonto, qtd), mx = new THREE.Matrix4();
    const ini = comAviao ? Math.min(1, tTrac + respiro) : tTrac;
    for (let i = 0; i < qtd; i++) { mx.setPosition(curva.getPoint(ini + (1 - ini) * (i + .5) / qtd)); pontos.setMatrixAt(i, mx); }
    grupo.add(pontos);
    const mOrigem = new THREE.MeshBasicMaterial({ color: COR.tinta, transparent: true }); mats.push(mOrigem);
    const origem = new THREE.Mesh(new THREE.SphereGeometry(.007, 10, 8), mOrigem); origem.position.copy(a).multiplyScalar(1.003);
    const mDest = new THREE.MeshBasicMaterial({ color: cancelado ? COR.cancelado : COR.pista, transparent: true }); mats.push(mDest);
    const destino = new THREE.Mesh(new THREE.SphereGeometry(.011, 12, 10), mDest); destino.position.copy(b).multiplyScalar(1.004);
    const mHalo = new THREE.MeshBasicMaterial({ color: COR.pista, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false }); mats.push(mHalo);
    const halo = new THREE.Mesh(new THREE.RingGeometry(.016, .03, 32), mHalo);
    halo.position.copy(b).multiplyScalar(1.004); halo.lookAt(b.clone().multiplyScalar(2)); halo.visible = !cancelado;
    grupo.add(origem, destino, halo);
    let marcador = null;
    if (comAviao) {
      marcador = aviao(); mats.push(...marcador.userData.materiais);
      const tt = Math.min(t, .995), p = curva.getPoint(tt), frente = curva.getPoint(Math.min(1, tt + .01)).sub(p).normalize();
      const cima = p.clone().normalize(), direita = new THREE.Vector3().crossVectors(cima, frente).normalize();
      frente.crossVectors(direita, cima);
      marcador.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(direita, cima, frente));
      marcador.position.copy(t > 0 ? p : a.clone().multiplyScalar(1.006));
      grupo.add(marcador);
    }
    grupo.visible = false;
    cena.add(grupo);
    return { grupo, mats, halo, aviao: marcador, curva, origem: a, destino: b, cancelado, base: mats.map(m => m.opacity), sig: assinatura(v) };
  }

  function definirVoos(lista) {
    const vistos = new Set();
    for (const v of lista) {
      if (![v.a?.lat, v.a?.lon, v.b?.lat, v.b?.lon].every(Number.isFinite)) continue;
      vistos.add(v.id);
      const atual = objetos[v.id];
      if (atual && atual.sig === assinatura(v)) continue;
      const vis = atual?.grupo.visible;
      if (atual) { cena.remove(atual.grupo); descartar(atual.grupo); }
      objetos[v.id] = montar(v);
      if (vis) objetos[v.id].grupo.visible = true;
    }
    return [...vistos];
  }
  const tem = id => !!objetos[id];

  function realce(id, nivel) {           // 1 = aceso, .3 = em segundo plano
    const o = objetos[id]; if (o) o.mats.forEach((m, i) => m.opacity = o.base[i] * nivel);
  }

  /* ---- rótulos (HTML sobre o 3D) */
  let rotulos = [];
  function montarRotulos(lista = []) {
    camadaRotulos.textContent = ''; rotulos = [];
    for (const r of lista) {
      const o = objetos[r.id]; if (!o) continue;
      const pos = r.onde === 'a' ? o.origem : r.onde === 'b' ? o.destino : (o.aviao ? o.aviao.position : o.curva.getPoint(.5));
      const el = document.createElement('div'); el.className = 'rotulo ' + (r.classe || ''); el.innerHTML = r.html;
      if (r.onde === 'aviao') el.dataset.voo = r.id;
      camadaRotulos.append(el); rotulos.push({ el, pos });
    }
  }
  const _v = new THREE.Vector3(), _c = new THREE.Vector3();
  function posicionarRotulos() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const r of rotulos) {
      _v.copy(r.pos).project(camera);
      _c.copy(camera.position).sub(r.pos).normalize();
      const visivel = _c.dot(r.pos.clone().normalize()) > .2;
      r.el.toggleAttribute('data-oculto', !visivel);
      r.el.style.left = ((_v.x + 1) / 2 * w) + 'px'; r.el.style.top = ((1 - _v.y) / 2 * h) + 'px';
    }
  }

  /* ---- câmera */
  let voo = null, atual = { ids: [] }, modoCamera = 'livre';
  function enquadrar(ids) {
    ids = ids.filter(tem);
    if (!ids.length) return { lat: -2, lon: -28, dist: 4.6 };
    const c = new THREE.Vector3();
    for (const id of ids) c.add(objetos[id].origem).add(objetos[id].destino);
    if (c.lengthSq() < 1e-6) c.copy(objetos[ids[0]].destino);
    const [lat, lon] = latLon(c);
    const abertura = Math.max(...ids.map(id => objetos[id].origem.angleTo(objetos[id].destino)));
    let dispersao = 0; const n = c.clone().normalize();
    for (const id of ids) dispersao = Math.max(dispersao, n.angleTo(objetos[id].origem), n.angleTo(objetos[id].destino));
    return { lat, lon, dist: Math.min(5.2, Math.max(3.2, 2.9 + Math.max(abertura, dispersao * 1.6) * 1.5)) };
  }
  function direcaoDe(cfg, modo) {
    const o = cfg.foco && objetos[cfg.foco];
    if (!o || modo === 'livre' && cfg.camera) {
      const cam = cfg.camera || enquadrar(cfg.enquadrar || cfg.ids || []);
      return { dir: vetor(cam.lat, cam.lon), dist: cam.dist };
    }
    if (modo === 'destino') return { dir: o.destino.clone(), dist: 2.8 };
    if (modo === 'livre') return null;
    const alvo = o.aviao ? o.aviao.position : o.origem;
    const meio = alvo.clone().normalize().lerp(o.destino, .3).normalize();
    return { dir: meio, dist: desktop.matches ? 3.4 : 3.9 };
  }
  function voarPara(alvo) {
    if (!alvo) return;
    const { dir, dist } = alvo;
    const de = camera.position.clone(), distDe = de.length(), dirDe = de.normalize();
    const para = dir.clone().normalize();
    if (reduzir) { camera.position.copy(para.multiplyScalar(dist)); camera.lookAt(0, 0, 0); return; }
    voo = { dirDe, para, distDe, dist, ini: performance.now(), dur: 1300 };
  }
  function passoVoo(agora) {
    if (!voo) return;
    const k = Math.min(1, (agora - voo.ini) / voo.dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const q = new THREE.Quaternion().setFromUnitVectors(voo.dirDe, voo.para), q0 = new THREE.Quaternion();
    const d = voo.dirDe.clone().applyQuaternion(q0.slerp(q, e));
    const arco = Math.sin(Math.PI * e) * .25 * voo.dirDe.angleTo(voo.para);
    camera.position.copy(d.multiplyScalar(THREE.MathUtils.lerp(voo.distDe, voo.dist, e) + arco));
    if (k === 1) voo = null;
  }
  controles.addEventListener('start', () => { voo = null; controles.autoRotate = false; aoArrastar(); });

  /* ---- painel do desktop empurra o centro do globo para a área livre à direita */
  let deslocamento = 0, deslocAlvo = 0;
  function medirDeslocamento() {
    const recolhido = document.body.hasAttribute('data-recolhido');
    deslocAlvo = desktop.matches && !recolhido ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--painel-l')) + 24) / 2 : 0;
  }
  function aplicarOffset() {
    const w = palco.clientWidth, h = palco.clientHeight; if (!w || !h) return;
    camera.setViewOffset(w, h, -deslocamento, 0, w, h); camera.updateProjectionMatrix();
  }
  function ajustar() {
    const w = palco.clientWidth, h = palco.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; medirDeslocamento(); aplicarOffset();
  }
  new ResizeObserver(ajustar).observe(palco);

  /* ---- laço: pausa com a aba escondida e quando o globo não aparece */
  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (document.hidden || !palco.clientHeight) return;
    if (Math.abs(deslocAlvo - deslocamento) > .5) { deslocamento += (deslocAlvo - deslocamento) * (reduzir ? 1 : .12); aplicarOffset(); }
    passoVoo(agora);
    if (voo) camera.lookAt(0, 0, 0); else controles.update();
    if (!reduzir) {
      const s = 1 + .45 * (.5 + .5 * Math.sin(agora / 1000 * 2.6));
      for (const id in objetos) objetos[id].halo.scale.setScalar(s);
    }
    renderer.render(cena, camera);
    posicionarRotulos();
  }
  camera.position.copy(vetor(-2, -28, 4.6));
  requestAnimationFrame(quadro);

  /* ---- API para o app */
  return {
    definirVoos,
    tem,
    /** cfg: { ids, destaque, foco, modo, camera, enquadrar:[ids], girar, rotulos:[{id, onde:'a'|'b'|'aviao', html, classe}] } */
    mostrar(cfg, { manterCamera = false } = {}) {
      const ids = (cfg.ids || []).filter(tem);
      atual = { ...cfg, ids };
      for (const id in objetos) objetos[id].grupo.visible = ids.includes(id);
      ids.forEach(id => realce(id, cfg.destaque && id !== cfg.destaque ? .3 : 1));
      controles.autoRotate = !!cfg.girar && !reduzir;
      modoCamera = cfg.foco && tem(cfg.foco) ? (cfg.modo || 'aviao') : 'livre';
      montarRotulos(cfg.rotulos);
      ajustar();
      if (!manterCamera) voarPara(direcaoDe(atual, modoCamera));
      return modoCamera;
    },
    modo(m) { modoCamera = m; if (m !== 'livre') voarPara(direcaoDe(atual, m)); },
    /** Passar o mouse num item: acende um voo e leva a câmera até ele; null volta ao enquadramento. */
    focar(id) {
      atual.ids.forEach(v => realce(v, !id || v === id ? 1 : .3));
      if (id && objetos[id]) { const o = objetos[id], p = o.aviao ? o.aviao.position : o.curva.getPoint(.5); voarPara({ dir: p.clone(), dist: 3.0 }); }
      else if (!id) voarPara(direcaoDe(atual, 'livre') || direcaoDe({ ids: atual.ids }, 'livre'));
    },
    realcar(id) { atual.ids.forEach(v => realce(v, !id || v === id ? 1 : .3)); },
    ajustar() { medirDeslocamento(); },
    enquadrar,
  };
}
