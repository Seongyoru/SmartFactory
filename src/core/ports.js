/**
 * =============================================================================
 *  포트(유입·유출부) 추출 — 모델 ↔ 에디터의 접점
 * =============================================================================
 *  컨베이어/레일이 설비에 "확실하게" 물리려면, 설비 모델 자체가 자기 유입구와
 *  유출구가 어디인지 알려 줘야 한다. 바운딩 박스만 보고 추측하면 설비가 조금만
 *  비대칭이어도 엉뚱한 자리에 붙는다.
 *
 *  그래서 GLB 안에 "포트 노드"를 심는 규약을 둔다. 3ds Max 기준 작업 순서와
 *  전체 규약은 docs/MODELING_GUIDE.md 에 정리해 두었다. 요약하면:
 *
 *    1) 이름 규약  — 노드 이름이 PORT_IN* / PORT_OUT* / PORT_* 이면 포트로 읽는다.
 *                   (대소문자 무시. IN_/OUT_ 로 시작해도 인정)
 *    2) 방향 규약  — 우선순위 순서로 판정한다.
 *         (a) 이름 접미사 @X+ @X- @Z+ @Z-  →  가장 확실. 회전이 어떻게 구워지든
 *                                            의도한 방향이 그대로 나온다.
 *         (b) 노드 회전의 로컬 +X 축       →  더미를 돌려서 방향을 준 경우.
 *         (c) bbox 중심에서 포트로 향하는 지배축 → 회전을 안 준 경우의 마지막 보루.
 *    3) 높이     — 포트 노드의 Y 가 곧 벨트면 높이가 된다. 컨베이어는 이 높이에
 *                  맞춰 올라간다. 그래서 더미는 "실제 자재가 지나가는 높이"에 둔다.
 *    4) 폴백     — 포트 노드가 하나도 없으면 bbox 네 변의 중앙에 자동으로
 *                  4개(N/E/S/W)를 만든다. 규약 없이 만든 기존 모델도 일단 붙는다.
 *
 *  포트 노드는 눈에 보이면 안 되므로 렌더 트리에서 숨긴다(작은 박스 메시로
 *  만들어도 됨 — 오히려 그 편이 익스포터 호환성이 좋다).
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';

const PORT_NAME = /^(port|in|out)[_\-.]/i;
const DIR_SUFFIX = /@\s*([xz])\s*([+-])/i;
/* IN/OUT 판정.
   앞뒤가 글자가 아니기만 하면 인정한다 — PORT_IN@X- 처럼 방향 접미사가
   바로 붙는 형태가 표준이라, 구분자를 _ - . 로만 한정하면 전부 놓친다.
   대신 MAIN·POINT 처럼 단어 안에 in/out 이 들어간 경우는 걸리지 않는다. */
const KIND_IN = /(^|[^a-z])(in|inlet|input|유입|입구)(?![a-z])/i;
const KIND_OUT = /(^|[^a-z])(out|outlet|output|유출|출구)(?![a-z])/i;

/** 포트 종류: 유입(in) · 유출(out) · 미지정(any) */
export const PORT_KIND = { IN: 'in', OUT: 'out', ANY: 'any' };

const AXIS_DIRS = {
  'x+': [1, 0],
  'x-': [-1, 0],
  'z+': [0, 1],
  'z-': [0, -1],
};

/** XZ 벡터를 가장 가까운 4방위로 정렬 — 포트 방향은 항상 축 정렬이어야 한다 */
export function quantizeDir([x, z]) {
  if (Math.abs(x) >= Math.abs(z)) return [Math.sign(x) || 1, 0];
  return [0, Math.sign(z) || 1];
}

/** 방향 벡터를 사람이 읽는 표기로 */
export const dirLabel = ([x, z]) => (x ? (x > 0 ? 'X+' : 'X−') : z > 0 ? 'Z+' : 'Z−');

/**
 * 두 포트를 이을 수 있는가.
 * ---------------------------------------------------------------------------
 *  자재는 유출부(OUT) → 유입부(IN) 로 흐른다. 그래서
 *    IN ↔ IN   : 자재가 양쪽에서 들어오기만 하니 성립하지 않는다
 *    OUT ↔ OUT : 양쪽에서 나가기만 하니 성립하지 않는다
 *  둘 다 막는다. 종류가 정해지지 않은 포트(any)는 어느 쪽으로든 붙는다 —
 *  포트를 정의하지 않은 기존 모델이 아예 연결되지 않는 일은 없어야 한다.
 */
export function portsCompatible(a, b) {
  if (!a || !b) return true;
  const ka = a.kind ?? PORT_KIND.ANY;
  const kb = b.kind ?? PORT_KIND.ANY;
  if (ka === PORT_KIND.ANY || kb === PORT_KIND.ANY) return true;
  return ka !== kb;
}

/** 연결이 불가능한 이유 (UI 안내용). 가능하면 null */
export function incompatibleReason(a, b) {
  if (portsCompatible(a, b)) return null;
  return a.kind === PORT_KIND.IN ? '유입부끼리는 연결할 수 없습니다' : '유출부끼리는 연결할 수 없습니다';
}

/** 이름에서 종류 판정 */
function kindFromName(name) {
  if (KIND_OUT.test(name)) return PORT_KIND.OUT;
  if (KIND_IN.test(name)) return PORT_KIND.IN;
  return PORT_KIND.ANY;
}

/**
 * GLB 씬을 훑어 포트 목록과 바운딩 박스를 얻는다.
 *  object 는 이미 clone 된 THREE.Object3D (원본 캐시를 건드리지 않기 위해).
 *  반환 좌표는 모두 "모델 로컬" 기준이다. 배치 시 rot/pos 를 적용해 월드로 옮긴다.
 */
export function analyzeModel(object) {
  object.updateMatrixWorld(true);

  /* 1) 포트 노드를 먼저 찾아 렌더에서 제외한다.
        (박스 메시로 만든 마커가 화면에 보이면 안 되므로) */
  const portNodes = [];
  object.traverse((n) => {
    const nm = n.name ?? '';
    const isPort = PORT_NAME.test(nm) || n.userData?.port !== undefined || n.userData?.extras?.port !== undefined;
    if (isPort && n !== object) portNodes.push(n);
  });
  portNodes.forEach((n) => { n.visible = false; });

  /* 2) 포트를 뺀 실제 형상만으로 bbox 를 잡는다.
        마커 박스가 bbox 를 부풀리면 풋프린트가 실제보다 커진다. */
  const box = new THREE.Box3();
  object.traverse((n) => {
    if (!n.isMesh || !n.visible) return;
    let hidden = false;
    for (let p = n; p; p = p.parent) if (p.visible === false) { hidden = true; break; }
    if (hidden) return;
    n.updateWorldMatrix(true, false);
    box.expandByObject(n);
  });
  if (box.isEmpty()) box.setFromObject(object);

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  /* 3) 포트 노드 → 포트 데이터 */
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const ports = portNodes.map((n, i) => {
    // 모델 로컬 좌표계로 환산 (object 자체에 스케일/회전이 걸려 있어도 안전)
    const local = new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld);
    const pos = new THREE.Vector3().setFromMatrixPosition(local);

    const nm = n.name ?? `PORT_${i}`;
    const extras = { ...(n.userData ?? {}), ...(n.userData?.extras ?? {}) };

    // 종류: extras 가 있으면 우선, 없으면 이름에서
    let kind = PORT_KIND.ANY;
    const ex = String(extras.port ?? extras.PORT ?? '').toLowerCase();
    if (ex === 'in' || ex === 'out') kind = ex;
    else kind = kindFromName(nm);

    // 방향 (a) 이름 접미사
    let dir = null;
    const m = DIR_SUFFIX.exec(nm);
    if (m) dir = AXIS_DIRS[`${m[1].toLowerCase()}${m[2]}`];

    // 방향 (b) 노드 회전의 로컬 +X
    if (!dir) {
      const axis = new THREE.Vector3(1, 0, 0).transformDirection(local);
      const rotated = Math.abs(axis.x - 1) > 1e-3 || Math.abs(axis.z) > 1e-3;
      if (rotated) dir = quantizeDir([axis.x, axis.z]);
    }

    // 방향 (c) bbox 중심에서 바깥쪽
    const geo = quantizeDir([pos.x - center.x, pos.z - center.z]);
    if (!dir) dir = geo;

    /* 이름과 실제 위치가 어긋난 경우 보정.
       ---------------------------------------------------------------------
       접미사는 "이 포트가 어느 쪽으로 열려 있는가" 를 적는 칸인데, 마커를
       실제로 놓은 자리와 직각으로 어긋나 있으면 둘 중 하나는 오타다.
       이때는 마커 위치를 믿는다 — 위치는 형상에서 직접 읽은 값이고,
       이름은 사람이 손으로 적은 값이기 때문이다. 대신 조용히 넘어가지 않고
       경고를 남겨 인스펙터에 표시한다. */
    let warning = null;
    const offAxis = [Math.abs(pos.x - center.x), Math.abs(pos.z - center.z)];
    const namedIsX = dir[0] !== 0;
    const alongNamed = namedIsX ? offAxis[0] : offAxis[1];
    const alongOther = namedIsX ? offAxis[1] : offAxis[0];
    if (dir[0] !== geo[0] || dir[1] !== geo[1]) {
      if (alongOther > 0.25 && alongOther > alongNamed * 3) {
        warning = `이름의 방향(${dirLabel(dir)})이 마커 위치와 어긋나 위치 기준(${dirLabel(geo)})으로 보정했습니다`;
        dir = geo;
      }
    }

    return {
      id: nm,
      kind,
      pos: [pos.x, pos.y, pos.z],
      dir,
      explicit: true,
      warning,
    };
  });

  /* 4) 폴백 — bbox 네 변 중앙에 자동 포트.
        높이는 모델 높이의 45% (일반적인 반송 높이) 로 잡는다. */
  let autoPorts = [];
  if (ports.length === 0) {
    const y = box.min.y + size.y * 0.45;
    autoPorts = [
      { id: 'AUTO_X+', dir: [1, 0], pos: [box.max.x, y, center.z] },
      { id: 'AUTO_X-', dir: [-1, 0], pos: [box.min.x, y, center.z] },
      { id: 'AUTO_Z+', dir: [0, 1], pos: [center.x, y, box.max.z] },
      { id: 'AUTO_Z-', dir: [0, -1], pos: [center.x, y, box.min.z] },
    ].map((p) => ({ ...p, kind: PORT_KIND.ANY, explicit: false }));
  }

  return {
    bbox: {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      size: [size.x, size.y, size.z],
      center: [center.x, center.y, center.z],
    },
    ports: ports.length ? ports : autoPorts,
    hasExplicitPorts: ports.length > 0,
    belt: analyzeBelt(object),
    payload: analyzePayload(object),
  };
}

/* ---------------------------------------------------------------------------
 * 적재물(OBJ) 분석 — 카트
 * ---------------------------------------------------------------------------
 *  카트 GLB 안의 `OBJ` 노드는 "싣고 다니는 물건" 이다. 평소에는 보이지 않다가
 *  설비 유출부에서 실리고 유입부에서 내려진다. 여러 개를 실을 때는 이 노드를
 *  높이만큼 쌓아 올린다.
 *
 *  노드 이름으로 찾는 이유는 벨트와 같다 — 모델러가 메시를 분리하고 이름만
 *  약속대로 붙이면, 코드가 그 모델의 내부 구조를 몰라도 동작한다.
 * ------------------------------------------------------------------------- */

const PAYLOAD_NAME = /^(obj|payload|적재물|load)\b/i;

function analyzePayload(root) {
  let node = null;
  root.traverse((n) => {
    if (!node && n !== root && PAYLOAD_NAME.test(n.name ?? '')) node = n;
  });
  if (!node) return null;

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  node.updateWorldMatrix(true, true);
  node.traverse((n) => {
    if (!n.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld);
    const pos = n.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(local));
  });
  if (box.isEmpty()) return null;

  const size = box.getSize(new THREE.Vector3());
  return {
    name: node.name,
    /** 한 단의 높이 — 이 값씩 올려 가며 쌓는다 */
    height: size.y,
    size: [size.x, size.y, size.z],
    /** 모델에 구워진 원래 자리 (1단은 여기 그대로 놓인다) */
    baseY: box.min.y,
  };
}

/* ---------------------------------------------------------------------------
 * 벨트 서브메시 분석
 * ---------------------------------------------------------------------------
 *  컨베이어 GLB 는 "프레임 + 벨트" 두 메시로 나뉘어 온다. 벨트만 따로 알아야
 *  하는 이유가 세 가지 있다.
 *
 *   1) 반송면 높이 — 자재가 실리는 면은 벨트의 윗면이다. 프레임 사이드레일이
 *      그보다 높이 솟아 있어서, 바운딩 박스 꼭대기를 쓰면 벨트가 포트 높이보다
 *      한참 아래로 가라앉는다.
 *   2) 흐름 축   — 이 모델은 가로 1.012m · 세로 1.000m 로 거의 정사각형이라
 *      "긴 쪽이 길이축" 규칙이 통하지 않는다. 대신 벨트 윗면의 UV 기울기를
 *      보면 어느 축을 따라 텍스처가 흐르도록 펴 놨는지 명확히 알 수 있다.
 *   3) UV 애니메이션 속도 — 1m 이동에 UV 가 얼마나 흐르는지(uvPerMeter).
 *      이 값이 있어야 "0.5 m/s" 같은 물리 속도로 벨트를 돌릴 수 있다.
 *
 *  UV 는 벨트 루프를 한 바퀴 감아 편 형태다. 그래서 윗면과 아랫면의 UV 기울기
 *  부호가 반대이고, U 를 한 방향으로 흘리기만 해도 윗면과 아랫면이 서로 반대로
 *  움직인다 — 실제 벨트가 도는 모습 그대로다.
 * ------------------------------------------------------------------------- */

const BELT_NAME = /belt|벨트/i;

function analyzeBelt(root) {
  const meshes = [];
  root.traverse((n) => {
    if (n.isMesh && BELT_NAME.test(n.name ?? '')) meshes.push(n);
  });
  if (!meshes.length) return null;

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();

  // 윗면(법선이 위를 향하는 정점)만 모아 UV 기울기를 최소제곱으로 잰다
  const top = { n: 0, sx: 0, sz: 0, su: 0, sxx: 0, szz: 0, sxu: 0, szu: 0 };

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const nmat = new THREE.Matrix3().getNormalMatrix(local);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(local);
      box.expandByPoint(v);
      if (!nor || !uv) continue;
      nv.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
      if (nv.y < 0.5) continue; // 윗면만
      const u = uv.getX(i);
      top.n += 1;
      top.sx += v.x; top.sz += v.z; top.su += u;
      top.sxx += v.x * v.x; top.szz += v.z * v.z;
      top.sxu += v.x * u; top.szu += v.z * u;
    }
  }

  const slope = (s1, s11, su, s1u, n) => {
    const den = n * s11 - s1 * s1;
    return Math.abs(den) < 1e-9 ? 0 : (n * s1u - s1 * su) / den;
  };
  const dUdX = top.n >= 3 ? slope(top.sx, top.sxx, top.su, top.sxu, top.n) : 0;
  const dUdZ = top.n >= 3 ? slope(top.sz, top.szz, top.su, top.szu, top.n) : 0;

  const axis = Math.abs(dUdX) > Math.abs(dUdZ) ? 'x' : 'z';
  const gradient = axis === 'x' ? dUdX : dUdZ;

  return {
    /** 벨트 윗면 = 자재가 실리는 높이 */
    deckY: box.max.y,
    bbox: { min: box.min.toArray(), max: box.max.toArray() },
    /** UV 가 흐르도록 펴진 축 — 흐름 방향 */
    axis: Math.abs(gradient) > 1e-4 ? axis : null,
    /** 흐름축 1m 당 U 변화량(부호 포함). 0 이면 UV 애니메이션 불가 */
    uvGradient: gradient,
    names: meshes.map((m) => m.name),
  };
}

/**
 * 연결장치(컨베이어/레일/전선) 한 토막의 규격을 뽑는다.
 * ---------------------------------------------------------------------------
 *  span   : 이 토막이 커버하는 길이(m). 경로를 이 길이로 나눠 타일링한다.
 *           IN/OUT 포트가 둘 다 있으면 두 포트 사이 거리가 곧 span 이다.
 *           (모델 앞뒤로 여유 살이 붙어 있어도 정확히 이어진다)
 *  axis   : 토막이 뻗은 축. 보통 'x'.
 *  deckY  : 자재가 실리는 면의 높이(m). 이 높이가 설비 포트 높이에 맞춰진다.
 *  flip   : IN→OUT 이 축의 음(-)방향이면 true. 흐름 방향을 뒤집어 붙인다.
 */
export function analyzeConnector(analysis, override = {}) {
  const { bbox, ports, hasExplicitPorts, belt } = analysis;
  const [sx, sy, sz] = bbox.size;

  const pin = ports.find((p) => p.kind === PORT_KIND.IN);
  const pout = ports.find((p) => p.kind === PORT_KIND.OUT);

  /* 흐름축 판정 — 위에서부터 우선.
     ① 라이브러리/임포트에서 사용자가 지정
     ② IN·OUT 포트가 벌어진 방향
     ③ 벨트 윗면 UV 가 흐르도록 펴진 축
     ④ bbox 가 긴 쪽 (마지막 수단)
     ③ 이 필요한 이유: 1m 피치에 1m 폭인 컨베이어는 ④ 로는 절대 못 가린다. */
  let axis = override.axis ?? null;
  let axisSource = axis ? 'override' : null;
  if (!axis && hasExplicitPorts && pin && pout) {
    const dx = Math.abs(pout.pos[0] - pin.pos[0]);
    const dz = Math.abs(pout.pos[2] - pin.pos[2]);
    if (Math.max(dx, dz) > 1e-3) { axis = dx >= dz ? 'x' : 'z'; axisSource = 'ports'; }
  }
  if (!axis && belt?.axis) { axis = belt.axis; axisSource = 'belt-uv'; }
  if (!axis) { axis = sx >= sz ? 'x' : 'z'; axisSource = 'bbox'; }

  let span = axis === 'x' ? sx : sz;
  let deckY = belt ? belt.deckY : bbox.min[1] + sy;
  let mid = [bbox.center[0], bbox.center[2]];

  if (hasExplicitPorts && pin && pout) {
    span = Math.hypot(pout.pos[0] - pin.pos[0], pout.pos[2] - pin.pos[2]);
    deckY = (pin.pos[1] + pout.pos[1]) / 2;
    mid = [(pin.pos[0] + pout.pos[0]) / 2, (pin.pos[2] + pout.pos[2]) / 2];
  }

  const safeSpan = span > 1e-3 ? span : 1;
  const midAxis = axis === 'x' ? mid[0] : mid[1];
  const nativeWidth = axis === 'x' ? sz : sx;

  return {
    span: safeSpan,
    axis,
    axisSource,
    deckY,
    /** 길이축에서 "한 피치가 시작되는 좌표". 포트 기준이라 모델 앞뒤 여유살은
     *  이 범위 밖으로 삐져나오고, 그만큼 이웃 타일과 자연스럽게 맞물린다. */
    axisStart: midAxis - safeSpan / 2,
    /** 폭 방향 중심 — 이 선이 경로 중심선 위에 놓인다 */
    crossMid: axis === 'x' ? mid[1] : mid[0],
    /** 모델이 원래 가진 폭(m). 사용자가 바꾸는 폭은 이 값 대비 배율이 된다 */
    nativeWidth: nativeWidth > 1e-3 ? nativeWidth : 1,
    flip: !!(pin && pout) && (axis === 'x' ? pout.pos[0] < pin.pos[0] : pout.pos[2] < pin.pos[2]),
    /** 벨트 UV 애니메이션 정보 (없으면 null) */
    belt: belt && belt.uvGradient
      ? { names: belt.names, uvGradient: belt.uvGradient, deckY: belt.deckY }
      : null,
  };
}

/** 배치된 설비의 포트를 월드 좌표로 변환 (spec = analyzeModel 결과) */
export function worldPorts(placed, spec) {
  if (!spec?.ports) return [];
  const rot = placed.rot ?? 0;
  return spec.ports.map((p) => {
    const [px, pz] = rotateXZ2([p.pos[0], p.pos[2]], rot);
    const [dx, dz] = rotateXZ2(p.dir, rot);
    return {
      ...p,
      uid: placed.uid,
      key: `${placed.uid}:${p.id}`,
      world: [placed.pos[0] + px, (placed.y ?? 0) + p.pos[1], placed.pos[1] + pz],
      dir: [dx, dz],
    };
  });
}

/* grid.js 의 rotateXZ 와 같은 식 — 순환 import 를 피하려고 여기 한 벌 둔다 */
function rotateXZ2([x, z], rot) {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}
