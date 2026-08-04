/**
 * =============================================================================
 *  연결장치 경로 계산 (직교 라우팅 + 코너 필렛)
 * =============================================================================
 *  컨베이어·레일·전선은 "설비 A 의 유출 포트 → 설비 B 의 유입 포트" 로 놓인다.
 *  이때 필요한 성질:
 *
 *   1. 포트에서 빠져나오는 방향이 지켜져야 한다.
 *      설비 옆구리에서 벨트가 비스듬히 튀어나오면 안 된다. 그래서 양 끝에
 *      짧은 직선(stub)을 강제로 붙이고, 그 뒤부터 경로를 꺾는다.
 *   2. 경로는 축 정렬 직교 경로다. 공장 도면은 대각선을 쓰지 않는다.
 *   3. 꺾이는 곳은 곡선(필렛)이어야 한다. 컨베이어가 직각으로 꺾일 수는 없다.
 *      코너 반경은 사용자가 조절하고, 짧은 구간에서는 자동으로 줄어든다.
 *   4. 길이는 두 포트의 실제 거리에서 계산된다. 모델은 이 길이에 맞춰
 *      "연장"된다(타일링) — connector.js 참고.
 *
 *  경로 해법은 출발 포트를 원점·+u 축으로 삼는 로컬 좌표계에서 푼다.
 *  이렇게 하면 8방향 조합을 따질 필요 없이 "도착 방향" 4가지만 다루면 된다.
 * ---------------------------------------------------------------------------
 */

const EPS = 1e-6;

/* --------------------------------------------------------------------------
 * 직교 폴리라인 생성
 * ------------------------------------------------------------------------ */

/**
 * @param a {p:[x,z], dir:[dx,dz]}  출발 포트 (dir = 밖으로 나가는 방향)
 * @param b {p:[x,z], dir:[dx,dz]}  도착 포트 (dir = 밖으로 나가는 방향)
 * @param opts {stub, clearance}
 * @returns [[x,z], ...] 축 정렬 폴리라인
 */
export function orthoRoute(a, b, { stub = 0.5, clearance = 1.2 } = {}) {
  const a1 = [a.p[0] + a.dir[0] * stub, a.p[1] + a.dir[1] * stub];
  const b1 = [b.p[0] + b.dir[0] * stub, b.p[1] + b.dir[1] * stub];

  // 로컬 좌표계: 원점 a1, +u = a.dir, +v = a.dir 를 좌회전
  const u = a.dir;
  const v = [-a.dir[1], a.dir[0]];
  const toLocal = (p) => {
    const dx = p[0] - a1[0];
    const dz = p[1] - a1[1];
    return [dx * u[0] + dz * u[1], dx * v[0] + dz * v[1]];
  };
  const toWorld = ([lu, lv]) => [a1[0] + u[0] * lu + v[0] * lv, a1[1] + u[1] * lu + v[1] * lv];

  const t = toLocal(b1);
  // 도착 시 진행 방향 = 도착 포트 바깥방향의 반대
  const arrive = [-b.dir[0], -b.dir[1]];
  const av = [arrive[0] * u[0] + arrive[1] * u[1], arrive[0] * v[0] + arrive[1] * v[1]].map((n) => Math.round(n));

  const C = Math.max(clearance, 0.3);
  const L = C; // 우회 차선 폭
  const [tu, tv] = t;
  let pts;

  if (av[0] === 1) {
    /* 같은 방향으로 진행하며 도착 */
    if (Math.abs(tv) < EPS && tu > EPS) {
      pts = [[0, 0], [tu, 0]];                                   // 일직선
    } else if (tu > C) {
      const mu = tu / 2;
      pts = [[0, 0], [mu, 0], [mu, tv], [tu, tv]];               // Z 자
    } else {
      const w = tv >= 0 ? tv + L : tv - L;                       // 뒤로 돌아 들어가기
      pts = [[0, 0], [C, 0], [C, w], [tu - C, w], [tu - C, tv], [tu, tv]];
    }
  } else if (av[0] === -1) {
    /* 마주보고 도착 */
    let mu = Math.max(tu, 0) + C;
    if (Math.abs(tv) < EPS) {
      if (mu <= C) mu = C + L;
      pts = [[0, 0], [C, 0], [C, L], [mu, L], [mu, 0], [tu, 0]];
    } else {
      pts = [[0, 0], [mu, 0], [mu, tv], [tu, tv]];               // U 자
    }
  } else {
    /* 직각으로 도착 (av = [0, ±1]) */
    const s = av[1];
    if (tu > C && tv * s > EPS) {
      pts = [[0, 0], [tu, 0], [tu, tv]];                         // L 자
    } else {
      const mu = tu > C ? tu / 2 : C;
      const w = tv - s * C;
      pts = [[0, 0], [mu, 0], [mu, w], [tu, w], [tu, tv]];       // S 자
    }
  }

  const world = pts.map(toWorld);
  return dedupe([a.p, ...world, b.p]);
}

/** 사용자가 중간점을 찍은 경우: 구간마다 직교로 이어 붙인다 */
export function orthoRouteVia(a, b, waypoints, opts) {
  if (!waypoints?.length) return orthoRoute(a, b, opts);

  const pts = [a.p];
  let cur = { p: a.p, dir: a.dir };
  for (const w of waypoints) {
    // 중간점으로 갈 때는 진입 방향을 자유롭게 둔다 → 지배축 기준 L 자
    const seg = elbow(cur.p, w, cur.dir);
    pts.push(...seg.slice(1));
    cur = { p: w, dir: seg.length >= 2 ? unit(sub(w, seg[seg.length - 2])) : cur.dir };
  }
  const tail = orthoRoute({ p: cur.p, dir: cur.dir }, b, { ...opts, stub: 0 });
  pts.push(...tail.slice(1));
  return dedupe(pts);
}

/** 현재 진행방향을 살려 두 점을 L 자로 잇는다 */
function elbow(from, to, dir) {
  const horizontal = Math.abs(dir[0]) > Math.abs(dir[1]);
  const mid = horizontal ? [to[0], from[1]] : [from[0], to[1]];
  return dedupe([from, mid, to]);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

/** 같은 점 · 일직선상의 불필요한 점 제거 */
export function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-4 && Math.abs(last[1] - p[1]) < 1e-4) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const c = out[i + 1];
    const b = out[i];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const forward = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) < 1e-4 && forward > 0) out.splice(i, 1);
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 코너 필렛 + 샘플링
 * ------------------------------------------------------------------------ */

/**
 * 폴리라인의 각 꼭짓점을 반경 r 의 원호로 둥글린다.
 *  r 은 양옆 구간 길이의 절반을 넘지 못하게 자동으로 줄인다. 짧은 구간에
 *  큰 반경을 주면 원호끼리 겹쳐 경로가 뒤집히기 때문이다.
 */
export function filletPolyline(pts, radius, arcSteps = 8, closed = false) {
  if (pts.length < 3 || radius <= 0) return pts.map((p) => [...p]);

  /* 닫힌 경로는 첫 점도 꼭짓점이다. 열린 경로에서는 양 끝이 그대로 남아야
     포트에서 곧게 빠져나오는 성질이 지켜지므로 구간을 다르게 잡는다. */
  const n = pts.length;
  const first = closed ? 0 : 1;
  const last = closed ? n - 1 : n - 2;
  const at = (i) => pts[((i % n) + n) % n];

  const out = closed ? [] : [pts[0]];
  for (let i = first; i <= last; i++) {
    const P = at(i);
    const A = at(i - 1);
    const B = at(i + 1);
    const d1 = unit(sub(A, P));
    const d2 = unit(sub(B, P));
    const lenA = Math.hypot(A[0] - P[0], A[1] - P[1]);
    const lenB = Math.hypot(B[0] - P[0], B[1] - P[1]);
    if (lenA < 1e-6 || lenB < 1e-6) { out.push(P); continue; }

    const cosT = Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]));
    const theta = Math.acos(cosT);                    // 두 변이 이루는 내각
    if (theta > Math.PI - 1e-3 || theta < 1e-3) { out.push(P); continue; }

    const tanHalf = Math.tan(theta / 2);
    let r = radius;
    let tlen = r / tanHalf;                           // 꼭짓점에서 접점까지 거리
    const maxT = Math.min(lenA, lenB) * 0.5;
    if (tlen > maxT) { tlen = maxT; r = tlen * tanHalf; }

    const T1 = [P[0] + d1[0] * tlen, P[1] + d1[1] * tlen];
    const T2 = [P[0] + d2[0] * tlen, P[1] + d2[1] * tlen];

    // 원호 중심 = 꼭짓점에서 두 변의 이등분 방향으로 r/sin(θ/2)
    const bis = unit([d1[0] + d2[0], d1[1] + d2[1]]);
    const dist = r / Math.sin(theta / 2);
    const Cc = [P[0] + bis[0] * dist, P[1] + bis[1] * dist];

    const a1 = Math.atan2(T1[1] - Cc[1], T1[0] - Cc[0]);
    let a2 = Math.atan2(T2[1] - Cc[1], T2[0] - Cc[0]);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;

    out.push(T1);
    for (let s = 1; s < arcSteps; s++) {
      const ang = a1 + (da * s) / arcSteps;
      out.push([Cc[0] + Math.cos(ang) * r, Cc[1] + Math.sin(ang) * r]);
    }
    out.push(T2);
  }
  if (closed) out.push(out[0]);          // 시작점으로 되돌아와 고리를 닫는다
  else out.push(pts[pts.length - 1]);
  return dedupe(out);
}

/* --------------------------------------------------------------------------
 * 자유 경로 (카트 순찰 · 사용자가 찍은 경유점)
 * ------------------------------------------------------------------------ */

/**
 * 클릭한 점들을 그대로 이어 만든 경로.
 * ---------------------------------------------------------------------------
 *  연결장치는 포트 방향을 지켜야 해서 직교 라우팅을 하지만, 카트 순찰 경로는
 *  "사람이 통로를 따라 찍은 선" 그 자체가 정답이다. 그래서 점을 이은 뒤
 *  모서리만 둥글린다 — 찍은 대로 나오는 게 가장 예측 가능하다.
 */
export function buildFreePath(points, { closed = false, radius = 1, y = 0 } = {}) {
  const pts = dedupe(points.map((p) => [...p]));
  if (pts.length < 2) return null;
  const loop = closed && pts.length >= 3;
  const line = loop ? filletPolyline(pts, radius, 8, true) : filletPolyline(pts, radius, 8, false);
  return new Path2D5(line, y, y);
}

/* --------------------------------------------------------------------------
 * 경로 샘플러
 * ------------------------------------------------------------------------ */

/**
 * 폴리라인을 "호 길이로 조회 가능한 경로" 로 감싼다.
 *  타일 배치(연장), 튜브 생성, 길이 표시가 모두 이걸 통해 이뤄진다.
 *  높이(y)는 시작 높이 → 끝 높이로 호 길이에 비례해 보간한다.
 */
export class Path2D5 {
  /**
   * @param lift    가운데 구간을 들어 올리는 높이(m). 레일이 서로 교차할 때
   *                위층으로 쌓기 위한 값이다. 양 끝은 포트 높이를 지켜야 하므로
   *                끝에서만 오르내리고 가운데는 평평하게 유지한다.
   * @param rampLen 오르내리는 구간 길이(m).
   */
  constructor(pts, y0 = 0, y1 = null, lift = 0, rampLen = 3) {
    this.pts = pts;
    this.y0 = y0;
    this.y1 = y1 == null ? y0 : y1;
    this.cum = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.cum.push(total);
    }
    this.length = total;
    this.lift = lift;
    // 경사 구간이 경로 절반을 넘으면 삼각형이 되므로 잘라 준다
    this.rampLen = Math.max(0.1, Math.min(rampLen, total / 2));
  }

  /** 호 길이 s 에서의 높이 (양 끝 포트 높이 + 가운데 들림) */
  yAt(s) {
    const L = this.length;
    const t = L < EPS ? 0 : s / L;
    const base = this.y0 + (this.y1 - this.y0) * t;
    if (!this.lift) return base;
    const r = Math.max(0, Math.min(1, Math.min(s, L - s) / this.rampLen));
    const smooth = r * r * (3 - 2 * r); // 급격한 꺾임 없이 완만하게
    return base + this.lift * smooth;
  }

  /** 호 길이 s 위치의 좌표와 진행 방향 */
  at(s) {
    const L = this.length;
    const q = Math.max(0, Math.min(L, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < q) i++;
    const s0 = this.cum[i - 1];
    const s1 = this.cum[i];
    const f = s1 - s0 < EPS ? 0 : (q - s0) / (s1 - s0);
    const A = this.pts[i - 1];
    const B = this.pts[i];
    const x = A[0] + (B[0] - A[0]) * f;
    const z = A[1] + (B[1] - A[1]) * f;
    const dx = B[0] - A[0];
    const dz = B[1] - A[1];
    const d = Math.hypot(dx, dz) || 1;
    return { pos: [x, this.yAt(q), z], tan: [dx / d, dz / d] };
  }

  /** three.js 용 3D 포인트 배열 */
  points3(lift = 0) {
    return this.pts.map((p, i) => [p[0], this.yAt(this.cum[i]) + lift, p[1]]);
  }
}

/**
 * 연결 하나에 대한 완성 경로.
 *  포트 위치/방향 → 직교 라우팅 → 필렛 → 샘플러.
 */
export function buildConnectorPath(from, to, { radius = 1, stub = 0.5, waypoints = null, lift = 0, rampLen = 3 } = {}) {
  const a = { p: [from.world[0], from.world[2]], dir: from.dir };
  const b = { p: [to.world[0], to.world[2]], dir: to.dir };
  const clearance = Math.max(radius * 2, 1);
  const raw = waypoints?.length
    ? orthoRouteVia(a, b, waypoints, { stub, clearance })
    : orthoRoute(a, b, { stub, clearance });
  const smooth = filletPolyline(raw, radius);
  return new Path2D5(smooth, from.world[1], to.world[1], lift, rampLen);
}
