/**
 * 닿는가 — 오더가 **도울 수 없는 설비까지** 끌고 가지 않는지
 * ---------------------------------------------------------------------------
 *  디스패칭 규칙이 오더를 종류만으로 읽으면, 그 종류를 만드는 설비가 전부
 *  끌려간다 — 산출이 오더의 목적지에 닿든 말든. 적치대로 보내는 제작기와
 *  조립기로 보내는 제작기가 함께 끌려가 **조립기가 굶어 라인이 섰다.**
 *
 *  ── 이 파일의 방향 ───────────────────────────────────────────────────────
 *  **「모르면 닿는 것으로 본다」가 취향이 아니라 필수다.** 반대로 짜면 카트로만
 *  대는 멀쩡한 라인이 조용히 「차례대로」가 되는데, 그 실패는 **어떤 검사도 안
 *  터뜨린다.** 그래서 「덜 걸러낸다」를 값으로 못 박는다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('닿는가');

const R = await import(SRC + 'core/reach.js');
const O = await import(SRC + 'core/orders.js');

const lineupSrc = await readSrc('core/lineup.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const repSrc = await readSrc('core/replicate.js');

const belt = (from, to) => ({ uid: `L${from}${to ?? 'x'}`, from: { uid: from }, to: to ? { uid: to } : null });

/* ---------- 벨트를 따라간다 ----------------------------------------------- */

t('한 칸 건너도 닿는다 — 조립기를 거쳐 적치대로', () => {
  const r = R.reachOf({ links: [belt('M1', 'ASM'), belt('ASM', 'S1')] });
  assert.equal(r('M1', 'S1'), true);
  assert.equal(r('M1', 'ASM'), true);
});

t('**안 닿는 것은 안 닿는다** — 이것이 이 파일의 값이다', () => {
  /* M1 → 적치대 S1 · M2 → 조립기 → 적치대 S2 */
  const r = R.reachOf({ links: [belt('M1', 'S1'), belt('M2', 'ASM'), belt('ASM', 'S2')] });
  assert.equal(r('M1', 'S1'), true);
  assert.equal(r('M2', 'S1'), false, 'M2 는 S1 에 못 간다 — 그 오더가 M2 를 끌면 안 된다');
});

t('순환에서 멈춘다 — 도면은 고리를 이룰 수 있다', () => {
  const r = R.reachOf({ links: [belt('A', 'B'), belt('B', 'C'), belt('C', 'A')] });
  assert.equal(r('A', 'C'), true);
  assert.equal(r('A', '없는곳'), false);      // 안 멈추면 여기서 영영 돈다
});

/* ---------- 모르면 닿는 것으로 본다 ---------------------------------------- */

t('**카트가 있으면 전부 닿는 것으로 본다** — 카트 길은 안 따라간다', () => {
  /* 반대로 짜면 카트로만 대는 라인이 조용히 죽는다. 그 실패는 아무 검사도 안 터진다 */
  const r = R.reachOf({ links: [belt('M2', 'ASM')], carts: [{ uid: 'C1' }] });
  assert.equal(r('M2', 'S1'), true);
});

t('끝이 안 물린 벨트가 있는 설비는 닿는 것으로 본다', () => {
  const r = R.reachOf({ links: [belt('M2', null), belt('M1', 'S1')] });
  assert.equal(r('M2', 'S1'), true, '어디로 가는지 모르는데 걸러 냈다');
  assert.equal(r('M1', 'S9'), false, '아는 쪽까지 덩달아 풀어 주면 안 된다');
});

t('연결이 하나도 없으면 — 아직 안 이은 도면이다', () => {
  const r = R.reachOf({ links: [] });
  assert.equal(r('M1', 'S1'), false);
});

t('설비나 자리를 모르면 닿는 것으로 본다', () => {
  const r = R.reachOf({ links: [belt('M1', 'S1')] });
  assert.equal(r(null, 'S1'), true);
  assert.equal(r('M1', null), true);
  assert.equal(r('M1', 'M1'), true);
});

/* ---------- 오더가 그것을 읽는다 ------------------------------------------- */

const ORDER_S1 = [{ uid: 'O', kind: 'PART_G', qty: 1000, dueMin: 0, at: 'store', atUid: 'S1' }];

t('**안 닿는 설비는 그 오더를 안 본다**', () => {
  const reaches = R.reachOf({ links: [belt('M1', 'S1'), belt('M2', 'ASM'), belt('ASM', 'S2')] });
  const info = O.orderInfoOf(ORDER_S1, { reaches }, 0);
  assert.ok(info('M1')('PART_G'), 'M1 은 도울 수 있는데 안 본다');
  assert.equal(info('M2')('PART_G'), null, 'M2 가 도울 수 없는 오더에 끌려간다');
});

t('출하 오더는 **전부 해당한다** — 어디로 나가는지 도면이 말해 주지 않는다', () => {
  const reaches = R.reachOf({ links: [belt('M2', 'ASM')] });
  const ship = [{ uid: 'O', kind: 'PART_G', qty: 100, dueMin: 10, at: 'ship' }];
  assert.ok(O.orderInfoOf(ship, { reaches }, 0)('M2')('PART_G'));
});

t('판정 함수를 안 넘기면 **지금까지와 똑같다**', () => {
  /* 이미 그린 도면이 안 바뀌어야 한다 */
  const info = O.orderInfoOf(ORDER_S1, {}, 0);
  assert.ok(info('M2')('PART_G'));
  assert.ok(info('아무나')('PART_G'));
});

/* ---------- 배선 ------------------------------------------------------------ */

t('두 길이 다 판정 함수를 물고 간다', () => {
  assert.match(lineupSrc, /reaches: reachOf\(\{ links: d\.links, carts: d\.carts \}\)/, '헤드리스가 안 문다');
  assert.match(sceneSrc, /reachOf\(\{ links: state\.links, carts: state\.carts \}\)/, '화면이 안 문다');
  assert.match(repSrc, /reaches: d\.reaches/, 'replicate 가 안 넘긴다');
});

/* ---------- 없는 변수를 쓰지 않았는가 --------------------------------------- *
 *  `SimClock` 은 도면(`state`)을 안 받는 작은 컴포넌트다. 그런데 거기에
 *  `state.links` 를 쓰는 줄을 넣어 **배포된 앱이 통째로 죽었다** —
 *  「화면을 그리는 중 오류가 났습니다 · state is not defined」.
 *
 *  `vite build` 는 이것을 **안 잡는다.** 없는 식별자는 문법이 아니라 실행 때
 *  터지기 때문이다. 이 세션에서 그 사실을 적어 두고도 또 당했다. 그래서 값이
 *  아니라 **범위**를 못 박는다.
 * -------------------------------------------------------------------------- */

const simClock = (() => {
  const at = sceneSrc.indexOf('function SimClock(');
  assert.ok(at > 0, 'SimClock 을 못 찾았다 — 이름이 바뀌었으면 이 검사도 고칠 것');
  /* 다음 최상위 닫는 중괄호까지 */
  const end = sceneSrc.indexOf('\n}', at);
  return sceneSrc.slice(at, end);
})();

t('SimClock 은 **도면을 안 만진다** — 받지도 않은 것을 쓰면 앱이 통째로 죽는다', () => {
  assert.equal(/\bstate\./.test(simClock), false,
    'SimClock 안에서 state 를 쓴다 — 이 컴포넌트는 state 를 안 받는다');
});

t('닿는가 판정은 **부모가 만들어 내려보낸다**', () => {
  assert.match(simClock, /warmup, reaches \}/, 'SimClock 이 reaches 를 안 받는다');
  assert.match(sceneSrc, /reaches=\{reaches\}/, '부모가 안 내려보낸다');
  assert.match(sceneSrc, /const reaches = useMemo\(/, '부모가 안 만든다');
});
