/* flow.js — 물류 동선. 운반 작업량 · 개당 거리 · 무거운 구간 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('물류 동선');

const F = await import(SRC + 'core/flow.js');
const M = await import(SRC + 'core/metrics.js');
const flowSrc = await readSrc('core/flow.js');
const inspector = await readSrc('ui/Inspector.jsx');
const dock = await readSrc('ui/RunDock.jsx');

/* ---------- 거리 ----------------------------------------------------------- */

t('닫힌 경로는 **가는 방향으로** 잰다 — 되짚어 가지 않는다', () => {
  assert.equal(F.arcBetween(2, 8, 20, true), 6);
  assert.equal(F.arcBetween(8, 2, 20, true), 14, '고리를 거꾸로 돌아갔다');
});

t('왕복(열린) 경로는 그냥 차이다 — 되짚어 오니까', () => {
  assert.equal(F.arcBetween(2, 8, 20, false), 6);
  assert.equal(F.arcBetween(8, 2, 20, false), 6);
});

/* ---------- 벨트 ----------------------------------------------------------- */

const BELT = (over = {}) => F.flowMatrix({
  rows: [{ uid: 'E1', mult: 2 }, { uid: 'E2', mult: 1 }],
  capacity: 10,                                            // 최종 10개/분
  placed: [{ uid: 'E1', name: '제작기 1' }, { uid: 'E2', name: '조립기 1' }],
  links: [{ uid: 'L1', from: { uid: 'E1' }, to: { uid: 'E2' } }],
  lengthOf: () => 12,
  ...over,
}, () => null);

t('**배수를 반영한다** — 최종 1개에 둘이 들면 그 구간은 두 배가 오간다', () => {
  const r = BELT()[0];
  /* 최종 10개/분 = 600개/시. 제작기의 배수가 2 이므로 1,200개/시가 지나간다 */
  assert.equal(r.perHour, 1200);
  assert.equal(r.meters, 12);
  assert.equal(r.work, 1200 * 12);
});

t('깔린 길이를 모르면 거리는 0 — 지어내지 않는다', () => {
  const r = F.flowMatrix({
    rows: [{ uid: 'E1', mult: 1 }], capacity: 10,
    placed: [{ uid: 'E1', name: 'A' }],
    links: [{ uid: 'L1', from: { uid: 'E1' }, to: { uid: 'E2' } }],
  }, () => null)[0];
  assert.equal(r.meters, 0);
  assert.equal(r.work, 0);
});

t('안 도는 라인은 구간도 없다 — 0개/시를 표에 올리면 자리만 먹는다', () => {
  assert.deepEqual(BELT({ capacity: 0 }), []);
});

/* ---------- 한 숫자로 ------------------------------------------------------ */

t('총 운반 작업량 = Σ(개/시 × m)', () => {
  assert.equal(F.totalWork(BELT()), 14400);
  assert.equal(F.totalWork([]), 0);
  assert.equal(F.totalWork(null), 0);
});

t('**개당 거리**가 진짜 지표다 — 총량은 라인이 빨라지기만 해도 커진다', () => {
  /* 같은 배치에서 라인만 두 배로 빨라지면 총량도 두 배가 된다.
     그걸로 배치를 견주면 「느리게 만들수록 좋은 배치」가 된다. */
  const slow = BELT({ capacity: 10 });
  const fast = BELT({ capacity: 20 });
  assert.ok(F.totalWork(fast) > F.totalWork(slow), '총량은 라인 속도를 탄다');
  /* 개당 거리는 안 흔들린다 — 배치가 같으니까 */
  assert.equal(F.metersPerUnit(slow, 10), F.metersPerUnit(fast, 20));
  assert.equal(F.metersPerUnit(slow, 10), 24, '최종 1개당 부품 2개 × 12m');
});

t('안 만드는 라인은 개당 거리가 없다 — 0 이 아니라 없는 것', () => {
  assert.equal(F.metersPerUnit(BELT(), 0), null);
});

t('무거운 순으로 준다 — 어디부터 붙일지가 목적이다', () => {
  const rows = F.flowMatrix({
    rows: [{ uid: 'A', mult: 1 }, { uid: 'B', mult: 1 }],
    capacity: 10,
    placed: [{ uid: 'A', name: 'A' }, { uid: 'B', name: 'B' }],
    links: [{ uid: 'L1', from: { uid: 'A' }, to: { uid: 'B' } },
            { uid: 'L2', from: { uid: 'B' }, to: { uid: 'A' } }],
    lengthOf: (l) => (l.uid === 'L1' ? 3 : 30),
  }, () => null);
  assert.equal(rows[0].uid, 'L2', '무거운 것이 위가 아니다');
  assert.equal(F.heaviest(rows, 1).length, 1);
});

/* ---------- 카트가 벨트와 같은 단위인가 ------------------------------------ */

t('카트도 **라인이 요구하는 만큼**만 나른다 — 능력을 그대로 쓰면 단위가 어긋난다', () => {
  /* 실제로 났던 일: 벨트 300개/시 옆에 카트 926개/시가 찍혔다. 카트 줄은
     「나를 수 있는 최대」였기 때문이다. 둘을 더한 총계는 아무 뜻이 없다. */
  const fn = cut(flowSrc, '/* ---- 카트 ----', '  out.sort(', '카트 구간');
  assert.match(fn, /Math\.min\(capacity \* \(multOf\.get\(c\.uid\) \?\? 1\), h\.perMinute\)/,
    '카트가 라인과 다른 단위로 센다');
});

t('빈 차로 돌아오는 구간은 안 센다 — 물건이 안 실려 있다', () => {
  assert.match(flowSrc, /빈 차로 돌아오는 구간/, '그 판단이 적혀 있지 않다');
  const fn = cut(flowSrc, '/* ---- 카트 ----', '  out.sort(', '카트 구간');
  assert.equal(/lapSec|path\.length \* /.test(fn), false, '한 바퀴 길이를 그대로 쓴다');
});

/* ---------- 리드타임 (리틀의 법칙) ----------------------------------------- */

t('재공 ÷ 처리량 = 리드타임', () => {
  /* 재공 40개 · 시간당 120개 → 한 개가 20분(1,200초) 걸려 나온다 */
  assert.equal(M.leadTimeSec(40, 120), 1200);
  assert.equal(M.leadTimeSec(0, 120), 0, '라인이 비면 0 이다');
});

t('아직 못 재면 **없는 것**이다 — 0 이라고 하면 「바로 나온다」로 읽힌다', () => {
  assert.equal(M.leadTimeSec(40, null), null, '처리량을 모르는데 답한다');
  assert.equal(M.leadTimeSec(40, 0), null, '0 으로 나누고 있다');
});

t('세 값이 서로 맞는다 — 리틀의 법칙이 성립해야 한다', () => {
  for (const [wip, perHour] of [[40, 120], [7, 900], [250, 60]]) {
    const lead = M.leadTimeSec(wip, perHour);
    /* 재공 = 처리량(개/초) × 리드타임(초) */
    assert.ok(Math.abs((perHour / 3600) * lead - wip) < 1e-9, `${wip} / ${perHour}`);
  }
});

/* ---------- 화면 배선 ------------------------------------------------------ */

t('도면 요약에 동선 칸이 있다 — 능력·원가와 나란히 보는 셋째 값', () => {
  assert.match(inspector, /import \{[^}]*flowMatrix[^}]*\} from '\.\.\/core\/flow\.js'/);
  const sum = cut(inspector, 'function Summary()', '<CrewPanel />', '도면 요약');
  assert.ok(sum.includes('<FlowSection />'), '요약에 동선이 없다');
  const sec = cut(inspector, 'function FlowSection()', '\nfunction ', '동선 칸');
  assert.ok(sec.includes('한 개가 지나는 거리'), '개당 거리를 안 보여 준다');
  assert.ok(sec.includes('metersPerUnit('), '개당 거리를 자기 나름대로 낸다');
});

t('벨트 길이는 **실제 깔린 길이**를 넘긴다 — 직선거리로 재면 짧게 나온다', () => {
  const sec = cut(inspector, 'function FlowSection()', '\nfunction ', '동선 칸');
  const line = sec.split(/\r?\n/).find((l) => /lengthOf:/.test(l));
  assert.ok(line, 'lengthOf 를 안 넘긴다');
  assert.match(line, /linkPath\(/, '경로를 안 풀고 길이를 짐작한다');
});

t('라인 능력과 **같은 근거**를 쓴다 — 두 칸이 다른 천장을 말하면 안 된다', () => {
  const sec = cut(inspector, 'function FlowSection()', '\nfunction ', '동선 칸');
  assert.ok(sec.includes('lineBalance('), '천장을 따로 계산한다');
  assert.match(sec, /capacity: bal\.capacity/, '동선이 딴 천장을 본다');
});

t('띠의 지표에 리드타임이 있다', () => {
  assert.match(dock, /import \{[^}]*leadTimeSec[^}]*\} from '\.\.\/core\/metrics\.js'/);
  const kpis = cut(dock, 'function Kpis(', '\n/**', '지표 칸');
  assert.ok(kpis.includes('리드타임'), '리드타임을 안 보여 준다');
  assert.ok(kpis.includes('flow.lead'), '값을 안 받는다');
  /* 못 잴 때 0 초라고 하면 「바로 나온다」로 읽힌다 */
  assert.ok(kpis.includes('측정 중'), '아직 못 잰다는 말이 없다');
});

/* ---------- 보고서에 실린다 ------------------------------------------------ */

const planSrc = await readSrc('core/planReport.js');
const P = await import(SRC + 'core/planReport.js');
const R = await import(SRC + 'core/report.js');
const RH = await import(SRC + 'core/reportHtml.js');

t('도면 보고서에 동선 절이 실린다', () => {
  const html = P.planReportHTML({
    at: '2026-08-18',
    flow: { rows: BELT(), per: 24, total: 14400 },
  });
  assert.ok(html.includes('물류 동선'), '동선 절이 없다');
  assert.ok(html.includes('제작기 1 → 조립기 1'), '구간을 안 적는다');
  assert.ok(/개당 거리/.test(html), '무엇으로 견주라는 말이 없다');
});

t('동선이 없으면 그 절을 통째로 뺀다 — 빈 표는 자리만 먹는다', () => {
  const html = P.planReportHTML({ at: '2026-08-18' });
  assert.equal(html.includes('물류 동선'), false);
});

t('도면 보고서 버튼이 **화면과 같은 계산**을 넘긴다', () => {
  const fn = cut(inspector, 'function PlanReportButton()', '\nfunction ', '도면 보고서 버튼');
  assert.ok(fn.includes('flowMatrix('), '동선을 안 넘긴다');
  const line = fn.split(/\r?\n/).find((l) => /lengthOf:/.test(l));
  assert.match(line ?? '', /linkPath\(/, '종이가 벨트 길이를 짐작한다');
});

t('실행 보고서 두 판에 리드타임이 **같이** 들어간다', () => {
  const d = { at: 'x', elapsedSec: 3600, ranSec: 3600, throughput: 120, wip: 40, leadSec: 1200 };
  const csv = R.runReportCSV(d);
  const row = csv.find((r) => String(r[0]).startsWith('리드타임'));
  assert.ok(row, 'CSV 에 리드타임이 없다');
  assert.equal(row[1], 1200);
  assert.ok(RH.runReportHTML(d).includes('리드타임'), 'HTML 에 리드타임이 없다');
});

t('못 잰 리드타임은 두 판 다 **빈칸/측정 중** — 0 이라고 하면 안 된다', () => {
  const d = { at: 'x', elapsedSec: 10, ranSec: 10, throughput: null, wip: 40, leadSec: null };
  const row = R.runReportCSV(d).find((r) => String(r[0]).startsWith('리드타임'));
  assert.equal(row[1], '', 'CSV 가 0 을 적는다');
  assert.ok(RH.runReportHTML(d).includes('측정 중'), 'HTML 이 0 초라고 한다');
});
