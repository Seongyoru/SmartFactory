/**
 * =============================================================================
 *  벨트 한 줄의 흐름 — 자리 계산과 재료 셈
 * =============================================================================
 *  화면(BeltItems)에서 떼어 낸 이유는 하나다. **이 파일이 라인의 처리량을 정한다.**
 *  몇 개가 올라타고 몇 개가 끝에 닿았는지가 여기서 나오고, 그 수가 그대로 재고와
 *  지표가 된다. 그림 안에 섞여 있으면 값으로 확인할 수가 없다.
 *
 *  ── 개체를 하나씩 관리하지 않는다 ─────────────────────────────────────────
 *   "언제 만들어서 언제 지운다" 를 목록으로 들고 있으면 상태가 늘어나고, 속도나
 *   간격을 바꿀 때마다 목록을 손봐야 한다. 대신 **흘러간 거리 하나**만 굴린다.
 *
 *       덩어리 n 의 위치 = trav − n×간격        (n = 0, 1, 2 … 올라탄 순서)
 *       trav 가 간격을 넘을 때마다 새 덩어리가 올라탄다
 *
 *   그래서 간격이 항상 정확하고, 속도를 바꿔도 줄이 흐트러지지 않는다.
 *
 *  ── 그런데 줄에 **빈칸**이 필요하다 ───────────────────────────────────────
 *   예전에는 재료가 없으면 **벨트를 세웠다.** 그러면 이미 올라타 있던 물건까지
 *   벨트 위에 얼어붙는다. 실제 라인은 그렇지 않다 — 설비가 고장 나거나, 사람이
 *   없거나, 재료가 떨어져도 **컨베이어는 계속 돌고 위에 있던 것은 끝까지 간다.**
 *   비는 것은 벨트가 아니라 **벨트의 앞머리**다.
 *
 *   그래서 칸마다 "진짜 물건인가" 를 1비트로 들고 있는다(`fill`). 재료를 못 내면
 *   그 자리는 빈칸으로 지나가고, 뒤따르던 것들은 그대로 흘러 나간다. 칸은 벨트에
 *   올릴 수 있는 최대 개수만큼만 있으면 된다 — **방금 빠져나간 자리에 새것이
 *   들어오는** 고리 버퍼다.
 *
 *   벨트가 정말로 서는 것은 **보낼 곳이 없을 때뿐이다**(종점이 가득 참). 그때는
 *   `advanceBelt` 를 아예 부르지 않는다.
 * ---------------------------------------------------------------------------
 */

/** 한 벨트에 올릴 수 있는 최대 덩어리 수 — 짧은 간격으로 긴 벨트를 채울 때의 안전선 */
export const MAX_ITEMS = 60;

/** trav 가 이만큼 커지면 한 바퀴 단위로 빼서 되돌린다 (오래 돌려도 정밀도가 안 새도록) */
const TRAV_ROLL = 1e6;

const wrap = (i, n) => ((i % n) + n) % n;

/** 길이 L 인 벨트에 간격 step 으로 놓을 수 있는 칸 수 */
export function beltCount(length, step) {
  if (!(length > 0.01) || !(step > 0)) return 0;
  return Math.min(MAX_ITEMS, Math.floor(length / step) + 1);
}

/**
 * 벨트 한 줄의 상태.
 *  trav  흘러간 거리
 *  born  마지막으로 올라탄 덩어리 번호 (아직 없으면 −1)
 *  gone  마지막으로 끝에 닿은 덩어리 번호
 *  fill  칸마다 "진짜 물건인가" — 번호를 칸 수로 나눈 나머지가 곧 자리
 */
export function makeBelt(count) {
  const n = Math.max(0, count);
  return {
    trav: 0,
    born: -1,
    gone: -1,
    fill: new Uint8Array(n),
    /**
     * 칸마다 **무엇이 실려 있는가** (종류 이름. 빈칸이면 null).
     * -------------------------------------------------------------------------
     *  예전에는 벨트 한 줄에 한 종류만 흘렀다 — 설비가 한 가지만 만들었으니
     *  줄 전체에 이름표 하나면 됐다(`beltFlows` 의 `outKind`).
     *
     *  **품종 전환이 생기면서 달라졌다.** 같은 벨트 위에 제작품 1과 2가 앞뒤로
     *  실려 흐른다. 줄에 이름표 하나만 붙이면 **도착한 것이 엉뚱한 종류로**
     *  적치대에 쌓인다 — 벨트가 길수록 더 어긋난다(실린 시각과 닿는 시각의 차).
     */
    kinds: new Array(n).fill(null),
    /**
     * **끝에 쌓인 것** — 축적형 벨트에서만 자란다 (`link.accumulate`).
     * -------------------------------------------------------------------------
     *  보통 벨트는 종점이 막히면 **통째로 선다**(비축적). 실제 라인에는 그렇지
     *  않은 것이 많다 — 롤러가 물건 밑에서 계속 돌고 물건은 끝에서부터 밀려
     *  쌓인다. 그동안 상류는 **계속 실을 수 있다.** 그래서 축적형 벨트는
     *  그 자체가 버퍼다.
     *
     *  이 벨트 모델은 **칸이 고정된 고리**라 물건마다 자리가 없다 — 「앞차에
     *  막혀 선다」를 그릴 수가 없다. 대신 **끝에 쌓인 줄**로 센다. 쌓을 수
     *  있는 만큼(칸 수)까지 받고, 다 차면 그때 벨트가 선다.
     *
     *  종류를 그대로 들고 있어야 한다 — 갈래를 지나온 물건이 섞여 있고,
     *  적치대는 종류마다 자리가 다르다.
     */
    held: [],
    /** 칸마다 **몇 개** 실려 있는가 — 품종이 바뀌는 자리의 짧은 덩어리 때문 */
    counts: new Uint8Array(n),
    /** 이번 프레임에 끝에 닿은 것들 — `{ [종류]: 개수 }` */
    out: null,
  };
}

/**
 * 한 프레임만큼 굴린다.
 *
 * @param d        이번 프레임에 흘릴 거리 (속도 × 시뮬 시간)
 * @param step     덩어리 사이 간격
 * @param length   벨트 길이
 * @param feeding  앞 설비가 지금 내보낼 수 있는가. false 면 **빈칸만 흘러간다**
 * @param spawn    올라탈 개수를 넘기면 **실제로 만든 개수**를 돌려주는 함수
 *                 (재료를 내는 자리다. 없으면 달라는 대로 다 만든다 = 공급원)
 * @returns 이번 프레임에 끝에 닿은 **덩어리 수**
 */
export function advanceBelt(st, { d, step, length, feeding = true, spawn = null, kind = null }) {
  const n = st.fill.length;
  if (!n || !(d > 0) || !(step > 0)) return 0;
  const t = st.trav + d;

  /**
   * ① 끝에 닿은 것부터 **먼저** 읽는다.
   * -------------------------------------------------------------------------
   *  칸이 n 개뿐이라 방금 빠져나간 자리에 이번 프레임의 새 덩어리가 들어온다.
   *  순서를 바꾸면 도착한 물건이 새것에 덮여 조용히 사라진다.
   *
   *  덩어리 n 은 trav − n×간격 ≥ 길이 일 때 넘어간 것이다 → n ≤ (trav − 길이)/간격.
   *  몫의 차로 세므로 한 프레임에 여럿이 지나가도(빠른 벨트·높은 배속) 안 빠뜨린다.
   */
  let arrived = 0;
  let out = null;
  const gone = Math.floor((t - length) / step);
  if (gone > st.gone) {
    for (let k = Math.max(st.gone + 1, gone - n + 1); k <= gone; k++) {
      const c = wrap(k, n);
      if (st.fill[c]) {
        st.fill[c] = 0;
        arrived++;
        /* **무엇이 닿았는지**까지 센다 — 도착해서 쌓이는 종류가 이 값이다 */
        const kind = st.kinds[c] ?? null;
        if (kind) { out = out ?? {}; out[kind] = (out[kind] ?? 0) + (st.counts[c] || 1); }
        st.kinds[c] = null;
        st.counts[c] = 0;
      }
    }
    st.gone = gone;
  }

  /**
   * ② 새로 올라타는 것 — 못 내면 **빈칸**으로 지나간다.
   * -------------------------------------------------------------------------
   *  재료는 만드는 순간에 없어진다. 도착할 때 내면 재료가 없는 설비도 일단
   *  벨트를 채우고 나중에 값을 치르게 되어, 있지도 않은 재고를 끌어 쓴다.
   *
   *  한 프레임에 벨트를 통째로 지나갈 만큼 흘렀다면(아주 짧은 벨트 + 높은 배속)
   *  칸 수만큼만 만든다 — 못 세는 쪽으로 자른다. 없는 재료를 쓰는 것보다 낫다.
   */
  const born = Math.floor(t / step);
  const want = born - st.born;
  if (want > 0) {
    const make = Math.min(want, n);
    let paid = 0;
    /**
     * `spawn` 은 **몇 덩어리를 실었고 그것이 무엇인지**를 돌려준다.
     *  숫자만 돌려주던 옛 꼴도 받는다 — 그때는 줄의 이름표(`kind`)를 쓴다.
     */
    let bornKind = kind;
    let bornCount = 0;
    if (feeding) {
      if (spawn) {
        const got = spawn(make);
        if (got && typeof got === 'object') {
          paid = Math.max(0, Math.min(make, got.made ?? 0));
          bornKind = got.kind ?? kind;
          bornCount = Math.max(0, Math.round(got.count ?? 0));
        } else {
          paid = Math.max(0, Math.min(make, got ?? 0));
        }
      } else {
        paid = make;
      }
    }
    for (let i = 1; i <= make; i++) {
      const c = wrap(born - make + i, n);
      st.fill[c] = i <= paid ? 1 : 0;
      st.kinds[c] = i <= paid ? bornKind : null;
      st.counts[c] = i <= paid ? Math.min(255, bornCount) : 0;
    }
    st.born = born;
  }

  st.trav = t;

  /* trav 는 커지기만 한다. 한 바퀴(n칸) 단위로 빼면 파생값이 전부 그대로다 —
     번호도 자리도 n 의 배수만큼만 움직이므로 나머지가 안 바뀐다. */
  if (st.trav > TRAV_ROLL) {
    const back = Math.floor(st.trav / (n * step)) * n;
    st.trav -= back * step;
    st.born -= back;
    st.gone -= back;
  }

  st.out = out;
  return arrived;
}

/** 끝에 쌓여 있는 개수 — 축적형 벨트가 버퍼 노릇을 하는 만큼이다 */
export const beltHeld = (st) => st?.held?.length ?? 0;

/** 더 쌓을 수 있나 — 칸 수만큼 쌓으면 벨트가 다 찬 것이다 */
export const beltFull = (st) => beltHeld(st) >= (st?.fill?.length ?? 0);

/**
 * 쌓인 줄에 넣는다 — **벨트 길이만큼만.**
 *  넘치는 것은 안 받는다. 받아 버리면 벨트가 무한 버퍼가 되어, 종점이 막혀도
 *  라인이 영영 안 서는 거짓 그림이 된다.
 *  @returns 실제로 받은 개수
 */
export function holdOnBelt(st, kind, n) {
  const room = Math.max(0, (st?.fill?.length ?? 0) - beltHeld(st));
  const take = Math.max(0, Math.min(Math.round(n) || 0, room));
  for (let i = 0; i < take; i++) st.held.push(kind);
  return take;
}

/**
 * 쌓인 줄에서 **앞에서부터** 꺼낸다 — 먼저 쌓인 것이 먼저 내려간다.
 *  @returns { [종류]: 개수 } · 없으면 null
 */
export function takeHeld(st, n) {
  const take = Math.max(0, Math.min(Math.round(n) || 0, beltHeld(st)));
  if (!take) return null;
  const out = {};
  for (const k of st.held.splice(0, take)) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/** 줄의 앞머리 위치 — 칸 k 는 여기서 k×간격 만큼 더 간 자리에 있다 */
export const beltOffset = (st, step) => (step > 0 ? st.trav % step : 0);

/** 칸 k(0 = 방금 올라탄 것)에 진짜 물건이 있는가 */
export function beltHas(st, k) {
  const n = st.fill.length;
  if (!n || st.born < 0) return false;
  return st.fill[wrap(st.born - k, n)] === 1;
}

/** 칸 k 에 실린 종류 (빈칸이면 null) — 화면이 색을 칠할 때 본다 */
export function beltKind(st, k) {
  const n = st.fill.length;
  if (!n || st.born < 0) return null;
  return st.kinds[wrap(st.born - k, n)] ?? null;
}
