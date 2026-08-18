/**
 * 실행 보고서 — 한 번 돌린 결과를 한 장으로.
 *  이 파일이 지키는 것: **보고서가 화면과 다른 숫자를 말하지 않는다.** 그래서
 *  report.js 는 아무것도 다시 계산하지 않고 받은 값을 줄로 옮기기만 한다 —
 *  여기서는 그 「옮기기」 가 틀리지 않는지를 본다(빠진 칸 · 어긋난 열 · 깨진 인용).
 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('실행 보고서');

const R = await import(SRC + 'core/report.js');
const O = await import(SRC + 'core/orders.js');
const M = await import(SRC + 'core/metrics.js');

const FULL = {
  at: '2026-08-13 14:30',
  elapsedSec: 3725,
  ranSec: 3600,
  throughput: 412.5,
  wip: 240,
  oee: { availability: 0.92, performance: 0.81, quality: 1, oee: 0.7452 },
  diagnosis: '제작기 #1 → 적치대 #1 (200/200 가득) → 빼가는 것 (없습니다)',
  culprit: '빼가는 것',
  orders: [
    {
      kind: 'ASM_Y', kindName: '조립품 2', qty: 500, done: 320, ratio: 0.64,
      atLabel: '출하', dueMin: 480, eta: 3600, slackSec: -900, state: O.ORDER.LATE,
    },
    {
      kind: 'PART_R', kindName: '제작품 1', qty: 300, done: 300, ratio: 1,
      atLabel: '선반 #1 통과', dueMin: 0, eta: 0, slackSec: null, state: O.ORDER.DONE,
    },
  ],
  shipped: [['조립품 2', 320], ['제작품 1', 40]],
  machines: [
    { name: '제작기 #1', cycleSec: 0.5, rate: 120, uptime: 0.18, blockSec: 2950, starveSec: 0, crewSec: 0, downSec: 0, oee: 0.18 },
  ],
  carts: [{ name: '카트 #1', kindName: '카트', count: 3, perMinute: 415.4, blockRatio: 0.12 }],
  stores: [{ name: '적치대 #1', have: 200, cap: 200, arrivedTotal: 214, arrived: { PART_R: 214 } }],
  series: [{ t: 0, shipped: 0 }, { t: 60.5, shipped: 12 }],
};

const csv = R.runReportCSV(FULL);
const flat = csv.map((r) => r.join('|'));
const find = (pre) => flat.find((l) => l.startsWith(pre));
const section = (title) => flat.findIndex((l) => l === `■ ${title}`);

/* ---------- 뼈대 ---------- */
t('구획이 전부 있다', () => {
  for (const s of ['진단', '생산 오더', '출하 누계', '설비', '차량', '적치대 · 선반', '생산 추이']) {
    assert.ok(section(s) >= 0, `「${s}」 구획이 없다`);
  }
});
t('구획 앞에는 빈 줄이 있다 — 엑셀에서 표가 붙어 버리지 않게', () => {
  const i = section('생산 오더');
  assert.equal(csv[i - 1].length, 0, '구획 바로 위가 빈 줄이 아니다');
});
t('맨 위는 요약이다', () => {
  assert.equal(csv[0][0], 'EGIS Smart Factory — 실행 보고서');
  assert.ok(find('시뮬 경과|1시간 2분 5초'), `경과가 이상하다: ${find('시뮬 경과')}`);
  assert.ok(find('처리량(개/시간)|412.5'));
  assert.ok(find('재공(개)|240'));
});
t('OEE 는 백분율로 적는다', () => {
  assert.ok(find('가동률 A(%)|92.0'));
  assert.ok(find('OEE(%)|74.5'));
});

/* ---------- 오더 ---------- */
t('오더 표의 열 수가 머리글과 맞는다', () => {
  const i = section('생산 오더');
  const cols = csv[i + 1].length;
  assert.equal(csv[i + 2].length, cols, '늦은 오더 줄의 칸 수가 다르다');
  assert.equal(csv[i + 3].length, cols, '완료된 오더 줄의 칸 수가 다르다');
});
t('늦는 오더는 초과분에 **음수 부호**가 붙는다', () => {
  const late = flat.find((l) => l.startsWith('조립품 2|500|320'));
  assert.ok(late.includes('-15분'), `초과 표기가 이상하다: ${late}`);
  assert.ok(late.endsWith('납기 초과 예상'));
});
t('납기가 없으면 그 칸은 비운다 — 0 을 적으면 「0분」 으로 읽힌다', () => {
  const done = flat.find((l) => l.startsWith('제작품 1|300|300'));
  assert.ok(done.includes('||'), `납기 칸이 안 비었다: ${done}`);
  assert.ok(done.endsWith('완료'));
});
t('오더가 없으면 그렇게 적는다 (빈 표를 안 남긴다)', () => {
  const r = R.runReportCSV({ ...FULL, orders: [] });
  const f = r.map((x) => x.join('|'));
  assert.ok(f.includes('(오더 없음)'));
});

/* ---------- 나머지 표 ---------- */
t('설비 줄 — 잃은 시간을 이유별로 나눠 적는다', () => {
  const m = flat.find((l) => l.startsWith('제작기 #1|'));
  assert.deepEqual(m.split('|'), ['제작기 #1', '0.5', '120.0', '18.0', '2950', '0', '0', '0', '18.0']);
});
t('차량 줄 — 수송 능력이 들어간다', () => {
  assert.ok(find('카트 #1|카트|3|415.4|12.0'));
});
t('쌓이는 곳 — 현재고와 **거쳐 간 누계**를 함께', () => {
  const s = flat.find((l) => l.startsWith('적치대 #1|'));
  assert.ok(s.includes('|200|200|214|'), `현재고/수용량/누계가 이상하다: ${s}`);
  assert.ok(s.endsWith('PART_R 214'));
});
t('생산 추이가 뒤에 붙는다', () => {
  const i = section('생산 추이');
  assert.deepEqual(csv[i + 1], ['시뮬 시간(초)', '누적 출하(개)']);
  assert.deepEqual(csv[i + 2], ['0.0', 0]);
});
t('추이가 없으면 그 구획을 안 만든다', () => {
  const r = R.runReportCSV({ ...FULL, series: [] });
  assert.equal(r.map((x) => x.join('|')).findIndex((l) => l === '■ 생산 추이'), -1);
});

/* ---------- 값이 없어도 안 터진다 ---------- */
t('아무것도 안 넘겨도 보고서가 나온다', () => {
  const r = R.runReportCSV();
  assert.ok(r.length > 5);
  assert.equal(r[0][0], 'EGIS Smart Factory — 실행 보고서');
});
t('측정 전이면 처리량을 숫자로 적지 않는다', () => {
  const r = R.runReportCSV({ throughput: null });
  assert.ok(r.map((x) => x.join('|')).includes('처리량(개/시간)|측정 중'));
});

/* ---------- 경과 시간 표기 ---------- */
t('경과 시간 — 시/분/초', () => {
  assert.equal(R.hms(45), '45초');
  assert.equal(R.hms(125), '2분 5초');
  assert.equal(R.hms(3725), '1시간 2분 5초');
  assert.equal(R.hms(null), '0초');
});

/* ---------- CSV 로 나갔을 때 깨지지 않는가 ---------- */
t('쉼표·따옴표가 든 이름도 한 칸으로 남는다', () => {
  /* 원인 사슬에는 쉼표가 자주 들어간다 — 그대로 흘리면 열이 밀린다 */
  const r = R.runReportCSV({ ...FULL, diagnosis: '제작기, "A" → 적치대' });
  const line = r.find((x) => x[0] === '원인 사슬');
  assert.equal(line.length, 2, '사슬이 여러 칸으로 쪼개졌다');
  assert.equal(line[1], '제작기, "A" → 적치대');
});

/* ---------- 화면의 조립 함수를 **소스에서 떼어** 실제로 돌린다 ---------------
     `vite build` 는 문법만 본다 — 정의되지 않은 식별자는 안 잡힌다. 그런데 이
     함수는 20개가 넘는 이름을 다른 모듈에서 끌어다 쓴다. 하나만 빠뜨려도 버튼을
     누르는 순간에야 터지는데, 그 버튼은 시뮬을 한참 돌린 뒤에만 보인다.
--------------------------------------------------------------------------- */
const src = await readSrc('ui/Inspector.jsx');
/* buildReport 는 **값만** 모은다(CSV 판·HTML 판이 그 하나를 나눠 쓴다).
   그래서 여기서도 값을 받아 두 판에 각각 태운다 — 한 번의 추출로 셋을 본다. */
const body = `${cut(src, 'const buildReport = () => {', '      series,')}\n    };\n  };\n  return buildReport();`;

const ARGS = [
  'state', 'itemOf', 'elapsed', 'ran', 'overall', 'series',
  'getShipped', 'getAllStock', 'normalizeOrders', 'getSpec', 'shippedTotal', 'throughput', 'leadTimeSec',
  'isShelf', 'isStillage', 'isUtility', 'isTruck', 'PAYLOAD_ITEMS',
  'cycleOf', 'perMinute', 'oeeOf', 'uptimeOf', 'cartBlockRatio',
  'cartPath', 'cartStations', 'haulPerMinute',
  'arrivedAt', 'arrivedOf', 'storeCapOf', 'bottleneck', 'blockChain', 'chainText',
  'statusOf', 'DONE_AT', 'runReportCSV',
];
const build = new Function(...ARGS, body);

const STATE = {
  placed: [
    { uid: 'M', itemId: 'MACHINE_1', name: '제작기 #1', pos: [0, 0] },
    { uid: 'S', itemId: 'STILLAGE', name: '적치대 #1', pos: [8, 0] },
  ],
  links: [], carts: [{ uid: 'K', itemId: 'CART', name: '카트 #1', count: 2, points: [[0, 0], [4, 0]] }],
  orders: [{ kind: 'PART_R', qty: 100, dueMin: 10, at: 'ship' }],
};
const ITEMS = { MACHINE_1: { id: 'MACHINE_1' }, STILLAGE: { id: 'STILLAGE', kind: 'stillage' }, CART: { id: 'CART' } };

const payload = () => build(
  STATE, (id) => ITEMS[id] ?? null, 600, 600,
  { availability: 0.9, performance: 0.8, quality: 1, oee: 0.72 },
  [{ t: 0, shipped: 0 }],
  () => ({ PART_R: 40 }), () => ({ S: 12 }), O.normalizeOrders, () => null,
  (m) => Object.values(m ?? {}).reduce((s, n) => s + n, 0), () => 240,
  /* 리틀의 법칙 — 진짜 함수를 넣는다. 흉내 내면 보고서와 화면이 갈릴 수 있다 */
  M.leadTimeSec,
  (it) => it?.kind === 'shelf', (it) => it?.kind === 'stillage', () => false, () => false,
  { PART_R: { name: '제작품 1' } },
  () => 6, (s) => 60 / s,
  () => ({ blockSec: 10, starveSec: 2, crewSec: 0, downSec: 0, oee: 0.7 }),
  () => 0.8, () => 0.1,
  () => ({ length: 8, at: () => ({ pos: [0, 0, 0], tan: [0, 1] }) }),
  () => [], () => ({ perMinute: 120 }),
  () => ({ PART_R: 214 }), () => 40, () => 200,
  () => ({ uid: 'M', ratio: 0.5 }),
  () => ({ steps: [{ name: '제작기 #1' }, { name: '적치대 #1' }], culprit: { name: '적치대 #1' } }),
  (steps) => steps.map((s) => s.name).join(' → '),
  O.statusOf, O.DONE_AT, R.runReportCSV,
);
const run = () => R.runReportCSV(payload());

t('화면의 조립 함수가 실제로 돈다 — 빠진 이름이 없다', () => {
  const rows = run();
  assert.ok(Array.isArray(rows) && rows.length > 10, '보고서가 안 나왔다');
  assert.equal(rows[0][0], 'EGIS Smart Factory — 실행 보고서');
});
t('화면 값을 그대로 옮긴다 — 다시 계산하지 않는다', () => {
  const f = run().map((r) => r.join('|'));
  assert.ok(f.includes('재공(개)|12'), '재공은 쌓인 것의 합이다');
  assert.ok(f.includes('처리량(개/시간)|240.0'), '처리량이 안 실렸다');
  assert.ok(f.includes('OEE(%)|72.0'), 'OEE 가 안 실렸다');
  assert.ok(f.some((l) => l.startsWith('원인 사슬|제작기 #1 → 적치대 #1')), '진단이 안 실렸다');
  assert.ok(f.some((l) => l.startsWith('제작기 #1|6.0|10.0|')), '설비 줄이 이상하다');
  assert.ok(f.some((l) => l.startsWith('카트 #1|카트|2|120.0|10.0')), '차량 줄이 이상하다');
  assert.ok(f.some((l) => l.startsWith('적치대 #1|12|200|214|')), '쌓이는 곳 줄이 이상하다');
});
t('오더도 실린다 — 완료 지점 이름까지', () => {
  const f = run().map((r) => r.join('|'));
  assert.ok(f.some((l) => l.startsWith('제작품 1|100|40|40.0|출하|10|')), '오더 줄이 이상하다');
});

/* ---------- 읽는 판(HTML) — CSV 와 **같은 값**에서 나온다 ------------------ */

const H = await import(SRC + 'core/reportHtml.js');

const SAMPLE = {
  at: '2026-08-13 17:00',
  elapsedSec: 3600, ranSec: 3600, throughput: 120.5, wip: 42,
  oee: { oee: 0.78, availability: 0.98, performance: 0.81, quality: 0.985 },
  diagnosis: '조립기1 막힘 ← 적치대1 가득(200/200)',
  culprit: '적치대1',
  orders: [{ kind: 'A', kindName: '조립품 1', qty: 100, done: 40, ratio: 0.4, atLabel: '출하', dueMin: 30, eta: 900, slackSec: -60, state: 'late' }],
  shipped: [['조립품 1', 40]],
  machines: [{ name: '제작기1', cycleSec: 3, rate: 20, uptime: 0.83, blockSec: 600, starveSec: 0, crewSec: 0, downSec: 0, oee: 0.79 }],
  carts: [{ name: '경로1', kindName: '카트', count: 3, perMinute: 415, blockRatio: 0.06 }],
  stores: [{ name: '적치대1', have: 200, cap: 200, arrivedTotal: 900, arrived: { A: 900 } }],
  series: [{ t: 0, shipped: 0 }, { t: 10, shipped: 5 }, { t: 20, shipped: 14 }],
};

t('한 파일로 닫힌다 — 바깥 것을 하나도 안 부른다', () => {
  /* 메일에 붙이든 USB 에 담든 그 파일만 있으면 열려야 한다. 바깥 것을 하나라도
     불러오면 받은 사람 화면에서 깨지고, 깨진 보고서는 안 만든 것만 못하다. */
  const html = H.runReportHTML(SAMPLE);
  assert.equal(/(?:src|href)\s*=\s*["']https?:/.test(html), false, '바깥 자원을 부른다');
  assert.equal(/<script/i.test(html), false, '스크립트가 들어 있다 — 열리지 않는 곳이 생긴다');
  assert.ok(html.includes('<style>'), 'CSS 를 안에 안 넣었다');
  assert.ok(html.startsWith('<!doctype html>'), '문서 선언이 없다');
});
t('설비 이름에 태그를 적어도 문서가 안 무너진다', () => {
  /* 이름은 사용자가 적는다. 막지 않으면 보고서 구조가 통째로 깨진다. */
  const html = H.runReportHTML({
    ...SAMPLE,
    machines: [{ ...SAMPLE.machines[0], name: '<img src=x onerror=alert(1)>제작기' }],
  });
  assert.equal(html.includes('<img'), false, '태그가 그대로 들어갔다');
  assert.ok(html.includes('&lt;img'), '막고 나서 글자로는 보여야 한다');
});
t('빈 구획은 **없다고 말한다** — 빈 표는 고장처럼 보인다', () => {
  const html = H.runReportHTML({ at: '지금' });
  assert.ok(html.includes('걸어 둔 오더가 없습니다'), '오더가 없을 때 말이 없다');
  assert.ok(html.includes('설비가 없습니다'), '설비가 없을 때 말이 없다');
});
t('CSV 와 **같은 값**을 받는다 — 두 파일이 다른 숫자를 말하면 안 된다', () => {
  /* 같은 d 를 넣고 둘 다 만들어, 사람이 확인할 만한 값이 양쪽에 다 있는지 본다 */
  const html = H.runReportHTML(SAMPLE);
  const csv = R.runReportCSV(SAMPLE).map((r) => r.join(',')).join('\n');
  for (const [what, inHtml, inCsv] of [
    ['진단', SAMPLE.diagnosis, SAMPLE.diagnosis],
    ['설비 이름', '제작기1', '제작기1'],
    ['저장소 이름', '적치대1', '적치대1'],
  ]) {
    assert.ok(html.includes(inHtml), `HTML 에 ${what} 가 없다`);
    assert.ok(csv.includes(inCsv), `CSV 에 ${what} 가 없다`);
  }
});
t('원가를 넣으면 원가 구획이 붙고, 없으면 통째로 빠진다', () => {
  const bare = H.runReportHTML(SAMPLE);
  assert.equal(bare.includes('<h2>원가</h2>'), false, '원가 없이도 빈 구획이 생긴다');
  const withCost = H.runReportHTML({
    ...SAMPLE,
    cost: { per: 12, total: 1000, perHour: 1000, idleBurn: 100, stopShare: 0.2, scrapWon: 0, kwh: 7, manHours: 1, parts: [{ key: 'power', label: '설비 전력', won: 1000 }], rates: { power: 130, wage: 12000, cartKw: 0.4, material: 0 } },
  });
  assert.ok(withCost.includes('<h2>원가</h2>'), '원가 구획이 없다');
  assert.ok(withCost.includes('설비 전력'), '항목이 없다');
});
t('인쇄 규칙이 들어 있다 — Ctrl+P 가 곧 PDF 다', () => {
  const html = H.runReportHTML(SAMPLE);
  assert.ok(html.includes('@media print'), '인쇄 규칙이 없다');
  assert.ok(html.includes('@page'), '여백 규칙이 없다');
  assert.ok(/break-inside\s*:\s*avoid/.test(html), '표가 장 사이에서 잘린다');
});

/* ---------- 배선 — 버튼 둘이 **한 값**에서 나온다 -------------------------- */

const inspectorSrc = await readSrc('ui/Inspector.jsx');

t('보고서와 CSV 가 `buildReport()` 하나를 나눠 쓴다', () => {
  assert.ok(/const d = buildReport\(\)/.test(inspectorSrc), '값을 한 번만 모으지 않는다');
  assert.ok(inspectorSrc.includes('runReportHTML(d)'), 'HTML 판이 그 값을 안 쓴다');
  assert.ok(inspectorSrc.includes('runReportCSV(d)'), 'CSV 판이 그 값을 안 쓴다');
  /* buildReport 가 CSV 를 직접 만들어 버리면 HTML 이 값을 못 받는다 */
  assert.equal(/return runReportCSV\(\{/.test(inspectorSrc), false, 'buildReport 가 CSV 로 굳어 있다');
});
t('내려받는 길이 둘 다 있다', () => {
  assert.ok(/downloadHTML\(runReportHTML\(d\), `실행보고서-\$\{stamp\(\)\}\.html`\)/.test(inspectorSrc), 'HTML 을 못 받는다');
  assert.ok(/downloadCSV\(runReportCSV\(d\), `실행보고서-\$\{stamp\(\)\}\.csv`\)/.test(inspectorSrc), 'CSV 를 못 받는다');
});
