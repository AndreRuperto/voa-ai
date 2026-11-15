/* Voa Aí · avião 3D low-poly, feito só com geometria (sem arquivo de modelo para baixar).
   Duas famílias, pelo aircraft_type da AeroAPI (docs/06-v2-3d.md):
   - 'estreito': corredor único (A320, 737, E190…) e qualquer tipo desconhecido;
   - 'largo': fuselagem larga (A330, A350, A380, 747, 767, 777, 787…).
   Eixos do modelo iguais aos do marcador do globo: nariz para +Z, topo para +Y, asa direita para +X.
   O tamanho é exagerado de propósito (o globo tem raio 1): um avião em escala real seria invisível. */
import * as THREE from 'three';

const COR = {
  corpo: 0xF2F5FA, asa: 0xC4CFDF, cauda: 0x5CC8FF, sombra: 0x02060E,
  nacele: 0xDCE3EE, borda: 0xA9B6CC, fan: 0x1B2D4F, pa: 0x6E83A8, cone: 0xC4CFDF, espiral: 0xF2F5FA, escape: 0x4A5A75,   // turbina
  vidro: 0x16243D,                                                                      // para-brisa
};

/** 'largo' para fuselagem larga; 'estreito' para o resto (inclui desconhecido). */
export function familia(tipo) {
  return /^(A3[3-8]|A35K|B7[4-8]|B77W|B78X|MD1|DC10|IL9|L101)/i.test(String(tipo || '')) ? 'largo' : 'estreito';
}

/** Medidas por família, em frações do comprimento L (que é em unidades do globo). */
const MEDIDAS = {
  estreito: { L: .026, raio: .055, envergadura: .98, motorRaio: .042, motorX: .17, motorComp: .16 },
  largo: { L: .034, raio: .05, envergadura: .96, motorRaio: .05, motorX: .19, motorComp: .17 },
};

function material(cor, extra = {}) {
  return new THREE.MeshLambertMaterial({ color: cor, flatShading: true, transparent: true, ...extra });
}

/**
 * Turbina: nacele aberta na frente (dá para ver o fan escuro e o cone), borda clara na entrada,
 * bocal de escape mais estreito atrás e um pilone até a asa. Eixo do motor em Z, frente para +Z.
 * @param {number} r raio da entrada
 * @param {number} comp comprimento da nacele
 * @param {number} alturaPilone distância do topo da nacele até a asa
 */
function turbina(r, comp, alturaPilone, mats) {
  const g = new THREE.Group();
  // Nacele: perfil de torno, mais larga um pouco atrás da entrada e afinando para o escape.
  const perfil = [[.92, .5], [1, .44], [1.03, .2], [.96, -.2], [.78, -.5]].map(([x, z]) => new THREE.Vector2(x * r, z * comp));
  const nacele = new THREE.Mesh(new THREE.LatheGeometry(perfil, 14).rotateX(Math.PI / 2), mats.nacele);
  // Borda da entrada: anel claro.
  const borda = new THREE.Mesh(new THREE.TorusGeometry(r * .95, r * .09, 4, 14), mats.borda);
  borda.position.z = .5 * comp;
  // Fan: fundo escuro um pouco para dentro; na frente dele, o rotor (pás + cone com a espiral branca,
  // como nos motores de verdade). O rotor gira em Z quando o avião está no ar (ver userData.rotores).
  const fan = new THREE.Mesh(new THREE.CircleGeometry(r * .9, 14), mats.fan);
  fan.position.z = .38 * comp;
  const rotor = new THREE.Group();
  rotor.position.z = .38 * comp;
  const geoPa = new THREE.BoxGeometry(r * .56, r * .15, r * .02).translate(r * .58, 0, 0).rotateX(.5);   // torcida, pega luz
  const PAS = 12;
  for (let i = 0; i < PAS; i++) {
    const pa = new THREE.Mesh(geoPa, mats.pa);
    pa.rotation.z = (i / PAS) * Math.PI * 2;
    pa.position.z = r * .01;
    rotor.add(pa);
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r * .32, r * .55, 8).rotateX(Math.PI / 2), mats.cone);
  cone.position.z = r * .27;
  // Espiral: uma fatia branca do cone, um pouco maior; girando, mostra que o motor está ligado.
  const espiral = new THREE.Mesh(new THREE.ConeGeometry(r * .335, r * .57, 8, 1, false, 0, Math.PI * .45).rotateX(Math.PI / 2), mats.espiral);
  espiral.position.z = r * .27;
  rotor.add(cone, espiral);
  // Escape: bocal cinza saindo de trás, com o cone de cauda.
  const escape = new THREE.Mesh(new THREE.CylinderGeometry(r * .7, r * .55, comp * .16, 12, 1, true).rotateX(Math.PI / 2), mats.escape);
  escape.position.z = -.58 * comp;
  const plug = new THREE.Mesh(new THREE.ConeGeometry(r * .4, comp * .22, 8).rotateX(-Math.PI / 2), mats.fan);
  plug.position.z = -.7 * comp;
  // Pilone: lâmina fina do topo da nacele até a asa.
  const pilone = new THREE.Mesh(new THREE.BoxGeometry(r * .22, alturaPilone + r * .3, comp * .6), mats.nacele);
  pilone.position.set(0, r + alturaPilone / 2, -.05 * comp);
  g.add(nacele, borda, fan, rotor, escape, plug, pilone);
  g.userData.rotor = rotor;
  return g;
}

/** Asa (ou estabilizador) de um lado: trapézio enflechado, espessura `esp` para baixo. sinal +1 direita, −1 esquerda. */
function asa({ raiz, ponta, zRaizFrente, zRaizTras, zPontaFrente, zPontaTras, esp }, sinal) {
  const s = new THREE.Shape([
    new THREE.Vector2(sinal * raiz, zRaizFrente), new THREE.Vector2(sinal * ponta, zPontaFrente),
    new THREE.Vector2(sinal * ponta, zPontaTras), new THREE.Vector2(sinal * raiz, zRaizTras),
  ]);
  // Shape no plano (x, z): depois do rotateX(π/2), y da forma vira +Z e a espessura vai para −Y.
  return new THREE.ExtrudeGeometry(s, { depth: esp, bevelEnabled: false }).rotateX(Math.PI / 2);
}

/**
 * Monta o avião. Devolve um Group com userData.materiais (para o realce de opacidade do globo).
 * @param {'estreito'|'largo'} fam
 */
export function criarAviao3d(fam = 'estreito') {
  const m = MEDIDAS[fam] || MEDIDAS.estreito;
  const L = m.L, R = m.raio * L, meia = m.envergadura * L / 2;
  const mCorpo = material(COR.corpo), mAsa = material(COR.asa), mCauda = material(COR.cauda);
  const mTurbina = {
    nacele: material(COR.nacele, { side: THREE.DoubleSide }), borda: material(COR.borda),
    fan: material(COR.fan, { side: THREE.DoubleSide }), pa: material(COR.pa), cone: material(COR.cone), espiral: material(COR.espiral),
    escape: material(COR.escape, { side: THREE.DoubleSide }),
  };
  const mVidro = material(COR.vidro);
  const g = new THREE.Group();

  // Fuselagem: torno de um perfil (cauda em −L/2, nariz em +L/2), girado para o eixo Z.
  const perfil = [[0, -.5], [.25, -.48], [.62, -.38], [.92, -.24], [1, -.12], [1, .3], [.93, .39], [.72, .45], [.38, .49], [0, .5]]
    .map(([r, y]) => new THREE.Vector2(r * R, y * L));
  const fus = new THREE.Mesh(new THREE.LatheGeometry(perfil, 10).rotateX(Math.PI / 2), mCorpo);
  fus.scale.y = 1.05;   // um pouco mais alta que larga
  g.add(fus);

  // Para-brisa: faixa escura de 4 painéis no alto do nariz, logo acima da fuselagem. No torno, o
  // ângulo π fica para cima depois do rotateX(π/2); a faixa cobre ~100° em volta dele.
  const trecho = [[.99, .33], [.93, .39], [.78, .44]].map(([r, y]) => new THREE.Vector2(r * R * 1.025, y * L));
  const abertura = 2.1;
  const vidro = new THREE.Mesh(new THREE.LatheGeometry(trecho, 4, Math.PI - abertura / 2, abertura).rotateX(Math.PI / 2), mVidro);
  vidro.scale.y = 1.05;
  g.add(vidro);

  // Asas: raiz no meio da fuselagem, enflechadas para trás.
  const dimAsa = { raiz: R * .6, ponta: meia, zRaizFrente: .1 * L, zRaizTras: -.14 * L, zPontaFrente: -.16 * L, zPontaTras: -.25 * L, esp: .012 * L };
  for (const sinal of [1, -1]) {
    const a = new THREE.Mesh(asa(dimAsa, sinal), mAsa);
    a.position.y = -R * .35;
    g.add(a);
  }

  // Estabilizadores horizontais.
  const dimEst = { raiz: R * .1, ponta: .19 * L, zRaizFrente: -.36 * L, zRaizTras: -.47 * L, zPontaFrente: -.44 * L, zPontaTras: -.49 * L, esp: .008 * L };
  for (const sinal of [1, -1]) {
    const e = new THREE.Mesh(asa(dimEst, sinal), mAsa);
    e.position.y = R * .08;     // dentro da cauda, que ali já é fina
    g.add(e);
  }

  // Deriva (cauda vertical) em azul-céu, a cor de "em voo" da marca.
  // A base desce junto com a fuselagem, que afina na cauda (senão a parte de trás fica flutuando).
  const topo = .7 * R + .2 * L;
  const deriva = new THREE.Shape([
    new THREE.Vector2(-.32 * L, .7 * R), new THREE.Vector2(-.47 * L, topo), new THREE.Vector2(-.51 * L, topo), new THREE.Vector2(-.495 * L, .02 * R),
  ]);
  // Forma no plano (z, y): rotateY(−π/2) leva o x da forma para +Z; a espessura fica no eixo X, centrada.
  const geoDeriva = new THREE.ExtrudeGeometry(deriva, { depth: .012 * L, bevelEnabled: false }).translate(0, 0, -.006 * L).rotateY(-Math.PI / 2);
  const d = new THREE.Mesh(geoDeriva, mCauda);
  g.add(d);

  // Turbinas sob as asas, um pouco à frente do bordo de ataque (como nos jatos de verdade).
  const rM = m.motorRaio * L, folgaAsa = rM * .35, rotores = [];
  for (const sinal of [1, -1]) {
    const t = turbina(rM, m.motorComp * L, folgaAsa, mTurbina);
    t.position.set(sinal * m.motorX * m.envergadura * L, -R * .35 - .012 * L - folgaAsa - rM, .02 * L);
    g.add(t);
    rotores.push(t.userData.rotor);
  }
  g.userData.rotores = rotores;

  g.userData.materiais = [mCorpo, mAsa, mCauda, mVidro, ...Object.values(mTurbina)];
  g.userData.comprimento = L;
  // Quanto o avião desce abaixo do centro (as turbinas penduradas): usado para não afundar no chão.
  g.userData.fundo = -new THREE.Box3().setFromObject(g).min.y;
  return g;
}

/** Sombra no chão: elipse escura do tamanho do avião, deitada na superfície (eixos iguais aos do avião). */
export function criarSombra(fam = 'estreito') {
  const L = (MEDIDAS[fam] || MEDIDAS.estreito).L;
  const mat = new THREE.MeshBasicMaterial({ color: COR.sombra, transparent: true, opacity: .4, depthWrite: false });
  const geo = new THREE.CircleGeometry(.5, 20).rotateX(-Math.PI / 2).scale(L * .8, 1, L);
  const s = new THREE.Mesh(geo, mat);
  s.userData.materiais = [mat];
  return s;
}
