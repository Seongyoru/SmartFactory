/**
 * =============================================================================
 *  인력 — 설비를 돌릴 사람이 있는가
 * =============================================================================
 *  지금까지 이 도면에서 설비는 **사람 없이** 돌았다. 그래서 답할 수 없는 질문이
 *  있었다 — *"몇 명이면 이 라인이 도는가"*, *"야간 인원을 반으로 줄이면 처리량이
 *  얼마나 빠지는가"*. 현장에서 배치 다음으로 많이 묻는 것이 이 둘이다.
 *
 *  ── 작업자는 걸어 다니지 않는다 ──────────────────────────────────────────
 *  사람을 움직이게 하려면 카트와 똑같은 경로 시스템이 하나 더 생기고, 사용자가
 *  통로를 그려야 하고, 걷는 속도·대기·추월을 전부 정해야 한다. 그렇게 만든 걷는
 *  시간은 **우리가 지어낸 숫자**지 도면에서 읽은 값이 아니다.
 *
 *  알고 싶은 것은 "그 사람이 어느 길로 걷는가" 가 아니라 "몇 명이면 도는가" 다.
 *  그래서 사람을 **설비에 붙는 자원**으로 둔다 — 인원이 모자라면 그 설비가 서고,
 *  그 사실이 곧 답이다. 지어낸 숫자가 하나도 안 들어간다.
 *
 *      placed.crew   이 설비를 돌리는 데 필요한 인원 (0 = 무인 설비)
 *      state.shifts  교대조 — [{ name, hours, headcount }]
 *
 *  ── 모자라면 누가 먼저 받는가 ────────────────────────────────────────────
 *  **배치한 순서대로** 배정한다. 처리량이 큰 순서나 병목 순서로 주고 싶은 마음이
 *  들지만, 병목은 돌려 봐야 아는 값이라 그걸로 배정하면 배정이 매 프레임 흔들리고
 *  (사람이 이 설비 저 설비로 튄다) 같은 도면을 두 번 돌려도 결과가 달라진다.
 *  배치 순서는 **도면에 이미 적혀 있는 순서**라 늘 같은 답이 나오고, 인스펙터에서
 *  몇 번째인지 그대로 읽을 수 있다.
 * ---------------------------------------------------------------------------
 */

/** 교대조를 안 정했을 때 — 하루 한 조, 인원 제한 없음 */
export const DEFAULT_SHIFT = { name: '상시', hours: 24, headcount: 0 };

/** 인원 0 = **제한 없음**. "사람이 없다" 가 아니라 "인력을 안 따진다" 는 뜻이다 */
export const UNLIMITED = 0;

/** 인스펙터 슬라이더 범위 */
export const CREW_RANGE = [0, 8, 1];          // 설비 한 대에 붙는 인원
export const HEADCOUNT_RANGE = [0, 60, 1];    // 한 조의 총원
export const HOURS_RANGE = [1, 24, 1];        // 한 조의 길이(시간)

/** 이 설비에 필요한 인원 */
export const crewOf = (placed) => Math.max(0, Math.round(placed?.crew ?? 0));

/**
 * 사람을 붙일 수 있는 물건인가.
 *  선반과 적치대는 자재가 쌓이는 자리지 누가 지키는 곳이 아니다.
 *  **씬과 인스펙터가 같은 답을 내야 하므로** 판정을 여기 한 곳에 둔다.
 */
export const isWorkable = (item) => !!item && item.kind !== 'shelf' && item.kind !== 'stillage';

/* --------------------------------------------------------------------------
 * 교대
 * ------------------------------------------------------------------------ */

/**
 * 저장된 교대표를 믿을 수 있는 모양으로.
 *  비어 있으면 「상시」 한 조 — 이미 그린 도면이 인력 때문에 갑자기 서면 안 된다.
 */
export function normalizeShifts(list) {
  const rows = (Array.isArray(list) ? list : [])
    .map((s, i) => ({
      name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim() : `${i + 1}조`,
      hours: Math.min(24, Math.max(1, Math.round(Number(s?.hours) || 0) || 8)),
      headcount: Math.max(0, Math.round(Number(s?.headcount) || 0)),
    }));
  return rows.length ? rows : [{ ...DEFAULT_SHIFT }];
}

/** 한 바퀴(전체 교대를 다 도는 데 걸리는) 시간(초) */
export const cycleSeconds = (shifts) =>
  normalizeShifts(shifts).reduce((s, r) => s + r.hours * 3600, 0);

/**
 * 시뮬 시간이 이만큼 흘렀을 때 **지금 몇 조인가**.
 *  교대표를 처음부터 되풀이한다 — 하루가 끝나면 다시 첫 조다.
 *  @returns { index, shift, endsIn } · endsIn 은 이 조가 끝나기까지 남은 초
 */
export function shiftAt(shifts, elapsed) {
  const rows = normalizeShifts(shifts);
  const total = rows.reduce((s, r) => s + r.hours * 3600, 0);
  if (!(total > 0)) return { index: 0, shift: rows[0], endsIn: Infinity };

  let t = ((elapsed % total) + total) % total;
  for (let i = 0; i < rows.length; i++) {
    const len = rows[i].hours * 3600;
    if (t < len) return { index: i, shift: rows[i], endsIn: len - t };
    t -= len;
  }
  /* 부동소수 오차로 여기 올 수 있다 — 마지막 조로 본다 */
  const last = rows.length - 1;
  return { index: last, shift: rows[last], endsIn: 0 };
}

/* --------------------------------------------------------------------------
 * 배정
 * ------------------------------------------------------------------------ */

/**
 * 있는 사람을 설비에 나눠 준다.
 * ---------------------------------------------------------------------------
 *  **부분 배정은 없다.** 두 명이 필요한 설비에 한 명만 붙이면 그 한 명은 아무것도
 *  못 하면서 다른 설비도 못 돌린다 — 사람만 묶어 놓고 라인은 그대로 서 있는,
 *  실제로도 하면 안 되는 배정이다. 채울 수 있으면 통째로 채우고, 못 채우면
 *  건너뛰어 **다음 설비가 그 사람을 쓴다.**
 *
 *  @param list      [{ uid, need }] — 배치 순서대로
 *  @param headcount 이번 조의 총원 (0 = 제한 없음)
 *  @returns { manned:Set<uid>, unmanned:Set<uid>, used, idle, need }
 */
export function assignCrew(list, headcount) {
  const manned = new Set();
  const unmanned = new Set();
  const rows = list ?? [];
  const need = rows.reduce((s, r) => s + Math.max(0, r.need ?? 0), 0);

  /* 인원을 안 따지는 도면 — 전부 사람이 붙은 것으로 본다 */
  if (!(headcount > 0)) {
    for (const r of rows) manned.add(r.uid);
    return { manned, unmanned, used: need, idle: 0, need, unlimited: true };
  }

  let left = headcount;
  for (const r of rows) {
    const n = Math.max(0, r.need ?? 0);
    if (n === 0) { manned.add(r.uid); continue; }   // 무인 설비는 사람을 안 쓴다
    if (n <= left) { left -= n; manned.add(r.uid); }
    else unmanned.add(r.uid);
  }
  return { manned, unmanned, used: headcount - left, idle: left, need, unlimited: false };
}

/**
 * 사람을 붙일 수 있는 설비들 — **배치 순서 그대로**.
 * ---------------------------------------------------------------------------
 *  씬과 인스펙터가 각자 목록을 만들면 언젠가 서로 다른 말을 한다("화면에는 사람이
 *  서 있는데 인스펙터는 사람이 없다고 한다"). 누가 배정 대상인지, 순서가 어떤지를
 *  여기 한 곳에서만 정한다.
 *
 *  @param isWorkable 선반·적치대처럼 사람이 지키지 않는 것을 걸러 내는 판정
 */
export const crewRows = (placedList, isWorkable) =>
  (placedList ?? []).filter((p) => isWorkable(p)).map((p) => ({ uid: p.uid, need: crewOf(p) }));

/**
 * 이 도면이 한 조에 필요로 하는 총원.
 *  「인원을 몇 명 잡아야 하는가」 의 답이라 인스펙터가 그대로 보여 준다.
 */
export const totalCrewNeed = (placedList, isWorkable) =>
  crewRows(placedList, isWorkable).reduce((s, r) => s + r.need, 0);
