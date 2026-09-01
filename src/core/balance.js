/**
 * =============================================================================
 *  라인 밸런싱 — 돌리기 전에 「능력」을 계산한다
 * =============================================================================
 *  진단(`diagnose.js`)은 **돌린 뒤에** 무엇이 막혔는지 짚는다. 그런데 정작
 *  궁금한 것은 그다음이다 — **「그래서 뭘 얼마나 늘려야 하나?」**
 *
 *  그 답은 돌려 보지 않아도 나온다. 설비마다 공정 시간이 있고, 벨트마다 속도와
 *  간격이 있고, 카트마다 적재량과 한 바퀴 시간이 있다. 사슬에서 **가장 약한
 *  고리**가 곧 라인의 능력이고, 그것을 풀면 그다음 고리가 드러난다.
 *
 *  ── 능력은 그냥 못 견준다 ────────────────────────────────────────────────
 *  「제작기 20개/분 vs 조립기 10개/분」 을 보고 조립기가 병목이라 하면 **틀린다.**
 *  조립기가 한 개에 부품 2개를 먹는다면 둘은 균형이 맞는 것이다.
 *
 *  그래서 전부 **「최종 산출물 몇 개/분을 지탱하는가」** 라는 한 단위로 바꾼다.
 *  설비마다 「내 산출물 몇 개가 최종 1개에 들어가는가」(배수)를 레시피를 따라
 *  내려가며 구하고, 자기 능력을 그 배수로 나눈다.
 *
 *  ── 적치대·선반은 능력이 아니다 ──────────────────────────────────────────
 *  **여기 안 들어간다.** 쌓는 곳은 완충이지 속도가 아니다 — 적치대가 가득 찼다는
 *  것은 「적치대가 작다」 가 아니라 「그걸 비우는 쪽이 느리다」 는 뜻이다. 늘리면
 *  버티는 시간이 길어질 뿐 정상 상태의 처리량은 그대로다. 그 오해를 부추기지
 *  않으려고 목록에서 뺐다.
 * ---------------------------------------------------------------------------
 */

import { flowEdges, isSource, outputKindOf, recipeOf } from './bom.js';
import {
  SCRAP_TO,
  batchOf, beltPerMinute, bundleOf, cycleOf, effectiveCycle, lotOf, perMinute, reworkOf, scrapToOf,
  setupOf, spacingFor, unitCycleOf,
} from './process.js';
import { beltKinds } from './link.js';
import { recipesOf, sendKindsOf } from './bom.js';
import { isShelf, isStillage, isTruck, isUtility } from '../data/library.js';
import { cartPath, cartStations, haulPerMinute } from './cart.js';

/** 흐름에서 볼 만한 설비인가 — 쌓는 곳과 부속은 만드는 물건이 아니다 */
const makes = (item) => !!item && !isShelf(item) && !isStillage(item) && !isUtility(item);

/**
 * 라인의 능력 — 사슬의 고리들을 한 단위로 세워 놓는다.
 *
 *  ── **이 값이 무엇인지 못 박아 둔다** ──────────────────────────────────────
 *  `capacity` 는 **품종 하나의** 개/분이고, **품종을 고르게 번갈아 만들 때**의
 *  값이다. 두 가지를 헷갈리기 쉬워서 적어 둔다.
 *
 *  **① 품종당이지 합계가 아니다.** 2품종 라인의 실측 합계는 이 값의 두 배까지
 *     나온다. 합계를 이 값으로 나눠 「천장의 몇 %」라고 말하면 180% 가 찍힌다.
 *
 *  **② 규칙이 「차례대로」가 아니면 상한이 아니라 가정이다.** 「납기 먼저」는
 *     급한 품종 하나를 계속 만들 수 있어서 번갈지 않는다. 그때 그 품종의
 *     산출은 이 값을 넘는다 — 실측 ×1.88 (`tools/check/ceiling.mjs` 가 그 값을
 *     박아 두었다). 천장이 틀린 것이 아니라 **전제가 안 맞는 것**이다.
 *
 *  고치려면 품종별 몫(`share`)을 오더에서 끌어와야 하고, 그러면 「가장 약한
 *  고리」가 수 하나가 아니라 영역이 되어 `improve.js`·`optimize.js` 까지 바뀐다.
 *  작은 일이 아니라서 지금은 **뜻만 밝혀 둔다.**
 *
 *  @returns {{ rows, capacity, neck }}
 *    rows      느린 순서. `{ kind, uid, name, own, mult, capacity, why }`
 *    capacity  라인 능력 (**품종당** 최종 개/분) — 가장 약한 고리.
 *              **고르게 번갈아 만들 때의 값**이다(위 ②)
 *    neck      그 고리
 */
/**
 * 왜 이 속도인가 — **한 줄로 읽히게** 이어 붙인다.
 * ---------------------------------------------------------------------------
 *  공정 · 배치 · 품종 · 전환이 각각 개당 시간을 바꾼다. 셋이 겹칠 수 있어서
 *  경우를 나눠 문장을 따로 쓰면 조합이 여덟 가지가 된다 — 그래서 **조각을
 *  이어 붙인다.** 아무것도 안 걸리면 예전 그대로 「공정 6초/개」다.
 *
 *      공정 600초 · 한 판에 20개 = 30.0초/개
 *      공정 2초 · 품종 2가지를 번갈아 = 한 품종에 7.0초/개
 */
/** 이 설비가 내보내는 종류들 — 품종을 여럿 들면 여럿이다 */
const outKindsOf = (p, item) => sendKindsOf(p, item, scrapToOf(p, item) === SCRAP_TO.OUT);

export function whyOf({ cyc, batch = 1, many = 1, lot = 0, setupSec = 0, scrap = 0, reworkSec = 0, eff }) {
  const parts = [`공정 ${cyc}초`];
  if (batch > 1) parts.push(`한 판에 ${batch}개`);
  if (many > 1) parts.push(`품종 ${many}가지를 번갈아`);
  if (lot > 0 && setupSec > 0) parts.push(`전환 ${setupSec}초/${lot}개`);
  /* 불량은 **양품 한 개에 드는 시간**을 늘린다 — 버리든 다시 만들든 */
  if (scrap > 0) {
    parts.push(`불량 ${(scrap * 100).toFixed(0)}% ${reworkSec > 0 ? `재작업 ${reworkSec}초` : '버림'}`);
  }
  if (parts.length === 1) return `공정 ${cyc}초/개`;
  const head = `${many > 1 ? '한 품종에 ' : ''}${scrap > 0 ? '양품 ' : ''}`;
  return `${parts.join(' · ')} = ${head}${(eff * many).toFixed(1)}초/개`;
}

export function lineBalance({ placed = [], links = [], carts = [], itemOf, specOf = () => null, beltSpeed = 0.6 } = {}) {
  const byUid = new Map(placed.map((p) => [p.uid, p]));
  const edges = flowEdges(links, byUid, itemOf);

  /* ---- 배수: 최종 1개당 이 설비의 산출물이 몇 개 드는가 ---- */
  const mult = new Map();
  const walk = (uid, seen) => {
    if (mult.has(uid)) return mult.get(uid);
    if (seen.has(uid)) return 1;                       // 고리 — 여기서 끊는다
    const p = byUid.get(uid);
    if (!p) return 1;
    const kind = outputKindOf(p, itemOf(p.itemId));

    /* 내 산출물을 먹는 설비들 — 그중 가장 많이 드는 길을 따른다.
       (여러 갈래로 나가면 그중 무거운 쪽이 이 설비의 부담을 정한다) */
    let m = 0;
    const next = new Set(seen).add(uid);
    for (const e of edges) {
      if (e.from !== uid) continue;
      const eater = byUid.get(e.to);
      if (!eater) continue;
      const need = (recipeOf(eater)?.in ?? []).find((x) => x.kind === kind)?.qty ?? 0;
      if (!need) continue;
      m = Math.max(m, need * walk(e.to, next));
    }
    const val = m > 0 ? m : 1;                          // 아무도 안 먹으면 최종 공정
    mult.set(uid, val);
    return val;
  };
  for (const p of placed) if (makes(itemOf(p.itemId))) walk(p.uid, new Set());

  const rows = [];

  /* ---- 설비 ---- */
  for (const p of placed) {
    const item = itemOf(p.itemId);
    if (!makes(item)) continue;
    const cyc = cycleOf(p, item);
    /**
     * **전환까지 셈에 넣는다.** 안 넣으면 「돌리기 전 계산」과 「돌려 본 결과」가
     * 갈리고, 사람은 시뮬이 틀렸다고 여긴다. 20개마다 300초면 6초짜리 공정이
     * 실질 21초가 된다 — 로트가 작을수록 전환이 비싸다는 것이 이 한 줄에 있다.
     */
    const lot = lotOf(p, item);
    const setupSec = setupOf(p, item);
    /**
     * **배치는 개당 시간을 판 크기로 나눈다.**
     *  20개를 600초에 굽는 오븐은 「600초짜리 설비」가 아니라 30초/개다 —
     *  안 나누면 천장이 스무 배 낮게 나온다.
     */
    const batch = batchOf(p, item);
    /* 불량률과 재작업도 **양품 개당 시간**을 늘린다. 안 넣으면 불량률만 올려도
       천장과 실측이 갈린다 — 실제로 「천장 600 · 실제 544」가 나왔다 */
    const scrap = Math.min(1, Math.max(0, Number(p.scrapRate) || 0));
    const reworkSec = reworkOf(p, item);
    const eff = effectiveCycle(cyc, lot, setupSec, batch, { scrap, reworkSec });
    /**
     * **품종이 여럿이면 한 품종의 몫은 그만큼 준다.**
     *  20개씩 두 품종을 번갈아 만드는 설비는 제작품 1을 「6초에 하나」가 아니라
     *  **12초에 하나** 낸다 — 절반의 시간은 다른 것을 만든다. 안 나누면 천장이
     *  두 배로 부풀고, 돌려 본 결과가 절반으로 나온다.
     */
    const many = Math.max(1, recipesOf(p).length);
    const own = perMinute(eff) / many;
    const m = mult.get(p.uid) ?? 1;
    rows.push({
      kind: 'equip',
      uid: p.uid,
      name: p.name ?? p.uid,
      own,
      mult: m,
      capacity: own / m,
      why: whyOf({ cyc, batch, many, lot, setupSec, scrap, reworkSec, eff }),
    });
  }

  /* ---- 벨트 ---- */
  for (const l of links) {
    const item = itemOf(l.itemId);
    if (!item || isUtility(item)) continue;
    const from = byUid.get(l.from?.uid);
    if (!from || !makes(itemOf(from.itemId))) continue;
    /* 한 번에 내보내는 개수 — 이름이 outputCount 다(process.bundleOf) */
    const layers = bundleOf(from);
    const v = Number(l.speed) > 0 ? Number(l.speed) : beltSpeed;
    /**
     * **갈래로 나뉘면 이 벨트가 지는 몫도 나뉜다.**
     * -----------------------------------------------------------------------
     *  두 품종을 만드는 설비에서 벨트를 둘로 갈라 하나씩 맡기면, 벨트 하나는
     *  설비 산출의 절반만 실으면 된다. 그걸 모르면 벨트가 설비 전부를 실어야
     *  하는 것처럼 봐서 **천장이 절반으로 낮게** 나오고, 그러면 실측이 천장을
     *  넘는다 — 이 도구가 제일 피해야 하는 그림이다.
     */
    /* 이름을 `makes` 로 두면 위쪽 `makes()` 를 가려 TDZ 로 터진다 —
       이 파일에서 두 번 밟은 함정이다 */
    const sends = outKindsOf(from, itemOf(from.itemId));
    const kinds = beltKinds(l).filter((k) => sends.includes(k));
    const share = kinds.length ? kinds.length / Math.max(1, sends.length) : 1;
    /* 벨트 간격은 **개당** 시간을 본다 — 배치 설비는 한 판을 한꺼번에 내므로
       공정 시간을 그대로 쓰면 간격이 판 크기만큼 벌어진다 */
    const gap = spacingFor(unitCycleOf(from, itemOf(from.itemId)), layers, v);
    const own = beltPerMinute(gap, v, layers) / share;
    const m = mult.get(from.uid) ?? 1;
    rows.push({
      kind: 'belt',
      uid: l.uid,
      name: l.name ?? l.uid,
      own,
      mult: m,
      capacity: own / m,
      why: `${v} m/s · 간격 ${gap.toFixed(2)} m`,
    });
  }

  /* ---- 카트 · 트럭 ----
     경로 하나가 여러 종류를 섞어 나르므로 **배수를 한쪽에 물릴 수 없다.**
     그래서 배수 1 로 두고 「전체 수송 능력」으로 견준다 — 라인이 그보다
     빨라지면 실어 나르는 쪽이 먼저 찬다는 뜻은 그대로 맞다. */
  for (const c of carts) {
    const item = itemOf(c.itemId);
    const truck = isTruck(item);
    const path = cartPath(c);
    if (!path) continue;
    const st = cartStations(path, placed, itemOf, { loadOnly: truck, roles: c.roles });
    const h = haulPerMinute(c, path, st, { truck });
    if (!h) continue;
    rows.push({
      kind: truck ? 'truck' : 'cart',
      uid: c.uid,
      name: c.name ?? c.uid,
      own: h.perMinute,
      mult: 1,
      capacity: h.perMinute,
      why: `${c.count ?? 1}대 · 한 바퀴 ${Math.round(h.lapSec)}초`,
    });
  }

  rows.sort((a, b) => a.capacity - b.capacity);
  return { rows, capacity: rows.length ? rows[0].capacity : 0, neck: rows[0] ?? null };
}

/** 능력이 이 안쪽으로 붙어 있으면 **같은 고리**로 본다 (1%) */
export const TIE = 0.01;

/**
 * 「이걸 풀면 그다음은?」 — 병목을 걷어내며 라인 능력이 어디서 멈추는지.
 * ---------------------------------------------------------------------------
 *  **같은 능력끼리 묶는 것**이 요점이다. 하나씩 늘어놓으면 이런 목록이 나온다 —
 *
 *      제작기2  5개/분 → 풀면 5개/분 (+0.0)   ← ?
 *      벨트2    5개/분 → 풀면 10개/분 (+5.0)
 *
 *  제작기2 만 고쳐 봐야 **하나도 안 오른다.** 바로 뒤에 같은 능력의 벨트가
 *  있기 때문이다. 그런데 위 목록은 그것을 「+0.0」 이라는 작은 글씨로만 말한다.
 *  묶어 놓으면 「이 둘을 **함께** 고쳐야 5 → 10 이 된다」 가 한눈에 보인다.
 *
 *  마지막 묶음 뒤에는 아무것도 없다 — 그때 오름폭은 **무한대가 아니라 「여기가
 *  천장」** 이라는 뜻이다.
 */
export function bottleneckChain(rows, depth = 4) {
  const left = [...(rows ?? [])].filter((r) => Number.isFinite(r.capacity)).sort((a, b) => a.capacity - b.capacity);
  if (!left.length) return [];

  /* 같은 능력끼리 묶는다 — 첫 항목 기준 1% 안이면 한 묶음 */
  const groups = [];
  for (const r of left) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(r.capacity - g.capacity) <= Math.max(1e-9, g.capacity * TIE)) g.items.push(r);
    else groups.push({ capacity: r.capacity, items: [r] });
  }

  return groups.slice(0, depth).map((g, i) => {
    const next = groups[i + 1] ?? null;
    return {
      capacity: g.capacity,
      items: g.items,
      /* 이 묶음을 **함께** 풀면 라인은 다음 묶음까지 오른다 */
      then: next ? next.capacity : null,
      gain: next ? next.capacity - g.capacity : null,
      last: !next,
    };
  });
}

/**
 * 라인이 **균형인가** — 모든 고리가 한 묶음 안에 있으면 더 손볼 데가 없다.
 *  이때 「병목은 제작기1」 이라고 말하면 거짓말이 된다. 다섯이 똑같이 10개/분
 *  이면 그중 하나를 짚는 것은 뽑기지 진단이 아니다.
 */
export const isBalanced = (rows) => bottleneckChain(rows, 2).length <= 1;

/** 개/분 → 사람이 읽는 문구. 시간당이 더 와 닿는 크기면 그쪽으로 */
export const rateText = (perMin) => {
  if (!Number.isFinite(perMin)) return '제한 없음';
  if (perMin <= 0) return '0 개/분';
  return perMin < 10 ? `${perMin.toFixed(1)} 개/분` : `${Math.round(perMin)} 개/분`;
};
