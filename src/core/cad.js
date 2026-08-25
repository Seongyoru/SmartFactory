/**
 * =============================================================================
 *  CAD 도면 → 이 앱의 도면
 * =============================================================================
 *  `dxf.js` 가 「선과 다각형」까지 꺼내 놓으면, 여기서 **이 앱이 아는 것**으로
 *  바꾼다 — 벽·바닥·기둥. 도형을 옮기는 일 자체는 쉽고, 어려운 것은 셋이다.
 *
 *  ── ① 축척 ───────────────────────────────────────────────────────────────
 *  DXF 는 단위를 스스로 말한다(`$INSUNITS`). 그런데 **실무 도면에서는 이것이
 *  없거나 틀린 경우가 흔하다.** 그래서 믿되 검산한다 — 헤더가 없으면 도면의
 *  크기로 짐작하고, 어느 쪽이든 **사람에게 확인시킨다.** 30 m 짜리 공장이
 *  30 mm 로 들어오면 화면에는 점 하나가 찍힐 뿐이고, 원인을 짐작하기 어렵다.
 *
 *  ── ② 원점 ───────────────────────────────────────────────────────────────
 *  CAD 좌표는 아무 데나 있다. 측량 좌표계를 쓰는 도면이면 수십만 미터 지점이다.
 *  그대로 넣으면 **화면에 아무것도 안 보이고**, 카메라를 아무리 돌려도 못 찾는다.
 *  가져올 것들의 한가운데를 원점으로 옮긴다.
 *
 *  ── ③ 축 방향 ────────────────────────────────────────────────────────────
 *  CAD 는 X-Y 평면에 위쪽이 +Y 다. 이 앱은 X-Z 평면이고, 탑뷰에서 **화면 위쪽이
 *  −Z** 다(EditorScene 의 화면↔월드 변환이 그렇게 되어 있다). 그래서 `z = −y` 로
 *  놓아야 도면이 보던 대로 들어온다.
 *
 *  **여기가 이 파일에서 가장 조용한 자리다.** 부호를 뒤집으면 도면이 좌우로
 *  뒤집혀 들어오는데, 공장 도면은 대개 대칭이라 **뒤집혀도 그럴듯해 보인다.**
 *  눈으로는 못 잡으므로 좌우가 다른 도면으로 검사에서 못 박는다.
 * ---------------------------------------------------------------------------
 */

import { boundsOf } from './dxf.js';

/** 레이어 하나를 무엇으로 볼 것인가 */
export const ROLE = {
  SKIP: 'SKIP',
  WALL: 'WALL',
  FLOOR: 'FLOOR',
  PILLAR: 'PILLAR',
  DOOR: 'DOOR',
  MARK: 'MARK',
};

export const ROLE_LABEL = {
  SKIP: '가져오지 않음',
  WALL: '벽',
  FLOOR: '바닥',
  PILLAR: '기둥',
  DOOR: '문 · 셔터',
  MARK: '설비 자리 표시',
};

/** 이보다 짧은 벽은 버린다 — 치수선 끄트머리 같은 부스러기다 (m) */
export const MIN_WALL = 0.05;

/** 같은 직선으로 볼 기울기 차이 — 1.5° */
const SAME_DIR = Math.sin((1.5 * Math.PI) / 180);
/** 같은 직선으로 볼 **수직** 거리 (m) */
export const SAME_LINE = 0.02;
/** 이어 붙일 **틈** (m) — 이보다 벌어져 있으면 딴 벽으로 둔다 */
export const JOIN_GAP = 0.02;

/**
 * =============================================================================
 *  겹친 벽을 한 줄로
 * =============================================================================
 *  도면에서 벽 하나가 선 하나로 오는 일은 드물다. 같은 자리에 두 번 그어져
 *  있거나(복사·블록 중복), 긴 벽이 토막으로 나뉘어 끝이 맞물려 있다. 반입은
 *  선 하나를 **두께를 가진 판 한 장**으로 만들므로, 그대로 두면 같은 자리에
 *  판이 여러 장 겹쳐 선다 — 화면에서 벽이 두꺼워 보이고 개수가 부풀며,
 *  지우려면 한 장씩 골라야 한다.
 *
 *  ── 어떻게 묶는가 ────────────────────────────────────────────────────────
 *  같은 **직선** 위에 있는 것끼리 모은 다음, 그 직선을 수직선 삼아 1차원
 *  구간으로 바꿔 겹치는 구간을 합친다. 각도와 수직 거리로 묶으므로 선을 그은
 *  방향(A→B 냐 B→A 냐)은 상관없다.
 *
 *  ── 틈을 왜 조금만 봐주는가 ──────────────────────────────────────────────
 *  토막난 벽은 끝이 딱 안 맞고 밀리미터쯤 벌어져 있다. 그 정도는 이어야 한다.
 *  그렇다고 넉넉히 잡으면 **문 구멍을 메운다** — 문은 벽을 끊어 표현하는데,
 *  그 끊긴 자리를 이어 버리면 지나갈 수 없는 도면이 된다. 그래서 2 cm 만 본다.
 *
 *  @param segs [{ a:[x,y], b:[x,y] }]
 *  @returns 같은 모양의 배열 — 겹친 것은 하나로 합쳐져 있다
 */
export function mergeWalls(segs = [], opt = {}) {
  const near = Number(opt.near ?? SAME_LINE);
  const join = Number(opt.join ?? JOIN_GAP);

  /** 직선 하나 — 지나는 점(p)·방향(u)·그 위의 구간들 */
  const lines = [];

  for (const s of segs) {
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const ux = dx / len;
    const uy = dy / len;

    let host = null;
    for (const L of lines) {
      /* 단위벡터끼리의 외적 = |sin θ| — 뒤집힌 방향도 0 이라 같이 잡힌다 */
      if (Math.abs(ux * L.uy - uy * L.ux) > SAME_DIR) continue;
      /* 그 직선에서 얼마나 떨어져 있나 */
      const vx = s.a[0] - L.px;
      const vy = s.a[1] - L.py;
      if (Math.abs(vx * L.uy - vy * L.ux) > near) continue;
      host = L;
      break;
    }
    if (!host) {
      host = { px: s.a[0], py: s.a[1], ux, uy, spans: [] };
      lines.push(host);
    }

    /* 직선 위의 위치로 바꾼다 — 시작점에서 방향으로 얼마나 갔는가 */
    const at = (p) => (p[0] - host.px) * host.ux + (p[1] - host.py) * host.uy;
    const t0 = at(s.a);
    const t1 = at(s.b);
    host.spans.push(t0 <= t1 ? [t0, t1] : [t1, t0]);
  }

  const out = [];
  for (const L of lines) {
    L.spans.sort((p, q) => p[0] - q[0]);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      out.push({
        a: [L.px + L.ux * cur[0], L.py + L.uy * cur[0]],
        b: [L.px + L.ux * cur[1], L.py + L.uy * cur[1]],
      });
    };
    for (const sp of L.spans) {
      if (cur && sp[0] <= cur[1] + join) { cur[1] = Math.max(cur[1], sp[1]); continue; }
      flush();
      cur = [sp[0], sp[1]];
    }
    flush();
  }
  return out;
}

/** 이보다 좁은 구역은 버린다 — 해칭 조각이 이 크기다 (m²) */
export const MIN_AREA = 0.25;

/**
 * 이름으로 역할을 짐작한다.
 *  **어디까지나 초깃값이다.** 레이어 이름 규칙은 회사마다 다르고, 짐작이 맞는
 *  쪽이 드물다. 그래도 빈 칸에서 시작하는 것보다는 낫다 — 스무 개짜리 목록을
 *  전부 손으로 고르게 하면 아무도 안 쓴다.
 */
export function guessRole(name, row = {}) {
  const s = String(name ?? '').toUpperCase();
  if (/DIM|치수|TEXT|문자|HATCH|해칭|AXIS|축|GRID|NOTE/.test(s)) return ROLE.SKIP;
  if (/DOOR|문|SHUTTER|셔터|출입|GATE/.test(s)) return ROLE.DOOR;
  if (/COL|기둥|PILLAR|POST/.test(s)) return ROLE.PILLAR;
  if (/WALL|벽|파티션|PARTITION/.test(s)) return ROLE.WALL;
  if (/FLOOR|바닥|SLAB|ROOM|실|AREA|구역|OFFICE|사무/.test(s)) return ROLE.FLOOR;
  if (/EQUIP|설비|MACHINE|기계|BLOCK/.test(s)) return ROLE.MARK;

  /* ── 이름이 안 알려 주면 **안 가져온다** ─────────────────────────────────
     한때는 들어 있는 것으로 짐작했다 — 「선이 있으면 벽」. 그런데 도면에서 선을
     가진 레이어는 벽만이 아니다. 가구(`FUR`)도, 해칭(`HAT`)도, 기호(`SYM`)도
     전부 선이다. 실제 도면 하나를 넣어 보니 열두 레이어 중 아홉이 벽이 됐고,
     해칭 스물여덟 줄이 그대로 벽 스물여덟 장이 됐다.

     짐작이 틀리면 **치우는 쪽이 더 비싸다.** 안 가져온 것은 목록에서 골라
     다시 넣으면 되지만, 잘못 들어온 벽 수백 장은 하나씩 지워야 한다.
     그래서 이름이 말해 주는 것만 가져오고 나머지는 사용자가 고르게 둔다. */
  return ROLE.SKIP;
}

export function guessRoles(layers = []) {
  const out = {};
  for (const row of layers) out[row.name] = guessRole(row.name, row);
  return out;
}

/**
 * 헤더가 없을 때 도면 크기로 단위를 짐작한다.
 * ---------------------------------------------------------------------------
 *  공장 도면의 가로폭은 대개 10~300 m 다. 그 범위에 들어오는 단위를 고른다.
 *  순서가 곧 우선순위다 — 국내 건축 CAD 는 밀리미터가 압도적이라 먼저 본다.
 */
const CANDIDATES = [
  { unit: 4, scale: 0.001 },   // mm
  { unit: 5, scale: 0.01 },    // cm
  { unit: 6, scale: 1 },       // m
  { unit: 1, scale: 0.0254 },  // 인치
  { unit: 2, scale: 0.3048 },  // 피트
];
/**
 * 공장 도면이라고 볼 만한 가로폭 (m).
 *  하한이 중요하다. 3 m 로 두면 3000 단위 도면이 **밀리미터로 3 m** 라고 읽혀
 *  버리는데, 3 m 짜리 공장은 없다 — 센티미터로 30 m 인 쪽이 맞다.
 *
 *  그래도 **완전히 가릴 수는 없다.** 5000 단위는 밀리미터로 5 m(작은 작업장)
 *  일 수도, 센티미터로 50 m(흔한 공장) 일 수도 있다. 어느 쪽인지는 도면이
 *  말해 주지 않으므로 흔한 쪽을 고르고, **사람이 화면에서 확인**한다.
 */
const PLAUSIBLE = [8, 500];    // m

export function guessScale(width) {
  const w = Number(width);
  if (!(w > 0)) return null;
  for (const c of CANDIDATES) {
    const m = w * c.scale;
    if (m >= PLAUSIBLE[0] && m <= PLAUSIBLE[1]) return c;
  }
  return null;
}

/**
 * 이 도면을 몇 배로 놓을 것인가.
 *  @returns {{ scale, unit, why }} why: 'header' | 'guess' | 'fallback'
 */
export function scaleOf(parsed) {
  const b = boundsOf(parsed?.entities);
  const width = b?.w || 0;

  if (parsed?.unitScale) {
    return { scale: parsed.unitScale, unit: parsed.units, why: 'header' };
  }
  const g = guessScale(width);
  if (g) return { scale: g.scale, unit: g.unit, why: 'guess' };
  /* 짐작도 실패 — 1:1 로 두고 사람에게 넘긴다. 조용히 아무 값이나 고르는 것보다
     「모르겠다」고 말하는 쪽이 낫다. */
  return { scale: 1, unit: null, why: 'fallback' };
}

/**
 * 두 점을 찍고 「실제로 몇 m」를 넣어 축척을 다시 잡는다.
 *  도면이 단위를 안 말하거나 거짓말할 때 **사람이 아는 치수 하나**로 바로잡는
 *  길이다. 앱의 「치수 재기」와 같은 몸짓이라 따로 배울 것이 없다.
 */
export function scaleFromSpan(a, b, meters) {
  const dx = (b?.[0] ?? 0) - (a?.[0] ?? 0);
  const dy = (b?.[1] ?? 0) - (a?.[1] ?? 0);
  const drawn = Math.hypot(dx, dy);
  const want = Number(meters);
  if (!(drawn > 0) || !(want > 0)) return null;
  return want / drawn;
}

/** 같은 점이 잇달아 오면 하나로 — CAD 는 겹친 점을 자주 낸다 */
function dedupe(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  /* 닫힌 고리가 첫 점을 끝에 한 번 더 적어 오는 경우 */
  const f = out[0]; const l = out[out.length - 1];
  if (out.length > 2 && f && l && Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
  return out;
}

const ringArea = (ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(s) / 2;
};

/**
 * 도면 한 벌을 이 앱의 모양으로 바꾼다.
 * ---------------------------------------------------------------------------
 *  @param parsed  parseDxf 의 결과
 *  @param opts    { roles, scale, flipY = true, center = true }
 *  @returns {{ walls, areas, pillars, marks, size, dropped }}
 *
 *  uid·이름·두께·높이·색은 **여기서 안 정한다.** 그것들은 도면의 성질이 아니라
 *  이 앱의 설정이고, uid 는 store 의 `seq` 가 하나뿐인 발급처다. 여기서는
 *  **자리만** 낸다.
 */
export function planOf(parsed, opts = {}) {
  const roles = opts.roles ?? guessRoles(parsed?.layers);
  const scale = Number(opts.scale) || scaleOf(parsed).scale;
  const flipY = opts.flipY !== false;
  const ents = (parsed?.entities ?? []).filter((e) => (roles[e.layer] ?? ROLE.SKIP) !== ROLE.SKIP);

  /* 원점은 **가져올 것들**의 한가운데다. 안 가져올 치수선까지 넣어 재면
     건물이 한쪽으로 밀려 들어온다. */
  const b = boundsOf(ents);
  const cx = opts.center === false || !b ? 0 : (b.minX + b.maxX) / 2;
  const cy = opts.center === false || !b ? 0 : (b.minY + b.maxY) / 2;

  /** CAD 의 한 점 → 이 앱의 한 점 */
  const at = ([x, y]) => [
    (x - cx) * scale,
    (flipY ? -(y - cy) : (y - cy)) * scale,
  ];

  const walls = [];
  const areas = [];
  const pillars = [];
  const marks = [];
  const doors = [];
  const dropped = { wall: 0, area: 0 };

  for (const e of ents) {
    const role = roles[e.layer];

    if (role === ROLE.WALL) {
      if (e.kind === 'line') addWall(at(e.a), at(e.b));
      else if (e.kind === 'poly') {
        const pts = dedupe(e.pts).map(at);
        const n = e.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i += 1) addWall(pts[i], pts[(i + 1) % pts.length]);
      } else if (e.kind === 'circle') {
        const pts = e.pts.map(at);
        for (let i = 0; i < pts.length; i += 1) addWall(pts[i], pts[(i + 1) % pts.length]);
      }
      continue;
    }

    if (role === ROLE.FLOOR) {
      /* 열린 다각형도 받는다 — 닫아서 쓴다. CAD 에서 「닫힘」 표시를 안 하고
         첫 점을 끝에 한 번 더 찍는 사람이 많다. */
      const ring = dedupe((e.pts ?? []).map(at));
      if (ring.length < 3) { dropped.area += 1; continue; }
      if (ringArea(ring) < MIN_AREA) { dropped.area += 1; continue; }
      areas.push({ mp: [[ring]] });                 // [다각형[고리[점]]] — 세 겹이다
      continue;
    }

    if (role === ROLE.PILLAR) {
      if (e.kind === 'circle') pillars.push({ at: at(e.c), r: e.r * scale });
      else if (e.kind === 'poly') {
        const ring = dedupe((e.pts ?? []).map(at));
        if (ring.length < 3) continue;
        const bb = ringBounds(ring);
        pillars.push({ at: [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2], r: Math.max(bb.w, bb.h) / 2 });
      }
      continue;
    }

    if (role === ROLE.DOOR) {
      /* 개구부는 자리 하나로 산다(벽을 참조하지 않는다). 폭은 도면에서 안
         읽는다 — 블록의 크기 배율까지 좇으면 맞는 경우보다 틀리는 경우가
         많아진다. 자리만 잡아 주고 폭은 앱의 기본값에서 시작한다. */
      const p = doorPoint(e, at);
      if (p) doors.push({ at: p });
      continue;
    }

    if (role === ROLE.MARK && e.kind === 'insert') {
      marks.push({ name: e.name, at: at(e.at), rot: e.rot ?? 0 });
    }
  }

  function addWall(a, c) {
    if (Math.hypot(c[0] - a[0], c[1] - a[1]) < MIN_WALL) { dropped.wall += 1; return; }
    walls.push({ a, b: c });
  }

  /* 같은 자리에 겹쳐 선 것을 여기서 한 줄로 만든다 — 판을 만들기 **전에**.
     만들고 나서 지우려면 사용자가 한 장씩 골라야 한다. */
  const joined = mergeWalls(walls);
  dropped.merged = walls.length - joined.length;

  return {
    walls: joined,
    areas,
    pillars,
    doors,
    marks,
    size: b ? { w: b.w * scale, h: b.h * scale } : { w: 0, h: 0 },
    dropped,
  };
}

function ringBounds(ring) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** 사람에게 보여 줄 한 줄 — 「무엇이 얼마나 들어오는가」 */
export function planText(plan) {
  if (!plan) return '';
  const bits = [];
  if (plan.walls.length) bits.push(`벽 ${plan.walls.length}`);
  if (plan.areas.length) bits.push(`바닥 ${plan.areas.length}`);
  if (plan.pillars.length) bits.push(`기둥 ${plan.pillars.length}`);
  if (plan.doors.length) bits.push(`문 ${plan.doors.length}`);
  if (plan.marks.length) bits.push(`설비 자리 ${plan.marks.length}`);
  if (!bits.length) return '가져올 것이 없습니다 — 레이어를 골라 주세요';
  const size = plan.size.w > 0 ? ` · ${plan.size.w.toFixed(1)} × ${plan.size.h.toFixed(1)} m` : '';
  return bits.join(' · ') + size;
}

/** 문 하나의 자리 — 블록이면 삽입점, 도형이면 한가운데 */
function doorPoint(e, at) {
  if (e.kind === 'insert') return at(e.at);
  if (e.kind === 'circle') return at(e.c);
  const pts = e.pts ?? [];
  if (!pts.length) return null;
  const bb = ringBounds(pts.map(at));
  return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
}

/**
 * 자리들을 **도면의 물건**으로 — uid·이름·두께·색을 입힌다.
 * ---------------------------------------------------------------------------
 *  리듀서 안에 두지 않고 여기로 뺐다. 리듀서는 검사에서 **글자로만** 읽히므로,
 *  안에 든 계산은 값으로 확인할 길이 없다. 「스물세 개를 얹었다」를 세어 보려면
 *  부를 수 있는 함수여야 한다.
 *
 *  @param plan   planOf 의 결과
 *  @param opts   { seq, build, counts }
 *  @returns {{ walls, areas, pillars, openings, seq }} seq 는 **다 쓰고 난 다음 번호**
 */
export function docFromPlan(plan, opts = {}) {
  const b = opts.build ?? {};
  const n = opts.counts ?? {};
  let seq = Number(opts.seq) || 1;
  const from = (k) => Number(n[k]) || 0;

  const walls = (plan?.walls ?? []).map((w, i) => ({
    uid: `W${seq++}`,
    a: w.a,
    b: w.b,
    name: `반입 벽 ${from('walls') + i + 1}`,
    thickness: b.wallThickness,
    height: b.wallHeight,
    color: b.wallColor,
  }));
  const areas = (plan?.areas ?? []).map((a, i) => ({
    uid: `A${seq++}`,
    name: `반입 영역 ${from('areas') + i + 1}`,
    mp: a.mp,
    edges: {},
    thickness: b.wallThickness,
    height: b.wallHeight,
    color: b.wallColor,
  }));
  const pillars = (plan?.pillars ?? []).map((q, i) => ({
    uid: `P${seq++}`,
    pos: q.at,
    name: `반입 기둥 ${from('pillars') + i + 1}`,
    /* 도면은 반지름으로 왔고 이 앱은 가로·세로로 잰다. 0 이 되면 화면에서
       사라지므로 아주 작은 것도 최소 10 cm 로 세워 둔다. */
    size: [Math.max(0.1, q.r * 2), Math.max(0.1, q.r * 2)],
    height: b.pillarHeight,
    color: b.pillarColor,
  }));
  const openings = (plan?.doors ?? []).map((d, i) => ({
    uid: `O${seq++}`,
    name: `반입 개구부 ${from('openings') + i + 1}`,
    at: d.at,
    width: b.openingWidth,
    height: b.openingHeight,
    sill: b.openingSill,
  }));

  return { walls, areas, pillars, openings, seq };
}

/** 얹을 것이 하나도 없는가 — 리듀서가 헛일을 하지 않으려고 먼저 묻는다 */
export const isEmptyDoc = (made) =>
  !made?.walls.length && !made?.areas.length && !made?.pillars.length && !made?.openings.length;
