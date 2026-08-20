/**
 * =============================================================================
 *  레시피 (BOM) — 설비가 무엇을 먹고 무엇을 만드는가
 * =============================================================================
 *  지금까지 설비는 **무에서 물건을 뱉는 기계**였다. 유출부에 벨트를 물리면
 *  반송물이 끝없이 흘러나오고, 무엇을 넣어 주는지는 아무 상관이 없었다.
 *  그래서 이 도면으로는 답할 수 없는 질문이 있었다.
 *
 *    · 조립 라인의 앞 공정이 밀리면 뒤 공정은 얼마나 굶는가
 *    · 완성품 100개를 내보내려면 원자재가 몇 개 들어와야 하는가
 *    · 저 설비 앞에 재고가 쌓이는 것은 저 설비가 느려서인가, 안 와서인가
 *
 *  레시피는 그 셋을 한꺼번에 푼다.
 *
 *      recipe = { in: [{ kind, qty }, …], out: 종류 }
 *               qty 는 **완성품 1개당** 소요량이다
 *
 *  ── 설비 인스턴스에 붙인다 (라이브러리 항목이 아니라) ─────────────────────
 *  같은 기계라도 자리마다 하는 일이 다르다. 라인 앞쪽의 제작기는 제작품 1 을
 *  만들고 뒤쪽의 제작기는 제작품 3 을 만들 수 있다. 라이브러리 항목에 매달면
 *  그 구분이 불가능하다. `placed.recipe` 는 도면의 일부라 저장·되돌리기가
 *  그대로 따라온다(layoutSnapshot 이 placed 를 통째로 담는다).
 *
 *  ── 라우팅(공정 순서)은 따로 적지 않는다 ─────────────────────────────────
 *  상용 도구는 "제품 P 는 공정 1 → 2 → 3 을 거친다" 는 표를 따로 들고 다닌다.
 *  여기서는 **벨트가 이미 그 말을 하고 있다.** 표를 하나 더 두면 도면과 표가
 *  어긋날 수 있고, 어긋났을 때 어느 쪽이 사실인지 말할 수 없게 된다.
 *  그래서 순서는 적지 않고 **도면에서 읽는다**(아래 `flowEdges`·`auditRecipes`).
 *  적는 대신 읽으면, 벨트를 하나 옮기는 순간 라우팅도 같이 옮겨 간다.
 *
 *  ── 레시피가 없으면 지금까지와 똑같다 ────────────────────────────────────
 *  입력이 비면 **원자재 공급원**이다 — 아무것도 안 먹고 계속 만든다. 이미 그린
 *  도면이 이 기능 때문에 갑자기 서면 안 되므로 그게 기본값이다.
 * ---------------------------------------------------------------------------
 */

import { PAYLOAD_ITEMS, allowedOutOf, canonKind } from '../data/library.js';

/** 설비 입력 버퍼의 기본 크기(개) — 도면에 적지 않으면 이 값 */
export const DEFAULT_INPUT_CAP = 30;

/** 산출물을 알 수 없을 때 (손으로 고친 도면·아주 옛날 파일) */
const DEFAULT_KIND = Object.keys(PAYLOAD_ITEMS)[0];

/** 한 종류당 소요량의 상한 — 슬라이더 범위이자 정규화 한계 */
export const MAX_QTY = 20;

/**
 * 한 설비가 들 수 있는 품종의 수.
 *  넷을 넘기면 전환에 드는 시간이 만드는 시간을 넘어서 라인이 사실상 서고,
 *  칩 줄도 접혀 순서를 못 읽는다. 실제 공장도 한 설비에 이만큼을 안 문다.
 */
export const MAX_KINDS = 4;

/* --------------------------------------------------------------------------
 * 레시피 읽기
 * ------------------------------------------------------------------------ */

/** 모르는 이름은 떨구고, 옛 이름은 지금 이름으로 바꾼다 (library 의 KIND_ALIAS) */
const knownKind = (k) => (typeof k === 'string' ? canonKind(k) : null);

/**
 * 저장된 값을 믿을 수 있는 모양으로 다듬는다.
 * ---------------------------------------------------------------------------
 *  도면 파일은 손으로 고칠 수 있고, 반송물 종류는 늘거나 줄 수 있다. 모르는
 *  종류가 섞인 채로 계산에 들어가면 "영영 채워지지 않는 입력" 이 되어 설비가
 *  이유 없이 굶는다 — 화면에는 아무 단서도 안 남는다. 그래서 여기서 떨군다.
 *
 *  같은 종류가 두 줄로 적혀 있으면 더한다. 두 줄을 그대로 두면 소요량을 세는
 *  쪽마다 "첫 줄만 볼지 다 볼지" 를 각자 정하게 된다.
 *
 *  @returns 정규화된 레시피 · 아무 뜻도 없으면 null (= 원자재 공급원)
 */
export function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const merged = new Map();
  for (const row of Array.isArray(raw.in) ? raw.in : []) {
    const kind = knownKind(row?.kind);
    if (!kind) continue;
    const qty = Math.round(Number(row?.qty) || 0);
    if (qty <= 0) continue;
    merged.set(kind, Math.min(MAX_QTY, (merged.get(kind) ?? 0) + qty));
  }

  const out = knownKind(raw.out);
  const list = [...merged.entries()].map(([kind, qty]) => ({ kind, qty }));
  if (!list.length && !out) return null;
  return { in: list, out };
}

/** 이 설비의 레시피 (없으면 null) */
export const recipeOf = (placed) => recipesOf(placed)[0] ?? null;

/**
 * 이 설비가 만드는 것들 — **여럿일 수 있다.**
 * ---------------------------------------------------------------------------
 *  예전에는 `placed.recipe` 하나였다. 한 설비가 한 가지만 만들었으니 「품종
 *  전환」이라는 말 자체가 성립하지 않았다(그래서 셋업을 「로트 전환」이라
 *  불렀다). 이제 `placed.recipes` 에 여러 개를 둘 수 있다.
 *
 *  **옛 도면이 그대로 돈다.** `recipes` 가 없으면 `recipe` 하나를 담은 줄로
 *  본다 — 이미 그린 도면은 한 가지만 만드는 설비고, 그건 여전히 맞는 말이다.
 *
 *  @returns 정규화된 레시피 배열 (없으면 빈 배열 = 원자재 공급원)
 */
export function recipesOf(placed) {
  const many = Array.isArray(placed?.recipes) ? placed.recipes : null;
  if (many?.length) {
    const list = many.map(normalizeRecipe).filter(Boolean);
    if (list.length) return list;
  }
  const one = normalizeRecipe(placed?.recipe);
  return one ? [one] : [];
}

/**
 * 지금 만들고 있는 것 (`slot` 번째).
 *  줄을 벗어난 번호는 처음으로 돌린다 — 레시피를 지웠는데 굴리는 쪽이 옛
 *  번호를 들고 있으면 아무것도 못 만들게 된다.
 */
export const recipeAt = (placed, slot = 0) => {
  const list = recipesOf(placed);
  if (!list.length) return null;
  return list[((Math.round(slot) % list.length) + list.length) % list.length];
};

/** 품종을 바꿔 가며 만드는 설비인가 */
export const isMulti = (placed) => recipesOf(placed).length > 1;

/**
 * 원자재 공급원인가 — 아무것도 안 먹고 계속 만드는 설비.
 *  레시피가 없거나 산출 종류만 정한 경우가 여기다.
 */
export const isSource = (recipe) => !recipe?.in?.length;

/**
 * 이 설비가 내보내는 종류.
 * ---------------------------------------------------------------------------
 *  **무엇을 만드는지는 도면이 정하고, 어느 갈래인지는 기계가 정한다.**
 *
 *  갈래(제작품 / 조립품)는 그 기계가 하는 일 자체다 — 조립기가 제작품을 뱉으면
 *  두 설비를 나눈 뜻이 없어지고, 도면만 보고 어느 공정인지 읽을 수 없게 된다.
 *  그래서 라이브러리 항목의 `makes` 가 **고를 수 있는 것의 범위**를 정하고,
 *  그 안에서의 선택은 온전히 도면의 몫이다(`recipe.out`).
 *
 *  범위를 벗어난 값은 갈래의 첫 종류로 되돌린다. 손으로 고친 도면이나, 갈래를
 *  나누기 전에 그린 도면이 그럴 수 있다 — 그대로 두면 조립기가 제작품을 뱉는
 *  도면이 조용히 살아남는다.
 */
export function outKindOf(recipe, item) {
  const out = canonKind(recipe?.out);
  const allowed = allowedOutOf(item);
  return out && allowed.includes(out) ? out : allowed[0] ?? DEFAULT_KIND;
}

/**
 * 이 설비가 내보내는 종류 — 품종이 여럿이면 **첫 품종**의 것.
 *  지금 무엇을 만드는 중인지 알아야 하면 `outKindOf(recipeAt(p, slot), item)`.
 */
export const outputKindOf = (placed, item) => outKindOf(recipeOf(placed), item);

/** 입력 버퍼 크기 */
export const inputCapOf = (placed) =>
  Math.max(1, Math.round(placed?.inputCap ?? DEFAULT_INPUT_CAP));

/**
 * 버퍼의 자리를 **종류마다 떼어 준다.**
 * ---------------------------------------------------------------------------
 *  한 버퍼를 여러 종류가 자리다툼하게 두면 **되돌릴 수 없는 교착**이 생긴다.
 *  실제로 이런 상태를 만났다 — 「제작품 3 × 3 + 제작품 1 × 3 → 조립품 2」 설비의
 *  200칸이 이렇게 찼다.
 *
 *      제작품 3  177개    제작품 2  21개    제작품 1  2개
 *
 *  제작품 3 이 빨리 들어와 자리를 다 먹었고, 정작 필요한 제작품 1 이 들어올
 *  자리가 없다. 버퍼가 가득 차 벨트도 서 있으니 **영영 풀리지 않는다.** 사람이
 *  손으로 비워 주기 전에는 그 설비가 죽은 것이다.
 *
 *  ── 현장에서는 부품마다 통이 따로다 ──────────────────────────────────────
 *  볼트 상자와 너트 상자를 한 통에 붓지 않는다. 볼트가 아무리 많이 와도 너트
 *  자리를 먹지 못하고, 볼트 통이 차면 **볼트 라인이 선다.** 그게 옳은 신호다 —
 *  "앞 공정이 너무 빠르다" 를 그 자리에서 말해 준다.
 *
 *  그래서 자리를 **레시피 비율대로** 나눈다. 3 : 3 이면 반반, 2 : 1 이면 2 : 1.
 *  많이 먹는 것에 많은 자리를 주는 것이 맞다.
 *
 *  @returns { 종류: 자리수 } · 원자재 공급원이면 빈 객체
 */
export function slotShares(recipe, cap) {
  const out = {};
  if (isSource(recipe)) return out;
  const total = Math.max(1, Math.round(cap));
  const sum = recipe.in.reduce((s, r) => s + r.qty, 0);
  if (sum <= 0) return out;

  let given = 0;
  recipe.in.forEach((r, i) => {
    /* 마지막 종류가 나머지를 다 가져간다 — 내림 때문에 생긴 빈칸을 놀리지 않는다 */
    const share = i === recipe.in.length - 1
      ? total - given
      : Math.floor((total * r.qty) / sum);
    out[r.kind] = Math.max(0, share);
    given += out[r.kind];
  });
  return out;
}

/**
 * 이 버퍼가 한 덩어리치를 담을 만한가.
 *  자리를 나누고 나면 버퍼가 작을 때 **어느 종류도 한 덩어리치를 못 채우는**
 *  일이 생긴다. 그러면 설비는 영원히 굶는데 화면에는 "재료 부족" 이라고만 뜬다 —
 *  진짜 원인(버퍼가 작다)을 말해 줄 수 있어야 한다.
 *
 *  @param per 한 덩어리의 개수(적재 층수)
 *  @returns 모자란 종류들 [{ kind, need, slots }] · 넉넉하면 빈 배열
 */
export function tooSmallFor(recipe, cap, per) {
  if (isSource(recipe)) return [];
  const shares = slotShares(recipe, cap);
  const out = [];
  for (const { kind, qty } of recipe.in) {
    const need = qty * Math.max(1, per);
    if ((shares[kind] ?? 0) < need) out.push({ kind, need, slots: shares[kind] ?? 0 });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 소요량
 * ------------------------------------------------------------------------ */

/**
 * 완성품 `count` 개를 만드는 데 드는 재료 — { 종류: 개수 }.
 *  원자재 공급원이면 빈 객체다(먹을 것이 없다).
 */
export function needFor(recipe, count) {
  const n = Math.max(0, Math.round(count));
  const need = {};
  if (!n || isSource(recipe)) return need;
  for (const { kind, qty } of recipe.in) need[kind] = qty * n;
  return need;
}

/** 쌓여 있는 것의 종류별 개수 — [종류, …] → { 종류: 개수 } */
export function countKinds(lots) {
  const out = {};
  for (const k of lots ?? []) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/**
 * 모자란 만큼 — { 종류: 부족분 }. 다 있으면 빈 객체.
 *  "몇 개가 모자란가" 까지 돌려주는 이유는 화면이 이유를 말할 수 있어야 하기
 *  때문이다. 굶은 설비를 붉게 칠해 놓고 무엇이 없는지 안 알려 주면, 사용자는
 *  라인 전체를 뒤져야 한다.
 */
export function missingOf(have, need) {
  const out = {};
  for (const [kind, qty] of Object.entries(need ?? {})) {
    const short = qty - (have?.[kind] ?? 0);
    if (short > 0) out[kind] = short;
  }
  return out;
}

/** 재료가 다 있는가 */
export const canBuild = (have, need) => !Object.keys(missingOf(have, need)).length;

/**
 * 한 번에 낼 수 있는 최대 개수 — 재고로 몇 개까지 만들 수 있는가.
 *  원자재 공급원은 제한이 없다(Infinity).
 */
export function buildableCount(have, recipe) {
  if (isSource(recipe)) return Infinity;
  let n = Infinity;
  for (const { kind, qty } of recipe.in) {
    n = Math.min(n, Math.floor((have?.[kind] ?? 0) / qty));
    if (n <= 0) return 0;
  }
  return n;
}

/* --------------------------------------------------------------------------
 * 도면에서 라우팅을 읽는다
 * ------------------------------------------------------------------------ */

/**
 * 자재가 흐르는 간선 — 벨트 하나가 곧 "A 가 만든 것이 B 로 간다" 는 문장이다.
 * ---------------------------------------------------------------------------
 *  연결은 언제나 "유출 → 유입" 으로 저장되므로 방향은 이미 정해져 있다.
 *  실어 나르는 종류는 **출발 설비가 만드는 것** 하나뿐이다.
 *
 *  @param links   도면의 연결 목록
 *  @param byUid   uid → placed
 *  @param itemOf  itemId → 라이브러리 항목
 *  @returns [{ from, to, kind }]
 */
export function flowEdges(links, byUid, itemOf) {
  const out = [];
  for (const l of links ?? []) {
    const item = itemOf(l.itemId);
    /* 배관·전선은 자재가 아니라 부속이다. 자유 끝점·다른 연결에 붙은 끝도
       설비가 아니므로 흐름이 아니다. */
    if (!item || item.utility) continue;
    const a = l.from?.uid && !l.from.anchor && !l.from.link ? byUid.get(l.from.uid) : null;
    const b = l.to?.uid && !l.to.anchor && !l.to.link ? byUid.get(l.to.uid) : null;
    if (!a || !b) continue;
    out.push({ from: a.uid, to: b.uid, kind: outputKindOf(a, itemOf(a.itemId)) });
  }
  return out;
}

/**
 * 레시피 진단 — 도면이 말이 되는가.
 * ---------------------------------------------------------------------------
 *  가장 흔한 실수는 **재료가 들어올 길이 없는 조립 설비**다. 그려 놓고 돌리면
 *  아무 일도 안 일어나는데, 화면만 봐서는 벨트가 왜 안 도는지 알 수 없다.
 *  (설비가 굶어 서 있는 것과 아직 안 돌린 것이 똑같이 보인다)
 *
 *  ── 카트가 대는 설비는 건드리지 않는다 ───────────────────────────────────
 *  카트는 경로를 따라 아무거나 실어 올 수 있어서, 무엇이 올지 도면만으로는
 *  단정할 수 없다. 단정할 수 없는 것을 경고로 만들면 멀쩡한 도면이 붉어진다.
 *  그래서 **카트가 내려놓는 역이 붙은 설비는 진단에서 뺀다** — 확실히 틀린
 *  것만 말하고, 애매한 것은 말하지 않는다.
 *
 *  @param nodes    [{ uid, name, recipe, cartFed }]
 *  @param edges    flowEdges 의 결과
 *  @returns [{ uid, name, kind, reason }]
 */
export function auditRecipes(nodes, edges) {
  const arriving = new Map();          // uid → Set<종류>
  for (const e of edges ?? []) {
    if (!arriving.has(e.to)) arriving.set(e.to, new Set());
    arriving.get(e.to).add(e.kind);
  }

  const out = [];
  for (const n of nodes ?? []) {
    if (isSource(n.recipe) || n.cartFed) continue;
    const have = arriving.get(n.uid);
    for (const { kind } of n.recipe.in) {
      if (have?.has(kind)) continue;
      out.push({
        uid: n.uid,
        name: n.name,
        kind,
        reason: have?.size ? 'wrong' : 'none',
      });
    }
  }
  return out;
}

/**
 * BOM 전개 — 완성품 1개에 원자재가 몇 개 드는가.
 * ---------------------------------------------------------------------------
 *  "조립품 1 하나 = 제작품 1 두 개 + 제작품 2 한 개" 는 레시피만 봐도 안다. 알고
 *  싶은 것은 그 제작품들을 만드느라 **라인 맨 앞에서 몇 개가 들어와야 하는가** 다.
 *  그 숫자가 있어야 앞 공정의 처리량이 뒤 공정을 먹여 살릴 수 있는지 견줄 수
 *  있다.
 *
 *  상류로 거슬러 올라가며, 그 종류를 만드는 설비가 있으면 그 설비의 레시피로
 *  갈아 끼우고, 없으면 **원자재**로 본다(라인 밖에서 들어오는 것).
 *
 *  ── 고리를 만나면 거기서 멈춘다 ──────────────────────────────────────────
 *  A 가 B 를 먹고 B 가 A 를 먹는 도면도 그릴 수 있다. 실제 라인에서는 재작업
 *  루프가 그렇게 생긴다. 전개는 무한히 깊어지므로, 이미 지나온 설비를 다시
 *  만나면 그 자리에서 원자재로 세고 멈춘다 — 틀린 숫자를 내놓느니 거기까지만
 *  말하는 편이 낫다(`looped` 로 알린다).
 *
 *  @returns { raw: { 종류: 개수 }, looped: boolean }
 */
export function explode(uid, byUid, edges, seen = new Set()) {
  const node = byUid.get(uid);
  const recipe = recipeOf(node);
  if (!node || isSource(recipe)) return { raw: {}, looped: false };
  if (seen.has(uid)) return { raw: {}, looped: true };

  const next = new Set(seen);
  next.add(uid);

  /* 이 설비로 들어오는 간선에서 "그 종류를 만드는 상류 설비" 를 찾는다 */
  const makerOf = new Map();
  for (const e of edges ?? []) {
    if (e.to !== uid) continue;
    if (!makerOf.has(e.kind)) makerOf.set(e.kind, e.from);
  }

  const raw = {};
  let looped = false;
  const add = (kind, qty) => { raw[kind] = (raw[kind] ?? 0) + qty; };

  for (const { kind, qty } of recipe.in) {
    const maker = makerOf.get(kind);
    if (maker == null) { add(kind, qty); continue; }     // 라인 밖에서 들어온다
    const sub = explode(maker, byUid, edges, next);
    if (sub.looped) { looped = true; add(kind, qty); continue; }
    if (!Object.keys(sub.raw).length) { add(kind, qty); continue; }  // 상류가 공급원
    for (const [k, n] of Object.entries(sub.raw)) add(k, n * qty);
  }
  return { raw, looped };
}
