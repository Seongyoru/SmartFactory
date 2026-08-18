/* planReport.js — 안 돌려도 나오는 한 장. 평면도 번호 · 축척 · 가정 명시 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('도면 보고서');

const { planReportHTML, PLAN_W, PLAN_H } = await import(SRC + 'core/planReport.js');
const { layoutThumbSVG, layoutBounds } = await import(SRC + 'core/thumb.js');
const { layoutInfo } = await import(SRC + 'core/layoutInfo.js');

/** 20×20 바닥에 설비 둘, 벨트 하나 */
const LAYOUT = {
  areas: [{ uid: 'A1', mp: [[[[0, 0], [20, 0], [20, 20], [0, 20]]]] }],
  placed: [
    { uid: 'E1', itemId: 'M', name: '제작기 1', pos: [5, 10] },
    { uid: 'E2', itemId: 'M', name: '제작기 2', pos: [15, 10] },
  ],
  links: [{ uid: 'L1', itemId: 'C', name: '컨베이어 #1', from: { uid: 'E1' }, to: { uid: 'E2' } }],
  carts: [], walls: [], pillars: [], zones: [], openings: [],
  shifts: [{ name: '상시', minutes: 480, headcount: 3 }],
  orders: [], rates: {}, beltSpeed: 0.6,
};
const ITEM = { id: 'M', name: '제작기', kind: 'machine' };
const itemOf = (id) => (id === 'M' ? ITEM : null);

const ROWS = [
  { uid: 'E1', name: '제작기 1', kind: 'equip', own: 3, mult: 1, capacity: 3 },
  { uid: 'E2', name: '제작기 2', kind: 'equip', own: 10, mult: 1, capacity: 10 },
];

const HTML = planReportHTML({
  at: '2026-08-18',
  layout: LAYOUT,
  info: layoutInfo(LAYOUT, itemOf),
  rows: ROWS,
  capacity: 3,
  nameOf: (p) => itemOf(p.itemId)?.name ?? '',
});

/* ---------- 한 장이 온전히 서는가 ---------------------------------------- */

t('스스로 서는 문서다 — 바깥을 하나도 안 부른다', () => {
  /* 파일로 떨궈 브라우저로 여는 것이라, 스크립트나 바깥 주소가 있으면
     그 자리에서 깨지거나(오프라인) 남의 서버에 흔적을 남긴다 */
  assert.match(HTML, /^<!doctype html>/);
  assert.equal(/<script/i.test(HTML), false, '스크립트가 들어 있다');
  /* SVG 의 xmlns 는 이름표지 주소가 아니다 — 아무것도 안 받아 온다.
     걸러야 하는 것은 **가져오는** 것들이다 */
  assert.equal(/(?:src|href)\s*=\s*["']?https?:/i.test(HTML), false, '바깥에서 무언가를 받아 온다');
  assert.equal(/@import|url\(\s*["']?https?:/i.test(HTML), false, '바깥 스타일·글꼴을 받아 온다');
  assert.ok(HTML.includes('<style>'), '스타일이 딸려 있지 않다');
});

t('실행 보고서와 **같은 옷**을 입는다 — 한 도구가 낸 두 장이다', () => {
  const plan = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  assert.ok(plan.includes('.card .v'), '보고서 공용 CSS 를 안 쓴다');
  assert.ok(plan.includes('.plan svg'), '평면도 전용 CSS 가 빠졌다');
});

t('돌려야 나오는 것은 **안 적는다** — 처리량·OEE 는 여기 있으면 거짓말', () => {
  for (const word of ['OEE', '처리량', '재공']) {
    assert.equal(HTML.includes(word), false, `안 돌렸는데 「${word}」 를 적는다`);
  }
});

t('「돌린 값이 아니다」 를 문서 안에 적는다', () => {
  /* 종이에 적힌 숫자는 혼자 걸어 다닌다. 가정이 문서 밖에 있으면
     언젠가 「실제로 이만큼 나왔다」 로 읽힌다 */
  assert.ok(HTML.includes('돌린 값이 아닙니다'), '가정을 안 적는다');
  assert.ok(HTML.includes('실행 보고서'), '잰 값이 어디 있는지 안 알려 준다');
});

t('사람이 적은 글자가 그대로 태그가 되지 않는다', () => {
  const bad = planReportHTML({
    name: '<img src=x onerror=alert(1)>',
    note: '설명 & "따옴표"',
    layout: LAYOUT, info: layoutInfo(LAYOUT, itemOf), rows: [],
  });
  assert.equal(/<img/.test(bad), false, '이름이 태그로 새어 나간다');
  assert.ok(bad.includes('&lt;img'));
  assert.ok(bad.includes('&amp;'));
});

t('이름이 없으면 「이름 없는 도면」이 아니라 문서 제목을 쓴다', () => {
  /* 이 앱은 도면에 이름을 안 붙인다(올릴 때만 받는다). 없는 것을 없다고
     크게 적어 봐야 읽는 사람에게 쓸모가 없다 */
  assert.ok(HTML.includes('<h1>도면 보고서</h1>'));
  assert.equal(HTML.includes('이름 없는 도면'), false);
  const named = planReportHTML({ name: '3라인 개편안', layout: LAYOUT, rows: [] });
  assert.ok(named.includes('<h1>3라인 개편안</h1>'));
  assert.ok(named.includes('<title>도면 보고서 — 3라인 개편안</title>'));
});

/* ---------- 그림과 표가 서로를 가리키는가 -------------------------------- */

t('평면도에 **번호**가 찍히고 설비 목록이 같은 번호를 쓴다', () => {
  assert.ok(HTML.includes('<svg'), '평면도가 없다');
  /* 그림의 번호 — 이름이 아니라 번호여야 한다(겹쳐서 못 읽는다) */
  assert.match(HTML, /paint-order="stroke">1</, '그림에 번호가 없다');
  assert.match(HTML, /paint-order="stroke">2</);
  /* 표의 번호와 이름 */
  const list = HTML.slice(HTML.indexOf('설비 목록'));
  assert.ok(list.includes('<td>1</td>') || list.includes('>1<'), '표에 번호가 없다');
  assert.ok(list.includes('제작기 1') && list.includes('제작기 2'));
});

t('번호는 놓인 순서 그대로 — 그림과 표가 어긋나면 둘 다 못 쓴다', () => {
  const svg = layoutThumbSVG(LAYOUT, { w: 400, h: 300, labels: true });
  const nums = [...svg.matchAll(/paint-order="stroke">(\d+)</g)].map((m) => m[1]);
  assert.deepEqual(nums, ['1', '2']);
  /* 목록도 같은 순서 */
  const rows = LAYOUT.placed.map((p, i) => `${i + 1} ${p.name}`);
  assert.deepEqual(rows, ['1 제작기 1', '2 제작기 2']);
});

t('자리 없는 것은 번호를 안 먹는다 — 그림에 없는데 표에 있으면 못 찾는다', () => {
  const withGhost = { ...LAYOUT, placed: [...LAYOUT.placed, { uid: 'E3', itemId: 'M', name: '자리 없음' }] };
  const svg = layoutThumbSVG(withGhost, { w: 400, h: 300, labels: true });
  const nums = [...svg.matchAll(/paint-order="stroke">(\d+)</g)].map((m) => m[1]);
  assert.deepEqual(nums, ['1', '2'], '자리도 없는 것에 번호를 찍었다');
  const html = planReportHTML({ layout: withGhost, info: layoutInfo(withGhost, itemOf), rows: [] });
  assert.equal(html.includes('자리 없음'), false, '그림에 없는 것을 표에 적었다');
});

t('번호를 안 켜면 안 찍힌다 — 목록 썸네일은 글자가 들어갈 자리가 없다', () => {
  const thumb = layoutThumbSVG(LAYOUT, { w: 320, h: 180 });
  assert.equal(/paint-order/.test(thumb), false);
  assert.equal(/ m<\/text>/.test(thumb), false, '작은 썸네일에 축척 막대가 들어갔다');
});

/* ---------- 축척 --------------------------------------------------------- */

t('축척 막대가 1·2·5·10 눈금으로 떨어진다 — 「3.7m」 는 자로 못 쓴다', () => {
  const svg = layoutThumbSVG(LAYOUT, { w: PLAN_W, h: PLAN_H, scaleBar: true });
  const m = svg.match(/>(\d+(?:\.\d+)?) m<\/text>/);
  assert.ok(m, '축척 막대가 없다');
  const v = Number(m[1]);
  const mant = v / 10 ** Math.floor(Math.log10(v));
  assert.ok([1, 2, 5].some((k) => Math.abs(mant - k) < 1e-9), `눈금이 어중간하다: ${v}`);
});

t('축척은 가로폭의 1/4 을 안 넘는다 — 넘으면 그림 위를 가로지른다', () => {
  const b = layoutBounds(LAYOUT);
  assert.ok(b, '경계를 못 잡는다');
  const svg = layoutThumbSVG(LAYOUT, { w: PLAN_W, h: PLAN_H, scaleBar: true });
  const line = svg.match(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"[^>]*stroke="#334155" stroke-width="1.5"\/>/);
  assert.ok(line, '막대 선이 없다');
  assert.ok(Number(line[2]) - Number(line[1]) <= PLAN_W / 4 + 1);
});

t('빈 도면에도 안 터진다 — 눌러 놓고 아무 일도 안 나는 것이 제일 나쁘다', () => {
  const empty = planReportHTML({ at: '2026-08-18' });
  assert.match(empty, /^<!doctype html>/);
  assert.ok(empty.includes('빈 도면'), '빈 평면도라고 말하지 않는다');
  assert.ok(empty.includes('놓인 것이 없습니다'));
});

/* ---------- 화면 배선 ----------------------------------------------------- */

const inspector = await readSrc('ui/Inspector.jsx');

t('도면 요약 안에 버튼이 있다 — 아래 띠는 「이번 실행」의 자리다', () => {
  assert.match(inspector, /import \{ planReportHTML \} from '\.\.\/core\/planReport\.js'/);
  const sec = cut(inspector, 'function Summary()', '<LineCapacity />', '도면 요약');
  assert.ok(sec.includes('<PlanReportButton />'), '요약에 버튼이 없다');
});

t('화면과 **같은 계산**을 넘긴다 — 종이와 화면이 다르면 둘 다 못 믿는다', () => {
  const fn = cut(inspector, 'function PlanReportButton()', '\nfunction ', '도면 보고서 버튼');
  for (const call of ['lineBalance(', 'improvePlan(', 'layoutInfo(', 'layoutSnapshot(']) {
    assert.ok(fn.includes(call), `${call} 를 안 쓰고 자기 나름대로 센다`);
  }
  const line = fn.split(/\r?\n/).find((l) => /^\s*machines:/.test(l));
  assert.match(line ?? '', /filter\(workable\)/, '선반·적치대까지 전기료를 물린다');
});

t('실패하면 말은 한다 — 눌렀는데 아무 일도 안 나면 고장인지 알 수 없다', () => {
  const fn = cut(inspector, 'function PlanReportButton()', '\nfunction ', '도면 보고서 버튼');
  assert.ok(/catch/.test(fn), '실패를 안 잡는다');
  assert.ok(/hint:/.test(fn), '실패해도 아무 말이 없다');
});
