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
 *  ── 무엇을 움직이는가 — **맞바꾸기 하나** ─────────────────────────────────
 *  설비 두 대의 **자리를 맞바꾼다.** 아무 데나 옮기는 것이 아니다. 이유가 셋 있다.
 *
 *    1. 이것이 실제로 사람이 고민하는 결정이다 — 「어느 자리에 무엇을 둘까」.
 *       고전적인 설비 배치 문제(QAP)가 바로 이 모양이다
 *    2. **말로 옮길 수 있다.** 「제작기 1 과 조립기 2 를 맞바꾸세요」는 그대로
 *       실행할 수 있는 지시다. 「제작기를 (12.75, −4.5) 로」는 그렇지 않다
 *    3. 자리가 그대로라 **바닥·통로·기둥 배치가 안 무너진다.** 빈 땅으로 흩어
 *       놓는 탐색은 값은 좋아지는데 사람이 못 쓰는 도면을 낸다
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
 *
 *  ── 어떻게 찾는가 ─────────────────────────────────────────────────────────
 *  가장 많이 줄어드는 맞바꾸기를 한 번에 하나씩 고른다(steepest descent).
 *  더 줄일 것이 없으면 멈춘다. **씨앗도 난수도 없다** — 같은 도면에서 늘 같은
 *  답이 나와야 사람이 그 답을 믿는다.
 *
 *  이것은 최적해가 아니라 **손볼 곳**이다. 언덕을 내려가다 골짜기에 걸리면 거기서
 *  멈춘다. 그 사실을 화면이 숨기지 않는다.
 * ---------------------------------------------------------------------------
 */

import { footprintOf, outOfBounds, rectsOverlap } from './grid.js';
import { hitsObstacle, rectInFloor } from './area.js';
import { lineBalance } from './balance.js';
import { flowMatrix, metersPerUnit } from './flow.js';
import { cartPath, cartStations, haulPerMinute, isLoadStation } from './cart.js';
import { isTruck } from '../data/library.js';

/** 몇 번까지 손볼 것인가 — 이보다 길면 사람이 따라 하다 만다 */
export const MAX_STEPS = 8;

/** 이만큼도 안 줄면 안 줄어든 것으로 본다 (0.1%) */
export const GAIN_TIE = 0.001;

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
    if (!(h?.perMinute > 0)) return false;
    /* 트럭은 싣기만 한다 — 내리는 곳을 요구하면 늘 실패한다 */
    if (!truck && !st.some((s) => !isLoadStation(s.kind))) return false;
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

/**
 * 손볼 곳을 찾는다.
 *
 *  @returns {
 *    ok       줄일 것을 찾았는가
 *    why      못 찾았으면 이유 ('no-flow' | 'too-few' | 'none')
 *    before   지금 개당 거리 · after 손본 뒤 · gain 줄어든 만큼 (m/개)
 *    steps    [{ a, b, aName, bName, from, to }] — **이 순서대로** 맞바꾼다
 *    placed   다 적용한 배치 (그대로 상태에 넣으면 된다)
 *    tried    후보를 몇 개나 재 봤는가 (화면이 「얼마나 뒤졌는지」를 말한다)
 *  }
 */
export function searchLayout(d = {}) {
  let placed = d.placed ?? [];
  const names = new Map(placed.map((p) => [p.uid, p.name ?? p.uid]));
  const idx = movableIdx(placed, d);
  const base = scoreOf(placed, d);

  if (base == null) return { ok: false, why: 'no-flow', before: null, after: null, gain: 0, steps: [], placed, tried: 0 };
  if (idx.length < 2) return { ok: false, why: 'too-few', before: base, after: base, gain: 0, steps: [], placed, tried: 0 };

  const { routes, links } = baseRoutesOf(d);
  const ctx = { ...d, baseRoutes: routes, baseLinks: links };

  const steps = [];
  let cur = base;
  let tried = 0;

  for (let round = 0; round < (d.maxSteps ?? MAX_STEPS); round++) {
    let best = null;
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const i = idx[a];
        const j = idx[b];
        /* 같은 자리에 있는 것끼리는 맞바꿔도 그대로다 */
        if (placed[i].pos[0] === placed[j].pos[0] && placed[i].pos[1] === placed[j].pos[1]) continue;
        const next = swapped(placed, i, j);
        if (!placeOk(next, [placed[i].uid, placed[j].uid], ctx)) continue;
        if (!routesOk(next, ctx)) continue;
        tried++;
        const per = scoreOf(next, ctx);
        if (per == null) continue;
        /* 티끌만큼 줄어든 것은 안 줄어든 것으로 본다 — 사람을 헛수고시킨다 */
        if (per > cur * (1 - GAIN_TIE)) continue;
        if (!best || per < best.per) best = { i, j, per, next };
      }
    }
    if (!best) break;
    steps.push({
      a: placed[best.i].uid,
      b: placed[best.j].uid,
      aName: names.get(placed[best.i].uid),
      bName: names.get(placed[best.j].uid),
      from: cur,
      to: best.per,
    });
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
  };
}

/** 「53.2 m → 41.7 m (−22%)」 — 화면과 보고서가 같은 모양으로 쓴다 */
export function gainText(before, after) {
  if (!(before > 0) || !(after >= 0)) return '—';
  const pct = Math.round(((before - after) / before) * 100);
  return `${before.toFixed(1)} m → ${after.toFixed(1)} m (−${pct}%)`;
}
