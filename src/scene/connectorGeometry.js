/**
 * =============================================================================
 *  연결장치 지오메트리 — "모델이 거리에 맞춰 연장되고, 커브를 따라 휜다"
 * =============================================================================
 *  요구사항의 핵심. 컨베이어 한 토막짜리 GLB 를 경로 길이에 맞게 반복(타일링)
 *  하되, 토막을 그냥 늘어놓기만 하면 코너에서 각지고 틈이 벌어진다.
 *  그래서 타일마다 정점을 경로 위로 "휘어" 굽힌다(패스 디폼).
 *
 *  ── 원리 ──────────────────────────────────────────────────────────────────
 *   모델의 길이축(보통 X) 좌표를 0..1 로 정규화해서, 그 타일이 담당하는
 *   호 길이 구간 [s0, s1] 에 대응시킨다. 그 지점의 경로 좌표와 접선을 구해
 *
 *      새 위치 = 경로점 + 좌우벡터 × (모델의 폭 방향 좌표)
 *                        + 위 벡터 × (모델 높이 − 벨트면 높이)
 *
 *   로 옮긴다. 접선이 도는 코너에서는 좌우벡터도 같이 돌기 때문에 모델이
 *   자연스럽게 휘어진다.
 *
 *  ── 왜 원본 메시를 잘라야 하는가 ─────────────────────────────────────────
 *   디폼은 "있는 정점" 만 옮긴다. 5m 짜리 상자는 양 끝에만 정점이 있어서,
 *   그대로 휘면 코너를 직선으로 가로질러 버린다. 타일을 잘게 쪼개는 방법도
 *   있지만 그러면 롤러·프레임 같은 형상이 코너에서만 촘촘해져 딴 물건이 된다.
 *   그래서 정답은 "타일 개수는 그대로 두고, 원본 메시를 길이축으로 미리 썰어
 *   정점을 늘려 두는 것" 이다. 토막의 실제 비율은 유지되면서 곡선을 탄다.
 *   썰기는 모델·분할수 조합마다 한 번만 하고 캐시한다.
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';

/** 한 조각이 감당할 회전량(라디안) — 7.5° 정도면 눈에 각이 안 보인다 */
const TURN_PER_SLICE = 0.13;

/** 썰기로 늘릴 수 있는 삼각형 예산 (무거운 CAD 모델 보호) */
const TRI_BUDGET = 40000;

/* --------------------------------------------------------------------------
 * 원본 메시 → 로컬 좌표로 구운 정점 배열
 * ------------------------------------------------------------------------ */

export function extractParts(spec) {
  const parts = [];
  const root = spec.scene;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  root.traverse((n) => {
    if (!n.isMesh || n.visible === false) return;
    let hidden = false;
    for (let p = n; p && p !== root; p = p.parent) if (p.visible === false) hidden = true;
    if (hidden) return;

    const g = n.geometry;
    const local = new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld);
    const normalMat = new THREE.Matrix3().getNormalMatrix(local);

    const src = g.index ? g.toNonIndexed() : g;
    const posAttr = src.attributes.position;
    const norAttr = src.attributes.normal;
    const uvAttr = src.attributes.uv;

    const count = posAttr.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = uvAttr ? new Float32Array(count * 2) : null;

    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(local);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      if (norAttr) {
        nv.fromBufferAttribute(norAttr, i).applyMatrix3(normalMat).normalize();
        nor[i * 3] = nv.x; nor[i * 3 + 1] = nv.y; nor[i * 3 + 2] = nv.z;
      } else {
        nor[i * 3 + 1] = 1;
      }
      if (uv) { uv[i * 2] = uvAttr.getX(i); uv[i * 2 + 1] = uvAttr.getY(i); }
    }
    if (src !== g) src.dispose();

    parts.push({
      pos, nor, uv, count,
      material: n.material,
      name: n.name ?? '',
      /** 벨트 파트는 UV 를 흘려 구동감을 준다 (ConnectorView 에서 처리) */
      isBelt: !!spec.connector?.belt?.names?.includes(n.name),
    });
  });
  return parts;
}

/* --------------------------------------------------------------------------
 * 길이축 방향으로 메시 썰기
 * ------------------------------------------------------------------------ */

const lerpV = (a, b, t) => ({
  p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
  n: [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t],
  u: a.u ? [a.u[0] + (b.u[0] - a.u[0]) * t, a.u[1] + (b.u[1] - a.u[1]) * t] : null,
});

/** 삼각형을 축에 수직인 평면으로 자른다. 와인딩(앞뒤면)은 그대로 보존된다. */
function splitTriangle(tri, ai, value) {
  const d = [tri[0].p[ai] - value, tri[1].p[ai] - value, tri[2].p[ai] - value];
  const belowCount = d.filter((x) => x < 0).length;
  if (belowCount === 3) return { below: [tri], above: [] };
  if (belowCount === 0) return { below: [], above: [tri] };

  // 홀로 떨어진 정점 A 를 찾는다 (나머지 둘 B, C 는 평면 반대편)
  const lone = belowCount === 1 ? d.findIndex((x) => x < 0) : d.findIndex((x) => x >= 0);
  const A = tri[lone];
  const B = tri[(lone + 1) % 3];
  const C = tri[(lone + 2) % 3];

  const t01 = (value - A.p[ai]) / (B.p[ai] - A.p[ai] || 1e-9);
  const t02 = (value - A.p[ai]) / (C.p[ai] - A.p[ai] || 1e-9);
  const P = lerpV(A, B, Math.max(0, Math.min(1, t01)));
  const Q = lerpV(A, C, Math.max(0, Math.min(1, t02)));

  const single = [A, P, Q];
  const quad = [[P, B, C], [P, C, Q]];
  return belowCount === 1 ? { below: [single], above: quad } : { below: quad, above: [single] };
}

/** part 를 길이축으로 slices 등분해 정점을 늘린다 */
function slicePart(part, ai, axisMin, axisLen, slices) {
  if (slices <= 1) return part;
  const step = axisLen / slices;

  const P = [];
  const N = [];
  const U = part.uv ? [] : null;

  const vertexAt = (i) => ({
    p: [part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]],
    n: [part.nor[i * 3], part.nor[i * 3 + 1], part.nor[i * 3 + 2]],
    u: part.uv ? [part.uv[i * 2], part.uv[i * 2 + 1]] : null,
  });
  const emit = (tri) => {
    for (const v of tri) {
      P.push(v.p[0], v.p[1], v.p[2]);
      N.push(v.n[0], v.n[1], v.n[2]);
      if (U) U.push(v.u[0], v.u[1]);
    }
  };

  for (let i = 0; i + 2 < part.count; i += 3) {
    const tri = [vertexAt(i), vertexAt(i + 1), vertexAt(i + 2)];
    const lo = Math.min(tri[0].p[ai], tri[1].p[ai], tri[2].p[ai]);
    const hi = Math.max(tri[0].p[ai], tri[1].p[ai], tri[2].p[ai]);
    const k0 = Math.max(1, Math.ceil((lo - axisMin) / step));
    const k1 = Math.min(slices - 1, Math.floor((hi - axisMin) / step));

    let current = [tri];
    for (let k = k0; k <= k1 && current.length; k++) {
      const plane = axisMin + k * step;
      const next = [];
      for (const t of current) {
        const { below, above } = splitTriangle(t, ai, plane);
        below.forEach(emit);
        next.push(...above);
      }
      current = next;
    }
    current.forEach(emit);
  }

  return {
    pos: new Float32Array(P),
    nor: new Float32Array(N),
    uv: U ? new Float32Array(U) : null,
    count: P.length / 3,
    material: part.material,
    name: part.name,
    isBelt: part.isBelt,
  };
}

/**
 * 경로의 굽힘 정도에 맞춰 필요한 분할 수를 정한다.
 *  직선이면 1(썰지 않음). 코너 반경이 작을수록 잘게 썬다.
 */
export function sliceCountFor(path, span, radius) {
  if (path.pts.length <= 2) return 1;                       // 꺾임 없음
  const arcStep = Math.max(0.05, (radius || 1) * TURN_PER_SLICE);
  return Math.max(1, Math.min(64, Math.ceil(span / arcStep)));
}

/** 분할된 파트를 모델·분할수 조합으로 캐시 */
function getParts(spec, slices) {
  if (!spec.__parts) spec.__parts = extractParts(spec);
  if (slices <= 1) return spec.__parts;

  if (!spec.__sliced) spec.__sliced = new Map();
  if (spec.__sliced.has(slices)) return spec.__sliced.get(slices);

  const ai = spec.connector.axis === 'x' ? 0 : 2;
  const axisMin = spec.bbox.min[ai];
  const axisLen = spec.bbox.max[ai] - axisMin || 1;

  // 삼각형 예산을 넘지 않도록 분할 수를 낮춘다
  const srcTris = spec.__parts.reduce((s, p) => s + p.count / 3, 0) || 1;
  const capped = Math.max(1, Math.min(slices, Math.floor(TRI_BUDGET / srcTris)));

  const result = spec.__parts.map((p) => slicePart(p, ai, axisMin, axisLen, capped));
  spec.__sliced.set(slices, result);
  return result;
}

/* --------------------------------------------------------------------------
 * 타일 배치
 * ------------------------------------------------------------------------ */

/**
 * 타일 개수 — 경로 길이를 토막 길이로 나눠 반올림.
 *  각 타일은 (경로길이 / 개수) 만큼을 담당하므로 합이 정확히 경로 길이가 되고
 *  틈이나 겹침이 생기지 않는다. 원본 대비 늘어난 비율은 최대 ±50% 지만,
 *  실제로는 경로가 길수록 1 에 수렴한다.
 */
export function tileCount(path, span) {
  const L = path.length;
  if (L < 1e-4 || span < 1e-4) return 1;
  return Math.max(1, Math.min(400, Math.round(L / span)));
}

/**
 * 경로를 따라 휘어진 타일 지오메트리를 만든다.
 * @returns { parts: [{ geometry, material }], tiles, slices }
 */
export function buildTiledGeometry(spec, path, { radius = 1, widthScale = 1 } = {}) {
  const conn = spec.connector;
  const bb = spec.bbox;

  const axisIdx = conn.axis === 'x' ? 0 : 2;
  const crossIdx = conn.axis === 'x' ? 2 : 0;

  const slices = sliceCountFor(path, conn.span, radius);
  const parts = getParts(spec, slices);

  const n = tileCount(path, conn.span);
  const seg = path.length / n;
  /* 정규화 기준은 bbox 가 아니라 "포트가 정의한 한 피치" 다.
     모델 앞뒤로 여유살이 있어도 피치는 정확히 유지되고, 여유살은 u<0 / u>1
     구간으로 나가 이웃 타일과 겹치며 맞물린다. */
  const axisStart = conn.axisStart;
  const pitch = conn.span || 1;
  const crossMid = conn.crossMid ?? (conn.axis === 'x' ? bb.center[2] : bb.center[0]);
  const deckY = conn.deckY;

  const out = [];
  for (const part of parts) {
    const total = part.count * n;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = part.uv ? new Float32Array(total * 2) : null;

    for (let t = 0; t < n; t++) {
      const s0 = t * seg;
      const base = t * part.count;
      for (let i = 0; i < part.count; i++) {
        const px = part.pos[i * 3];
        const py = part.pos[i * 3 + 1];
        const pz = part.pos[i * 3 + 2];
        const a = axisIdx === 0 ? px : pz;
        const c = crossIdx === 0 ? px : pz;

        let u = (a - axisStart) / pitch;
        if (conn.flip) u = 1 - u;

        const f = path.at(s0 + u * seg);
        const [tx, tz] = f.tan;
        const perpX = -tz;   // RotY 기준 모델 +Z 가 향하는 방향
        const perpZ = tx;
        // 폭 배율은 중심선 기준으로 좌우를 벌린다 (길이·높이는 그대로)
        const cross = (c - crossMid) * widthScale;

        const o = (base + i) * 3;
        pos[o] = f.pos[0] + perpX * cross;
        pos[o + 1] = f.pos[1] + (py - deckY);
        pos[o + 2] = f.pos[2] + perpZ * cross;

        const nx = part.nor[i * 3];
        const ny = part.nor[i * 3 + 1];
        const nz = part.nor[i * 3 + 2];
        const na = axisIdx === 0 ? nx : nz;
        const nc = crossIdx === 0 ? nx : nz;
        const sgn = conn.flip ? -1 : 1;
        nor[o] = tx * na * sgn + perpX * nc;
        nor[o + 1] = ny;
        nor[o + 2] = tz * na * sgn + perpZ * nc;

        if (uv) {
          uv[(base + i) * 2] = part.uv[i * 2];
          uv[(base + i) * 2 + 1] = part.uv[i * 2 + 1];
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.computeBoundingSphere();
    out.push({ geometry, material: part.material, isBelt: part.isBelt, name: part.name });
  }
  return { parts: out, tiles: n, slices };
}

/* --------------------------------------------------------------------------
 * 절차적 튜브 (전선 · 배관)
 * ------------------------------------------------------------------------ */

/** sag 가 있으면 가운데를 늘어뜨린다 — 전선은 팽팽하면 어색하다 */
export function buildTubeGeometry(path, { radius = 0.05, sag = 0, segments = null } = {}) {
  const L = Math.max(path.length, 0.01);
  const steps = segments ?? Math.max(12, Math.ceil(L * 4));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const f = path.at(t * L);
    const drop = sag > 0 ? Math.sin(Math.PI * t) * Math.min(sag * L * 0.25, sag * 4) : 0;
    pts.push(new THREE.Vector3(f.pos[0], f.pos[1] - drop, f.pos[2]));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
  return new THREE.TubeGeometry(curve, Math.max(steps, 16), radius, 8, false);
}

/** 클릭 판정용 굵은 튜브 */
export function buildHitGeometry(path) {
  return buildTubeGeometry(path, { radius: 0.45, sag: 0, segments: Math.max(8, Math.ceil(path.length)) });
}
