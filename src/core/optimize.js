/**
 * =============================================================================
 *  배치 탐색 — 「어느 설비를 어느 자리에 둘 것인가」
 * =============================================================================
 *  이제 화면 없이 도면을 잴 수 있으니(`core/flow.js` · `core/balance.js`), 사람이
 *  옮겨 보는 대신 **도구가 옮겨 보고 값을 잴 수 있다.** 이 모듈이 그 일을 한다.
 *
 *  ── 무엇을 줄이는가 ────────────────────────────────────────────────────────
 *  **개당 거리**(`metersPerUnit`) 하나다. 배치를 바꿔서 달라지는 것은 거리이기
 *  때문이다 — 라인의 천장은 공정 시간과 벨트 속도가 정하지, 설비가 어디 앉아
 *  있는지가 정하지 않는다. 그래서 「처리량을 올리는 배치를 찾아 줘」는 이 탐색이
 *  답할 수 있는 질문이 아니고, 「같은 라인을 **덜 걸어서** 돌리는 배치」가 답할 수
 *  있는 질문이다.
 *
 *  총 작업량이 아니라 **개당** 거리를 쓰는 이유는 flow.js 와 같다 — 총량은 라인이
 *  빨라지기만 해도 커져서, 배치를 나쁘게 고쳐 놓고도 숫자가 줄어 보인다.
 *
 *  ── 무엇을 움직이는가 — **맞바꾸기와 당기기** ────────────────────────────
 *  두 가지 수를 섞는다. 아무 데나 옮기는 것은 아니다.
 *
 *    **맞바꾸기** 설비 둘의 자리를 바꾼다 — 「어느 자리에 무엇을 둘까」
 *    **당기기**   빈 자리로 옮긴다 — 「무거운 상대 쪽으로 몇 미터」
 *
 *  섞는 이유가 있다. 맞바꾸기만 하면 자리가 부족한 도면에서 아무것도 못 하고,
 *  당기기만 하면 「A 와 B 를 통째로 바꾸면 되는」 자리를 못 본다.
 *
 *  둘 다 **말로 옮길 수 있어야** 한다는 것이 고른 기준이다. 「제작기 1 과 조립기 2
 *  를 맞바꾸세요」도, 「조립기 쪽으로 3.5 m」도 그대로 실행할 수 있는 지시다.
 *  「제작기를 (12.75, −4.5) 로」는 그렇지 않다 — 도구가 대신 눌러 주더라도,
 *  무엇을 하는 것인지 읽히지 않으면 사람이 안 누른다.
 *
 *  회전은 안 건드린다. 돌리는 것까지 섞으면 한 마디로 안 끝나고, 통로를 보고
 *  맞춰 놓은 방향이 흐트러진다.
 *
 *  ── 반드시 지켜야 하는 것 ─────────────────────────────────────────────────
 *  값만 보고 고르면 **도면을 망가뜨리면서 점수를 올린다.** 그래서 후보마다
 *  네 가지를 먼저 본다.
 *
 *    · 겹치지 않는가 · 바닥 안인가 · 벽·기둥에 안 걸리는가   (화면의 배치 판정 그대로)
 *    · **카트 경로가 안 깨지는가** — 설비를 맞바꾸면 그 앞을 지나던 정차역이
 *      사라질 수 있다. 역이 없어지면 나르는 양이 0 이 되는데, 나르는 양이 0 이면
 *      **거리도 0** 이라 점수가 「좋아진다.」 이 함정을 안 막으면 탐색이
 *      **경로를 부수는 쪽으로 수렴한다**
 *    · **벨트가 여전히 이어지는가** — 경로를 못 뽑으면 그 벨트의 거리도 0 이 된다
 *    · **통로를 안 막는가** — 카트가 다니던 길 위에 설비를 세울 수 없다.
 *      여유는 0 이다(`AISLE_MARGIN` 참고 — 두면 정차역이 통째로 사라진다)
 *    · **구역을 안 넘는가** — 사용자가 그어 둔 선은 도면에 적힌 뜻이다
 *
 *  ── 어떻게 찾는가 ─────────────────────────────────────────────────────────
 *  한 바퀴에 맞바꾸기와 당기기를 다 재고 **가장 많이 줄어드는 하나**를 고른다
 *  (steepest descent). 더 줄일 것이 없으면 멈춘다. **씨앗도 난수도 없다** —
 *  같은 도면에서 늘 같은 답이 나와야 사람이 그 답을 믿는다.
 *
 *  빈 자리를 전부 훑지는 않는다. 0.5 m 격자로도 만 자리가 넘어 화면이 멈춘다.
 *  **어디로 갈지는 이미 알고 있으므로**(물류가 무거운 상대 쪽) 그 방향으로만
 *  걸어 본다 — `pullSpots` 참고.
 *
 *  이것은 최적해가 아니라 **손볼 곳**이다. 언덕을 내려가다 골짜기에 걸리면 거기서
 *  멈춘다. 그리고 걸음 수에 천장이 있어서(`MAX_STEPS`) **아직 줄어드는 중인데도
 *  끊는다** — 설비가 대여섯 대만 넘어도 매번 천장에 걸린다. 그래서 결과에
 *  `capped` 를 담아 「더 줄일 것이 없다」와 「여기서 끊었다」를 가른다.
 *  둘을 안 가르면 사람이 다 된 줄 알고 그만둔다.
 * ---------------------------------------------------------------------------
 */

import { footprintOf, outOfBounds, rectsOverlap, snapPoint } from './grid.js';
import { hitsObstacle, rectInFloor } from './area.js';
import { lineBalance } from './balance.js';
import { flowMatrix, metersPerUnit } from './flow.js';
import { cartPath, cartStations, haulPerMinute } from './cart.js';
import { isTruck } from '../data/library.js';

/** 몇 번까지 손볼 것인가 — 이보다 길면 사람이 따라 하다 만다 */
export const MAX_STEPS = 8;

/** 이만큼도 안 줄면 안 줄어든 것으로 본다 (0.1%) */
export const GAIN_TIE = 0.001;

/**
 * 이 배치의 **오가는 구간 표**. `scoreOf` 와 당기기가 같은 표를 본다 —
 * 갈리면 「이쪽으로 당기면 좋다」고 해 놓고 점수는 다른 것을 재게 된다.
 */
export function flowRowsOf(placed, d = {}) {
  const itemOf = d.itemOf ?? (() => null);
  const bal = lineBalance({
    placed, links: d.links ?? [], carts: d.carts ?? [], itemOf, specOf: d.specOf, beltSpeed: d.beltSpeed,
  });
  if (!(bal.capacity > 0)) return [];
  return flowMatrix({
    rows: bal.rows, capacity: bal.capacity, placed,
    links: d.links ?? [], carts: d.carts ?? [],
    lengthOf: (l) => d.lengthOf?.(l, placed) ?? 0,
  }, itemOf);
}

/**
 * 이 배치의 점수 — **개당 거리**(m/개). 낮을수록 좋다.
 *  못 재면 null 이다(오가는 것이 없는 도면). null 은 「좋다」가 아니라
 *  「모른다」라서, 부르는 쪽이 후보에서 빼야 한다.
 */
export function scoreOf(placed, d = {}) {
  const itemOf = d.itemOf ?? (() => null);
  const bal = lineBalance({
    placed,
    links: d.links ?? [],
    carts: d.carts ?? [],
    itemOf,
    specOf: d.specOf,
    beltSpeed: d.beltSpeed,
  });
  if (!(bal.capacity > 0)) return null;
  const rows = flowMatrix({
    rows: bal.rows,
    capacity: bal.capacity,
    placed,
    links: d.links ?? [],
    carts: d.carts ?? [],
    lengthOf: (l) => d.lengthOf?.(l, placed) ?? 0,
  }, itemOf);
  const per = metersPerUnit(rows, bal.capacity);
  return per > 0 ? per : null;
}

/** 이 설비가 차지하는 사각형 — 화면의 `rectOf` 와 같은 값이어야 한다 */
const rectOf = (p, d) => {
  const bbox = d.bboxOf?.(p);
  return bbox ? footprintOf({ ...p, bboxOverride: bbox }, null) : null;
};

/**
 * 두 설비를 맞바꾼 배치. **회전은 각자 그대로 둔다** — 돌리는 것까지 섞으면
 * 「맞바꾸세요」 한 마디로 안 끝나고, 통로를 보고 맞춰 놓은 방향이 흐트러진다.
 */
export const swapped = (placed, i, j) =>
  placed.map((p, k) => (k === i ? { ...p, pos: placed[j].pos } : k === j ? { ...p, pos: placed[i].pos } : p));

/**
 * 놓을 수 있는 자리인가 — **화면의 배치 판정 그대로**다.
 *  여기서 규칙이 갈리면 탐색이 「놓을 수 없는 자리」를 답으로 낸다.
 */
export function placeOk(next, moved, d = {}) {
  const rects = next.map((p) => ({ uid: p.uid, rect: rectOf(p, d) }));
  for (const uid of moved) {
    const me = rects.find((r) => r.uid === uid);
    if (!me?.rect) return false;
    if (outOfBounds(me.rect)) return false;
    if (d.floor && !rectInFloor(me.rect, d.floor)) return false;
    if (hitsObstacle(me.rect, { walls: d.walls ?? [], pillars: d.pillars ?? [] })) return false;
    /* **길 위에 물건을 놓지 마라.** 맞바꾸기만 할 때는 없어도 됐다 —
       자리가 서로 바뀔 뿐이었으니까. 빈 자리로 옮기기 시작하면 다르다. */
    if (d.aisle?.length && blocksAisle(me.rect, d.aisle, d.aisleMargin)) return false;
    /* 사용자가 「여기는 조립 구역」이라고 그어 둔 선을 넘지 않는다 */
    const home = d.home?.get(uid);
    if (home?.mp && !rectInFloor(me.rect, home.mp)) return false;
    for (const other of rects) {
      if (other.uid === uid || !other.rect) continue;
      if (rectsOverlap(me.rect, other.rect)) return false;
    }
  }
  return true;
}

/**
 * 카트 경로가 이 배치에서도 사는가.
 * ---------------------------------------------------------------------------
 *  **이것이 이 모듈에서 가장 중요한 판정이다.** 설비를 옮기면 그 앞을 지나던
 *  정차역이 사라질 수 있고, 역이 사라지면 나르는 양이 0 → **거리도 0** → 점수가
 *  좋아진다. 막지 않으면 탐색이 경로를 부수는 쪽으로 수렴한다.
 *
 *  잣대는 「돌던 경로가 계속 도는가」다 — 역 수가 줄지 않고, 싣는 곳과 내리는
 *  곳이 둘 다 남아 있어야 한다. 어느 설비의 역인지까지는 따지지 않는다.
 *  맞바꾸면 그건 당연히 바뀌고, 바뀌는 것이 이 탐색의 목적이다.
 */
export function routesOk(next, d = {}) {
  const itemOf = d.itemOf ?? (() => null);
  for (const c of d.carts ?? []) {
    const before = d.baseRoutes?.get(c.uid);
    if (!before) continue;                                  // 원래도 안 돌던 경로
    const path = cartPath(c);
    if (!path) return false;
    const truck = isTruck(itemOf(c.itemId));
    const st = cartStations(path, next, itemOf, { loadOnly: truck, roles: c.roles });
    if (st.length < before.stations) return false;
    const h = haulPerMinute(c, path, st, { truck });
    /* 「아직도 나르는가」 — 한쪽만 남은 경로(싣기만 · 내리기만)도 여기서 걸린다.
       `haulPerMinute` 가 그 경우를 0 으로 두기 때문이다. **되돌리기 테스트로
       이 줄만 무는 경우를 못 만들었다** — 위의 역 수 검사가 먼저 잡는다.
       그래도 남겨 둔다: 역 수가 같은 채로 역할만 뒤집히는 도면이 논리적으로
       가능하고, 그때 이 줄이 유일한 그물이다. */
    if (!(h?.perMinute > 0)) return false;
  }
  /* 벨트는 경로를 못 뽑으면 거리가 0 이 된다 — 이어져 있어야 한다 */
  for (const l of d.links ?? []) {
    if (!d.baseLinks?.has(l.uid)) continue;
    if (!(d.lengthOf?.(l, next) > 0)) return false;
  }
  return true;
}

/** 지금 도면에서 「돌고 있는」 경로와 벨트 — 후보를 이것과 견준다 */
export function baseRoutesOf(d = {}) {
  const itemOf = d.itemOf ?? (() => null);
  const placed = d.placed ?? [];
  const routes = new Map();
  for (const c of d.carts ?? []) {
    const path = cartPath(c);
    if (!path) continue;
    const truck = isTruck(itemOf(c.itemId));
    const st = cartStations(path, placed, itemOf, { loadOnly: truck, roles: c.roles });
    const h = haulPerMinute(c, path, st, { truck });
    if (!(h?.perMinute > 0)) continue;
    routes.set(c.uid, { stations: st.length });
  }
  const links = new Set();
  for (const l of d.links ?? []) if (d.lengthOf?.(l, placed) > 0) links.add(l.uid);
  return { routes, links };
}

/**
 * 옮겨도 되는 것들의 자리(index).
 *  `movable(p, item)` 을 주면 그것으로 거른다. 안 주면 전부 옮긴다.
 */
const movableIdx = (placed, d) => {
  const itemOf = d.itemOf ?? (() => null);
  const ok = d.movable ?? (() => true);
  const out = [];
  for (let i = 0; i < placed.length; i++) if (ok(placed[i], itemOf(placed[i].itemId))) out.push(i);
  return out;
};

/* ==========================================================================
 *  통로 — **경로 위에 설비를 얹지 않는다**
 * --------------------------------------------------------------------------
 *  맞바꾸기만 할 때는 이 판정이 없어도 됐다. 자리가 서로 바뀔 뿐이라, 원래
 *  경로가 지나던 자리에는 원래 다른 설비가 있었기 때문이다. **빈 자리로 옮기기
 *  시작하면 다르다** — 카트가 다니던 길 한복판에 설비를 세울 수 있다.
 *
 *  ── 여유(clearance)를 두면 안 된다 ────────────────────────────────────────
 *  「경로 양옆 1 m 를 비운다」 같은 규칙이 자연스러워 보이는데, 이 도구에서는
 *  **틀린 규칙**이다. 정차역은 경로가 설비 포트 1 m 안(`STATION_DIST`)을 지나야
 *  생기고, 포트는 설비 바운딩 박스 **안쪽**에 박혀 있다. 실제로 멀쩡히 도는
 *  도면에서 재 보면 경로가 풋프린트 바깥 0.2 m 를 지난다 — 여유를 1 m 로 두는
 *  순간 **정상 배치가 전부 불법**이 되고 역이 통째로 사라진다.
 *
 *  지켜야 하는 것은 하나다. **길 위에 물건을 놓지 마라.**
 *  그래서 기본 여유는 0 이고, 판정은 「경로 중심선이 풋프린트 안으로 들어가는가」다.
 * ======================================================================== */

/** 통로 여유 (m). 0 = 경로 위에만 안 놓으면 된다 — 위 설명 참고 */
export const AISLE_MARGIN = 0;

/** 경로를 훑는 간격 — 설비 한 칸(0.25m 그리드)보다 촘촘해야 새지 않는다 */
const WALK = 0.2;

/**
 * 카트 경로들을 **점으로 펴 둔다.** 후보마다 경로를 다시 훑으면 탐색이 느려진다.
 *  @returns [[x, z], …]
 */
export function aislePoints(carts = []) {
  const out = [];
  for (const c of carts ?? []) {
    const path = cartPath(c);
    if (!path) continue;
    const n = Math.max(2, Math.ceil(path.length / WALK));
    for (let k = 0; k <= n; k++) {
      const f = path.at((path.length * k) / n);
      out.push([f.pos[0], f.pos[2]]);
    }
  }
  return out;
}

/** 이 사각형이 통로를 막는가 */
export function blocksAisle(rect, points = [], margin = AISLE_MARGIN) {
  for (const [x, z] of points) {
    if (x > rect.minX - margin && x < rect.maxX + margin
      && z > rect.minZ - margin && z < rect.maxZ + margin) return true;
  }
  return false;
}

/* ==========================================================================
 *  구역 — 사용자가 「여기는 조립 구역」이라고 그어 둔 선
 * --------------------------------------------------------------------------
 *  구역을 그렸다면 그것은 **도면에 적힌 뜻**이다. 조립 구역에 있던 설비가
 *  포장 구역으로 건너가면 값이 좋아져도 그 도면은 사용자의 것이 아니다.
 *  그래서 **지금 어느 구역 안에 온전히 들어 있는 설비는 그 구역 안에 머문다.**
 *  구역에 걸쳐 있거나 구역 밖에 있던 것은 원래 자유롭던 것이니 안 묶는다.
 * ======================================================================== */

/** uid → 머물러야 할 구역의 mp (없으면 안 담는다) */
export function zoneHome(d = {}) {
  const home = new Map();
  for (const p of d.placed ?? []) {
    const rect = rectOf(p, d);
    if (!rect) continue;
    for (const z of d.zones ?? []) {
      if (z.mp && rectInFloor(rect, z.mp)) { home.set(p.uid, z); break; }
    }
  }
  return home;
}

/* ==========================================================================
 *  당기기 — **무거운 상대 쪽으로** 옮겨 본다
 * --------------------------------------------------------------------------
 *  빈 자리를 전부 훑으면 60 × 60 m 바닥에 0.5 m 격자만 해도 14,400 자리다.
 *  설비 여섯 대면 한 바퀴에 8만 번 넘게 재야 하고, 화면이 멈춘다.
 *
 *  **어디로 갈지는 이미 알고 있다.** 물류가 무거운 상대 쪽이다. 그래서 그
 *  방향으로만 걸어 본다 — 무게중심까지의 직선을 몇 걸음으로 나누고, 길이 막혀
 *  있을 때를 위해 양옆으로 조금씩 벌린 자리도 함께 본다. 설비당 스물 몇 자리면
 *  끝나고, 나온 답은 **말로 옮길 수 있다** — 「조립기 쪽으로 3.5 m」.
 * ======================================================================== */

/** 몇 걸음까지 당겨 보나 · 한 걸음 (m) */
export const PULL_STEPS = 8;
export const PULL_STEP = 1.0;
/** 길이 막혔을 때 옆으로 비켜 보는 폭 (m) */
const SIDE = [0, 1.5, -1.5];

/**
 * 이 설비를 **어디로 당길 것인가** — 오가는 무게로 잰 상대들의 중심.
 *  @returns { at: [x, z], name } · 당길 데가 없으면 null
 */
export function pullTarget(uid, rows = [], placed = []) {
  const posOf = new Map(placed.map((p) => [p.uid, p.pos]));
  let wx = 0;
  let wz = 0;
  let sum = 0;
  let top = null;
  for (const r of rows) {
    const other = r.from === uid ? r.to : r.to === uid ? r.from : null;
    if (!other) continue;
    const at = posOf.get(other);
    if (!at || !(r.work > 0)) continue;
    wx += at[0] * r.work;
    wz += at[1] * r.work;
    sum += r.work;
    if (!top || r.work > top.work) top = { work: r.work, name: r.from === uid ? r.toName : r.fromName };
  }
  if (!(sum > 0)) return null;
  return { at: [wx / sum, wz / sum], name: top?.name ?? null };
}

/**
 * 당겨 볼 자리들. 격자에 맞춰 돌려주므로 그대로 놓아도 된다.
 *  @returns [{ pos, dist }]
 */
export function pullSpots(from, target, grid = 0.25) {
  const dx = target[0] - from[0];
  const dz = target[1] - from[1];
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return [];
  const ux = dx / len;
  const uz = dz / len;
  const out = [];
  for (let k = 1; k <= PULL_STEPS; k++) {
    const step = Math.min(k * PULL_STEP, len);
    for (const side of SIDE) {
      /* 옆으로 비키는 방향은 진행 방향의 직각이다 */
      const x = from[0] + ux * step - uz * side;
      const z = from[1] + uz * step + ux * side;
      out.push({ pos: snapPoint([x, z], grid), dist: step });
    }
    if (step >= len) break;                      // 상대를 지나쳐 갈 이유는 없다
  }
  return out;
}

/**
 * 손볼 곳을 찾는다.
 * ---------------------------------------------------------------------------
 *  두 가지 수를 섞어 본다.
 *
 *    **맞바꾸기** 설비 둘의 자리를 바꾼다 — 「어느 자리에 무엇을 둘까」
 *    **당기기**   빈 자리로 옮긴다 — 「무거운 상대 쪽으로 몇 미터」
 *
 *  한 바퀴에 둘을 다 재고 **가장 많이 줄어드는 하나**를 고른다(steepest descent).
 *  섞는 이유가 있다 — 맞바꾸기만 하면 자리가 부족한 도면에서 아무것도 못 하고,
 *  당기기만 하면 「A 와 B 를 통째로 바꾸면 되는」 자리를 못 본다.
 *
 *  @returns {
 *    ok       줄일 것을 찾았는가
 *    why      못 찾았으면 이유 ('no-flow' | 'too-few' | 'none')
 *    before   지금 개당 거리 · after 손본 뒤 · gain 줄어든 만큼 (m/개)
 *    steps    [{ kind:'swap'|'slide', … }] — **이 순서대로** 옮긴다
 *    placed   다 적용한 배치 (그대로 상태에 넣으면 된다)
 *    tried    후보를 몇 개나 재 봤는가
 *    capped   **아직 줄어드는 중인데 걸음 천장에서 끊었는가.** 「다 됐다」와
 *             구분해서 말해야 한다 — 안 그러면 사람이 다 된 줄 알고 그만둔다
 *  }
 */
export function searchLayout(d = {}) {
  let placed = d.placed ?? [];
  const names = new Map(placed.map((p) => [p.uid, p.name ?? p.uid]));
  const idx = movableIdx(placed, d);
  const base = scoreOf(placed, d);

  if (base == null) return { ok: false, why: 'no-flow', before: null, after: null, gain: 0, steps: [], placed, tried: 0, capped: false };
  if (!idx.length) return { ok: false, why: 'too-few', before: base, after: base, gain: 0, steps: [], placed, tried: 0, capped: false };

  const { routes, links } = baseRoutesOf(d);
  /* 통로와 구역은 **지금 도면**에서 한 번만 읽는다 — 후보마다 다시 읽으면 느리고,
     무엇보다 「사용자가 그어 둔 선」이라 후보에 따라 달라질 값이 아니다 */
  const ctx = {
    ...d,
    baseRoutes: routes,
    baseLinks: links,
    aisle: d.aisle ?? aislePoints(d.carts),
    home: d.home ?? zoneHome(d),
  };

  const steps = [];
  let cur = base;
  let tried = 0;

  /** 이 후보가 실제로 나은가 — 재 보고 점수를 돌려준다 (안 되면 null) */
  const weigh = (next, moved) => {
    if (!placeOk(next, moved, ctx)) return null;
    if (!routesOk(next, ctx)) return null;
    tried++;
    const per = scoreOf(next, ctx);
    if (per == null) return null;
    /* 티끌만큼 줄어든 것은 안 줄어든 것으로 본다 — 사람을 헛수고시킨다 */
    return per > cur * (1 - GAIN_TIE) ? null : per;
  };

  for (let round = 0; round < (d.maxSteps ?? MAX_STEPS); round++) {
    let best = null;

    /* ---- 맞바꾸기 ---- */
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const i = idx[a];
        const j = idx[b];
        /* 같은 자리에 있는 것끼리는 맞바꿔도 그대로다 */
        if (placed[i].pos[0] === placed[j].pos[0] && placed[i].pos[1] === placed[j].pos[1]) continue;
        const next = swapped(placed, i, j);
        const per = weigh(next, [placed[i].uid, placed[j].uid]);
        if (per != null && (!best || per < best.per)) {
          best = {
            per,
            next,
            step: {
              kind: 'swap',
              a: placed[i].uid, b: placed[j].uid,
              aName: names.get(placed[i].uid), bName: names.get(placed[j].uid),
              from: cur, to: per,
            },
          };
        }
      }
    }

    /* ---- 당기기 ---- */
    const rows = flowRowsOf(placed, ctx);
    for (const i of idx) {
      const p = placed[i];
      const pull = pullTarget(p.uid, rows, placed);
      if (!pull) continue;
      for (const spot of pullSpots(p.pos, pull.at, d.grid)) {
        const next = placed.map((x, k) => (k === i ? { ...x, pos: spot.pos } : x));
        const per = weigh(next, [p.uid]);
        if (per != null && (!best || per < best.per)) {
          best = {
            per,
            next,
            step: {
              kind: 'slide',
              a: p.uid, aName: names.get(p.uid),
              towardName: pull.name,
              dist: spot.dist,
              pos: spot.pos,
              from: cur, to: per,
            },
          };
        }
      }
    }

    if (!best) break;
    steps.push(best.step);
    placed = best.next;
    cur = best.per;
  }

  return {
    ok: steps.length > 0,
    why: steps.length ? null : 'none',
    before: base,
    after: cur,
    gain: base - cur,
    steps,
    placed,
    tried,
    /* 천장에 걸렸으면 아직 줄어드는 중이었다는 뜻이다 — 한 걸음도 못 찾고
       멈춘 것과는 다른 말이라 화면이 갈라서 말해야 한다 */
    capped: steps.length >= (d.maxSteps ?? MAX_STEPS),
  };
}


/** 「53.2 m → 41.7 m (−22%)」 — 화면과 보고서가 같은 모양으로 쓴다 */
export function gainText(before, after) {
  if (!(before > 0) || !(after >= 0)) return '—';
  const pct = Math.round(((before - after) / before) * 100);
  return `${before.toFixed(1)} m → ${after.toFixed(1)} m (−${pct}%)`;
}
