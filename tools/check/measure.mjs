/* measure.js — 자. 두 점 사이 · 축에 붙은 치수 · 도면에 안 남는다 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('치수 재기');

const M = await import(SRC + 'core/measure.js');
const store = await readSrc('core/store.jsx');
const scene = await readSrc('scene/EditorScene.jsx');
const toolbar = await readSrc('ui/Toolbar.jsx');
const app = await readSrc('App.jsx');
const persist = await readSrc('core/persistence.js');

/* ---------- 값 ------------------------------------------------------------ */

t('가로·세로를 따로 말한다 — 「4.24m」 만으로는 통로 폭을 못 답한다', () => {
  const m = M.measureOf([0, 0], [3, 3]);
  assert.ok(Math.abs(m.dist - Math.hypot(3, 3)) < 1e-9);
  assert.equal(m.dx, 3);
  assert.equal(m.dz, 3);
  assert.deepEqual(m.mid, [1.5, 1.5]);
});

t('반대로 그어도 같은 값 — 자를 어느 쪽부터 대든 거리는 하나다', () => {
  const a = M.measureOf([2, 7], [9, 3]);
  const b = M.measureOf([9, 3], [2, 7]);
  assert.ok(Math.abs(a.dist - b.dist) < 1e-9);
  assert.equal(a.dx, b.dx);
  assert.equal(a.dz, b.dz);
  assert.ok(Math.abs(a.deg - b.deg) < 1e-9, '방위가 뒤집힌다');
});

t('방위는 0~180 — 180 을 넘으면 같은 선을 두 가지로 말하게 된다', () => {
  for (const [a, b] of [[[0, 0], [1, 0]], [[0, 0], [-1, 0]], [[0, 0], [0, 1]], [[0, 0], [-1, -1]]]) {
    const m = M.measureOf(a, b);
    assert.ok(m.deg >= 0 && m.deg < 180, `${m.deg}`);
  }
});

t('같은 자리를 두 번 누르면 잴 것이 없다 — 0 이 아니라 없는 것이다', () => {
  assert.equal(M.measureOf([5, 5], [5, 5]), null);
  assert.equal(M.measureOf([5, 5], [5, 5 + M.MIN_SPAN / 2]), null);
  /* 경계에 딱 붙여 놓고 재면 안 된다 — 5 + 0.05 는 5.05 로 딱 떨어지지 않아
     빼면 0.04999… 가 나온다. 여기서 검사가 튀면 코드가 아니라 검사가 틀린 것이다 */
  assert.ok(M.measureOf([5, 5], [5, 5 + M.MIN_SPAN * 2]));
  assert.equal(M.measureOf(null, [1, 1]), null);
  assert.equal(M.measureOf([1, 1], null), null);
});

t('10m 를 넘으면 소수 한 자리 — 클릭이 그만큼 정밀하지도 않다', () => {
  assert.equal(M.spanText(3.456), '3.46 m');
  assert.equal(M.spanText(12.345), '12.3 m');
  assert.equal(M.spanText(NaN), '—');
});

t('읽는 문구에 셋이 다 들어간다', () => {
  const s = M.measureText(M.measureOf([0, 0], [3, 4]));
  assert.ok(s.includes('5.00 m') && s.includes('가로 3.00') && s.includes('세로 4.00'), s);
  assert.equal(M.measureText(null), '');
});

/* ---------- 클릭 규칙 ------------------------------------------------------ */

t('첫 점 → 둘째 점 → 다시 처음', () => {
  const a = M.nextMeasure(null, [0, 0]);
  assert.deepEqual(a, { a: [0, 0], b: null });
  const b = M.nextMeasure(a, [3, 0]);
  assert.deepEqual(b, { a: [0, 0], b: [3, 0] });
  /* 셋째 클릭은 새로 잰다 — 「지우고 다시」 버튼을 따로 두면 두 번 눌러야 한다 */
  const c = M.nextMeasure(b, [9, 9]);
  assert.deepEqual(c, { a: [9, 9], b: null });
});

t('같은 자리를 두 번 누르면 첫 점을 그리로 옮긴다 — 0m 짜리 자는 쓸모없다', () => {
  const a = { a: [4, 4], b: null };
  assert.deepEqual(M.nextMeasure(a, [4, 4]), { a: [4, 4], b: null });
});

t('빈 클릭은 아무것도 안 바꾼다', () => {
  assert.equal(M.nextMeasure(null, null), null);
});

/* ---------- 도면에 안 남는다 ---------------------------------------------- */

t('**저장되지 않는다** — 잰 것은 도면이 아니라 손놀림이다', () => {
  const keys = cut(store, 'const DOC_KEYS = [', '];', 'DOC_KEYS');
  assert.equal(/'measure'/.test(keys), false, '자가 도면에 저장된다');
  assert.ok(store.includes('measure: null'), '초기 상태에 자리가 없다');
});

t('내보내기에도 안 들어간다', () => {
  const snapshot = cut(persist, 'export const layoutSnapshot', '});', 'layoutSnapshot');
  assert.equal(/measure/.test(snapshot), false, '내보낸 파일에 자가 딸려 나간다');
});

t('도구를 떠나면 지운다 — 남은 선이 그린 것인지 잰 것인지 헷갈린다', () => {
  const setTool = cut(store, "case 'SET_TOOL':", '\n    case ', 'SET_TOOL');
  assert.match(setTool, /measure: action\.tool === TOOL\.MEASURE \? state\.measure : null/);
});

t('탑뷰로 돌린다 — 비스듬히 보면서 잰 거리는 못 믿는다', () => {
  const setTool = cut(store, "case 'SET_TOOL':", '\n    case ', 'SET_TOOL');
  assert.match(setTool, /TOOL\.MEASURE \? VIEW\.TOP/);
});

/* ---------- 화면 배선 ------------------------------------------------------ */

t('리듀서가 규칙을 자기 나름대로 다시 쓰지 않는다', () => {
  const red = cut(store, "case 'MEASURE_POINT':", "case 'MEASURE_CLEAR':", '자 리듀서');
  assert.ok(red.includes('nextMeasure(state.measure'), '리듀서가 순서를 따로 적었다');
  assert.match(store, /import \{ nextMeasure \} from '\.\/measure\.js'/);
});

t('씬이 클릭을 자에 넘긴다 — 다른 도구와 **같은 커서**로', () => {
  const hit = cut(scene, 'if (tool === TOOL.MEASURE) {', 'return;\n      }', '자 클릭');
  assert.ok(hit.includes("type: 'MEASURE_POINT'"), '클릭을 안 넘긴다');
  assert.match(hit, /snap\(p\[0\], gridSize\)/, '스냅을 무시해 그리는 자리와 재는 자리가 달라진다');
});

t('둘째 점을 찍기 전에도 커서까지 따라 그린다', () => {
  const view = cut(scene, 'function MeasureView(', '\nfunction ', '자 그리기');
  assert.match(view, /measure\?\.b \?\? \(a \? cursor : null\)/, '찍기 전에는 아무것도 안 보인다');
  assert.ok(view.includes('measureText('), '치수를 안 적는다');
  assert.equal(/toFixed/.test(view), false, '화면이 숫자를 자기 나름대로 다듬는다');
});

t('툴바에 자가 있다', () => {
  assert.match(toolbar, /active=\{state\.tool === TOOL\.MEASURE\}/, '켠 표시가 없다');
  assert.match(toolbar, /setTool\(TOOL\.MEASURE\)/);
  assert.ok(toolbar.includes('Ruler'), '아이콘이 없다');
});

t('Esc 는 잰 것부터 지운다 — 도구까지 바꾸면 자를 다시 집어야 한다', () => {
  const esc = cut(app, "case 'Escape':", 'break;', 'Esc');
  const iMeasure = esc.indexOf('MEASURE_CLEAR');
  const iTool = esc.indexOf("type: 'SET_TOOL'");
  assert.ok(iMeasure > 0, 'Esc 가 자를 안 지운다');
  assert.ok(iMeasure < iTool, '도구 바꾸기가 먼저라 자를 못 지운다');
});

/* ---------- 캔버스 위 안내 띠 ---------------------------------------------- */

const banner = cut(app, 'function ModeBanner()', '\nfunction ', '안내 띠');

t('자를 켜면 **자 이야기**를 한다 — 지우개 문구가 나오면 안 된다', () => {
  /* 실제로 났던 일: 자를 켜고 재는 중에 빨간 띠로 「지울 대상을 클릭하세요」
     가 떠 있었다. 마지막 가지가 조건 없는 else 라 새 도구가 전부 그것을
     물려받았기 때문이다. */
  assert.match(banner, /tool === TOOL\.MEASURE/, '안내 띠가 자를 모른다');
  const arm = banner.slice(banner.indexOf('tool === TOOL.MEASURE'));
  assert.ok(arm.includes('Ruler'), '자 아이콘이 아니다');
  assert.ok(/첫 점|둘째 점/.test(arm), '무엇을 누르라는 말이 없다');
});

t('마지막 가지는 **지우개다** — 「그 밖에 전부」가 아니다', () => {
  /* 조건 없는 else 로 두면 다음에 넣는 도구가 또 지우개 문구를 물려받는다.
     이 검사는 그 사고를 한 번 더 겪지 않기 위한 것이다. */
  assert.match(banner, /tool === TOOL\.ERASE\s*\n?\s*\? \{ Icon: Eraser/,
    '지우개 문구에 조건이 없다 — 새 도구가 그대로 물려받는다');
  const tail = banner.slice(banner.indexOf('지울 대상을 클릭하세요'));
  assert.ok(/MousePointer2|도구가 켜져 있습니다/.test(tail), '모르는 도구의 자리가 없다');
});

t('「Esc」 라고 적힌 버튼은 Esc 키와 **같은 일**을 한다', () => {
  /* 잰 것이 있으면 키는 그것부터 지운다. 버튼이 도구를 꺼 버리면 같은 이름을
     달고 다른 일을 하는 셈이다. */
  const esc = banner.slice(banner.indexOf('<button'), banner.indexOf('</button>'));
  assert.match(esc, /state\.measure\s*\n?\s*\? dispatch\(\{ type: 'MEASURE_CLEAR' \}\)/,
    'Esc 버튼이 잰 것을 안 지운다');
});
