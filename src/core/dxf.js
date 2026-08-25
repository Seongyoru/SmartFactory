/**
 * =============================================================================
 *  DXF 읽기 — CAD 도면에서 선과 다각형만 꺼낸다
 * =============================================================================
 *  DWG 는 **안 받는다.** 오토데스크의 비공개 이진 포맷이라 자바스크립트로 읽을
 *  실용적인 방법이 없다. 제대로 하려면 유료 SDK 나 변환 서버가 필요한데, 그건
 *  「서버 없이 도는 앱」이라는 이 프로젝트의 전제와 정면으로 부딪친다.
 *  DXF 는 애초에 **주고받으라고 만든 텍스트 형식**이고 대부분의 CAD 가 낸다.
 *
 *  ── DXF 의 생김새 ────────────────────────────────────────────────────────
 *  한 줄에 **번호**, 다음 줄에 **값**. 이 두 줄이 한 쌍이고 파일 전체가 그
 *  쌍의 나열이다. 번호가 뜻을 정한다 — 8 은 레이어 이름, 10·20 은 첫 점의
 *  x·y, 11·21 은 둘째 점.
 *
 *      0        ← 「여기서부터 새 물건」
 *      LINE     ← 그 물건의 종류
 *      8        ← 레이어
 *      WALL
 *      10
 *      1200.0   ← x
 *      20
 *      800.0    ← y
 *
 *  ── 여기서는 평면만 본다 ──────────────────────────────────────────────────
 *  z 는 버린다. 공장 배치에 필요한 것은 **바닥에 그린 윤곽**이고, 3D 솔리드나
 *  입면은 이 앱이 쓸 데가 없다. 곡선(ARC)은 잘게 쪼개 직선으로 바꾼다 —
 *  공장 벽에 곡선은 드물고, 있어도 근사로 충분하다.
 *
 *  ── 깨진 파일에 대한 태도 ────────────────────────────────────────────────
 *  던지지 않는다. 실무 도면은 별별 것이 다 들어 있어서, 하나 이상하다고 통째로
 *  거절하면 **쓸 수 있는 도면까지 못 쓰게 된다.** 읽을 수 있는 데까지 읽고
 *  「여기서 끊겼다」를 함께 돌려준다 — 화면이 그 사실을 사람에게 말할 수 있다.
 * ---------------------------------------------------------------------------
 */

/**
 * `$INSUNITS` — 도면이 스스로 말하는 단위. 미터로 바꾸는 곱수.
 *  0(단위 없음)은 **모른다는 뜻**이라 null 이다. 1 로 두면 「미터라고 우기는」
 *  셈이 되어, 밀리미터 도면이 1000배로 들어와도 아무도 못 알아챈다.
 */
export const UNIT_TO_M = {
  0: null,      // 단위 없음 — 모른다
  1: 0.0254,    // 인치
  2: 0.3048,    // 피트
  4: 0.001,     // 밀리미터
  5: 0.01,      // 센티미터
  6: 1,         // 미터
  9: 0.000001,  // 마이크로미터
  10: 0.9144,   // 야드
};

export const UNIT_LABEL = {
  0: '단위 없음', 1: '인치', 2: '피트', 4: 'mm', 5: 'cm', 6: 'm', 9: 'μm', 10: '야드',
};

/** 이진 DXF 는 이 글자로 시작한다 — 텍스트가 아니므로 읽을 수 없다 */
const BINARY_MARK = 'AutoCAD Binary DXF';

/** 곡선을 몇 도마다 한 조각으로 쪼갤 것인가 — 촘촘할수록 점이 늘어난다 */
const ARC_STEP_DEG = 12;

/**
 * 번호·값 쌍으로 끊는다.
 * ---------------------------------------------------------------------------
 *  DXF 는 **짝이 정확히 맞는** 형식이라 두 줄씩 읽으면 된다. 다만 번호 자리에
 *  숫자가 아닌 것이 오면 그 뒤로는 짝이 어긋난 것이라 믿을 수 없다 — 거기서
 *  멈추고 몇 쌍까지 읽었는지 알린다. 억지로 맞춰 보려 하면 **엉뚱한 값을
 *  좌표로 읽어** 도면이 조용히 뒤틀린다.
 */
function pairsOf(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out = [];
  let cut = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i].trim();
    if (raw === '') continue;                       // 끝의 빈 줄
    const code = Number(raw);
    if (!Number.isInteger(code)) { cut = true; break; }
    out.push([code, lines[i + 1]]);
  }
  return { pairs: out, cut };
}

const num = (v) => {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

/** 각도를 라디안으로 — DXF 의 각은 도(度)다 */
const rad = (deg) => (deg * Math.PI) / 180;

/**
 * 원호를 점 목록으로. 시작각에서 끝각까지 반시계로 도는 것이 DXF 의 약속이다.
 *  끝각이 시작각보다 작으면 한 바퀴를 넘어간 것이다(예: 350° → 10°).
 */
function arcPoints(cx, cy, r, a0, a1) {
  let span = a1 - a0;
  while (span <= 0) span += 360;
  const steps = Math.max(2, Math.ceil(span / ARC_STEP_DEG));
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = rad(a0 + (span * i) / steps);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** 원 — 기둥 후보. 다각형으로 만들어 두면 미리보기가 같은 길로 그린다 */
function circlePoints(cx, cy, r) {
  return arcPoints(cx, cy, r, 0, 360).slice(0, -1);
}

/**
 * DXF 한 벌을 읽는다.
 * ---------------------------------------------------------------------------
 *  @returns {{
 *    ok: boolean, error: string|null, truncated: boolean,
 *    units: number|null, unitScale: number|null,
 *    entities: Array, layers: Array<{name, lines, polys, circles, inserts}>,
 *  }}
 *
 *  entities 는 아래 넷 중 하나로 고른다 — 뒤쪽 코드가 DXF 의 번호 체계를
 *  다시 알 필요가 없도록 여기서 **한 번만** 번역한다.
 *
 *      { kind:'line',   layer, a:[x,y], b:[x,y] }
 *      { kind:'poly',   layer, pts:[[x,y]…], closed }
 *      { kind:'circle', layer, c:[x,y], r, pts:[[x,y]…] }
 *      { kind:'insert', layer, name, at:[x,y], rot }
 */
export function parseDxf(text) {
  const src = typeof text === 'string' ? text : '';
  if (src.includes(BINARY_MARK)) {
    return fail('이진 DXF 입니다 — CAD 에서 「ASCII DXF」로 다시 저장해 주세요');
  }
  const { pairs, cut } = pairsOf(src);
  if (!pairs.length) return fail('DXF 로 읽히지 않습니다 — 파일이 비었거나 형식이 다릅니다');

  let units = null;
  const entities = [];

  /* 지금 어느 구역(SECTION)에 있는가. ENTITIES 밖의 좌표를 주워 담으면
     블록 정의나 표에 든 것이 도면 위에 나타난다. */
  let section = null;
  /* 만들고 있는 물건 하나 */
  let cur = null;
  /* POLYLINE 은 뒤따르는 VERTEX 들을 모아야 완성된다 (옛 형식) */
  let chain = null;
  let headerVar = null;

  const flush = () => {
    if (!cur) return;
    const e = finish(cur);
    if (e) entities.push(e);
    cur = null;
  };

  for (const [code, rawVal] of pairs) {
    const val = String(rawVal).trim();

    if (code === 0) {
      /* 새 물건이 시작된다 — 만들던 것을 먼저 마감한다 */
      if (chain && val === 'VERTEX') {
        /* 앞의 정점을 **먼저 담는다.** 안 담고 새로 만들면 마지막 하나만 남아
           다각형이 통째로 사라진다 — 옛 형식 도면이 조용히 비는 자리다. */
        if (cur?.type === 'VERTEX') pushVertex(chain, cur);
        cur = { type: 'VERTEX', pts: [], layer: chain.layer };
        continue;
      }
      if (chain) {
        if (cur?.type === 'VERTEX') pushVertex(chain, cur);
        cur = null;
        if (chain.pts.length >= 2) entities.push({
          kind: 'poly', layer: chain.layer, pts: chain.pts, closed: chain.closed,
        });
        chain = null;
        if (val === 'SEQEND') continue;
      }
      flush();

      if (val === 'SECTION') { section = 'PENDING'; continue; }
      if (val === 'ENDSEC') { section = null; continue; }
      if (val === 'EOF') break;
      if (section !== 'ENTITIES') continue;

      if (val === 'POLYLINE') { chain = { layer: '0', pts: [], closed: false }; continue; }
      if (WANTED.has(val)) cur = { type: val, pts: [], layer: '0' };
      continue;
    }

    /* 구역 이름은 2 번으로 온다 (0 SECTION 바로 뒤) */
    if (section === 'PENDING' && code === 2) { section = val; continue; }

    if (section === 'HEADER') {
      if (code === 9) { headerVar = val; continue; }
      if (headerVar === '$INSUNITS' && code === 70) { units = num(val); headerVar = null; }
      continue;
    }

    if (section !== 'ENTITIES') continue;

    if (chain && !cur) {
      if (code === 8) chain.layer = val;
      if (code === 70) chain.closed = (num(val) & 1) === 1;
      continue;
    }
    if (!cur) continue;

    switch (code) {
      case 8: cur.layer = val; break;
      case 2: cur.name = val; break;                     // INSERT 의 블록 이름
      case 10: cur.pts.push([num(val), 0]); break;       // x — y 는 20 에서 채운다
      case 20: {
        const last = cur.pts[cur.pts.length - 1];
        if (last) last[1] = num(val);
        break;
      }
      case 11: cur.x2 = num(val); break;
      case 21: cur.y2 = num(val); break;
      case 40: cur.r = num(val); break;                  // 반지름
      case 50: cur.a0 = num(val); break;                 // 시작각 · INSERT 회전
      case 51: cur.a1 = num(val); break;                 // 끝각
      case 70: cur.flags = num(val); break;
      default: break;
    }
  }
  flush();
  if (chain?.pts.length >= 2) {
    entities.push({ kind: 'poly', layer: chain.layer, pts: chain.pts, closed: chain.closed });
  }

  return {
    ok: entities.length > 0,
    error: entities.length ? null : '도형을 하나도 못 찾았습니다 — 빈 도면이거나 지원하지 않는 형식입니다',
    truncated: cut,
    units,
    unitScale: units == null ? null : (UNIT_TO_M[units] ?? null),
    entities,
    layers: layersOf(entities),
  };
}

const WANTED = new Set(['LINE', 'LWPOLYLINE', 'CIRCLE', 'ARC', 'INSERT']);

function pushVertex(chain, v) {
  const p = v.pts[0];
  if (p) chain.pts.push(p);
}

/** 모아 둔 번호들을 물건 하나로 — 좌표가 모자라면 버린다(반쪽짜리는 해롭다) */
function finish(cur) {
  const layer = cur.layer || '0';
  switch (cur.type) {
    case 'LINE': {
      const a = cur.pts[0];
      if (!a || cur.x2 == null || cur.y2 == null) return null;
      return { kind: 'line', layer, a, b: [cur.x2, cur.y2] };
    }
    case 'LWPOLYLINE': {
      if (cur.pts.length < 2) return null;
      return { kind: 'poly', layer, pts: cur.pts, closed: ((cur.flags ?? 0) & 1) === 1 };
    }
    case 'CIRCLE': {
      const c = cur.pts[0];
      if (!c || !(cur.r > 0)) return null;
      return { kind: 'circle', layer, c, r: cur.r, pts: circlePoints(c[0], c[1], cur.r) };
    }
    case 'ARC': {
      const c = cur.pts[0];
      if (!c || !(cur.r > 0)) return null;
      return {
        kind: 'poly', layer, closed: false,
        pts: arcPoints(c[0], c[1], cur.r, cur.a0 ?? 0, cur.a1 ?? 360),
      };
    }
    case 'INSERT': {
      const at = cur.pts[0];
      if (!at) return null;
      return { kind: 'insert', layer, name: cur.name || '(이름 없음)', at, rot: cur.a0 ?? 0 };
    }
    default: return null;
  }
}

/**
 * 레이어별로 무엇이 몇 개인가.
 *  **사람이 고를 목록이다.** 실무 도면에는 치수선·해칭·문자·가구가 전부 들어
 *  있어서, 개수를 안 보여 주면 어느 것이 벽인지 짐작할 단서가 없다.
 */
function layersOf(entities) {
  const by = new Map();
  for (const e of entities) {
    if (!by.has(e.layer)) by.set(e.layer, { name: e.layer, lines: 0, polys: 0, closed: 0, circles: 0, inserts: 0 });
    const row = by.get(e.layer);
    if (e.kind === 'line') row.lines += 1;
    else if (e.kind === 'poly') { row.polys += 1; if (e.closed) row.closed += 1; }
    else if (e.kind === 'circle') row.circles += 1;
    else if (e.kind === 'insert') row.inserts += 1;
  }
  return [...by.values()].sort((a, b) =>
    (b.lines + b.polys + b.circles + b.inserts) - (a.lines + a.polys + a.circles + a.inserts));
}

function fail(error) {
  return { ok: false, error, truncated: false, units: null, unitScale: null, entities: [], layers: [] };
}

/**
 * 읽은 것 전체가 차지하는 사각형 — 축척 추정과 원점 옮기기가 이걸로 시작한다.
 *  @returns {{minX,minY,maxX,maxY,w,h}|null} 점이 없으면 null
 */
export function boundsOf(entities) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const eat = ([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const e of entities ?? []) {
    if (e.kind === 'line') { eat(e.a); eat(e.b); }
    else if (e.kind === 'poly' || e.kind === 'circle') e.pts.forEach(eat);
    else if (e.kind === 'insert') eat(e.at);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
