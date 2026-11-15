/* Voa Aí · avião 3D low-poly, feito só com geometria (sem arquivo de modelo para baixar).
   Duas famílias, pelo aircraft_type da AeroAPI (docs/06-v2-3d.md):
   - 'estreito': corredor único (A320, 737, E190…) e qualquer tipo desconhecido;
   - 'largo': fuselagem larga (A330, A350, A380, 747, 767, 777, 787…).
   Eixos do modelo iguais aos do marcador do globo: nariz para +Z, topo para +Y, asa direita para +X.
   O tamanho é exagerado de propósito (o globo tem raio 1): um avião em escala real seria invisível. */
import * as THREE from 'three';

const COR = { corpo: 0xF2F5FA, asa: 0xC4CFDF, motor: 0x8FA3C2, cauda: 0x5CC8FF, sombra: 0x02060E };

/** 'largo' para fuselagem larga; 'estreito' para o resto (inclui desconhecido). */
export function familia(tipo) {
  return /^(A3[3-8]|A35K|B7[4-8]|B77W|B78X|MD1|DC10|IL9|L101)/i.test(String(tipo || '')) ? 'largo' : 'estreito';
}

/** Medidas por família, em frações do comprimento L (que é em unidades do globo). */
const MEDIDAS = {
  estreito: { L: .026, raio: .055, envergadura: .98, motorRaio: .042, motorX: .17, motorComp: .16 },
  largo: { L: .034, raio: .05, envergadura: .96, motorRaio: .05, motorX: .19, motorComp: .17 },
};

function material(cor) {
  return new THREE.MeshLambertMaterial({ color: cor, flatShading: true, transparent: true });
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
  const mCorpo = material(COR.corpo), mAsa = material(COR.asa), mMotor = material(COR.motor), mCauda = material(COR.cauda);
  const g = new THREE.Group();

  // Fuselagem: torno de um perfil (cauda em −L/2, nariz em +L/2), girado para o eixo Z.
  const perfil = [[0, -.5], [.25, -.48], [.62, -.38], [.92, -.24], [1, -.12], [1, .3], [.93, .39], [.72, .45], [.38, .49], [0, .5]]
    .map(([r, y]) => new THREE.Vector2(r * R, y * L));
  const fus = new THREE.Mesh(new THREE.LatheGeometry(perfil, 10).rotateX(Math.PI / 2), mCorpo);
  fus.scale.y = 1.05;   // um pouco mais alta que larga
  g.add(fus);

  // Asas: raiz no meio da fuselagem, enflechadas para trás.
  const dimAsa = { raiz: R * .6, ponta: meia, zRaizFrente: .1 * L, zRaizTras: -.14 * L, zPontaFrente: -.16 * L, zPontaTras: -.25 * L, esp: .012 * L };
  for (const sinal of [1, -1]) {
    const a = new THREE.Mesh(asa(dimAsa, sinal), mAsa);
    a.position.y = -R * .35;
    g.add(a);
  }

  // Estabilizadores horizontais.
  const dimEst = { raiz: R * .3, ponta: .19 * L, zRaizFrente: -.36 * L, zRaizTras: -.47 * L, zPontaFrente: -.44 * L, zPontaTras: -.49 * L, esp: .008 * L };
  for (const sinal of [1, -1]) {
    const e = new THREE.Mesh(asa(dimEst, sinal), mAsa);
    e.position.y = R * .25;
    g.add(e);
  }

  // Deriva (cauda vertical) em azul-céu, a cor de "em voo" da marca.
  const deriva = new THREE.Shape([
    new THREE.Vector2(-.32 * L, 0), new THREE.Vector2(-.47 * L, .2 * L), new THREE.Vector2(-.51 * L, .2 * L), new THREE.Vector2(-.49 * L, 0),
  ]);
  // Forma no plano (z, y): rotateY(−π/2) leva o x da forma para +Z; a espessura fica no eixo X, centrada.
  const geoDeriva = new THREE.ExtrudeGeometry(deriva, { depth: .012 * L, bevelEnabled: false }).translate(0, 0, -.006 * L).rotateY(-Math.PI / 2);
  const d = new THREE.Mesh(geoDeriva, mCauda);
  d.position.y = R * .7;
  g.add(d);

  // Motores sob as asas.
  const geoMotor = new THREE.CylinderGeometry(m.motorRaio * L, m.motorRaio * L * .82, m.motorComp * L, 8).rotateX(Math.PI / 2);
  for (const sinal of [1, -1]) {
    const mo = new THREE.Mesh(geoMotor, mMotor);
    mo.position.set(sinal * m.motorX * m.envergadura * L, -R * .35 - m.motorRaio * L * 1.1, .04 * L);
    g.add(mo);
  }

  g.userData.materiais = [mCorpo, mAsa, mMotor, mCauda];
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
