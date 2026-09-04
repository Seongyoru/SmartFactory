/**
 * 보기 전용 — **고치지 않고 보기만 한다**
 * ---------------------------------------------------------------------------
 *  실측(개발 서버):
 *      보기 전용에서 벨트 속도 슬라이더를 1.4 로 밀어도 0.60 그대로
 *      편집으로 돌아가 같은 조작을 하면 1.40 으로 바뀐다
 *  이 한 자리가 이 기능의 설계를 정한다 — `SET` 은 만능이라 「막을 액션 이름
 *  목록」 을 그냥 뚫는다. 그래서 이름이 아니라 **도면이 실제로 바뀌었는가** 로
 *  판정한다(되돌리기가 이미 쓰는 근거).
 *
 *  ── 통과시켜야 하는 것 셋 ───────────────────────────────────────────────
 *  이걸 빠뜨리면 조용히 망가진다.
 *    LOAD_LAYOUT   부팅 복원이 이걸 쓴다 — 막으면 새로고침마다 빈 도면
 *    ADD_LIB_ITEM  부팅 때 IndexedDB 에서 사용자 GLB 를 되살리며 쏜다
 *    구역 감추기    보기 기능인데 zones(도면)를 건드린다
 */
import assert from 'node:assert/strict';
import { group, readSrc, SRC, t } from './_harness.mjs';

group('보기 전용');

const { ALWAYS_OK, isZoneHide, isAllowed, withReadOnly } =
  await import(`${SRC}core/readOnly.js`);

const store = await readSrc('core/store.jsx');
const toolbar = await readSrc('ui/Toolbar.jsx');
const app = await readSrc('App.jsx');
const lib = await readSrc('ui/LibraryPanel.jsx');
const persist = await readSrc('core/persistence.js');
const css = await readSrc('index.css');
const zones = await readSrc('ui/ZoneLayers.jsx');
const roSrc = await readSrc('core/readOnly.js');
const insp = await readSrc('ui/Inspector.jsx');

/* ── 검문 자체 ─────────────────────────────────────────────────────────── */

/** store 와 같은 꼴의 아주 작은 세계 */
const KEYS = ['placed', 'zones', 'beltSpeed'];
const docOf = (s) => Object.fromEntries(KEYS.map((k) => [k, s[k]]));
const sameDoc = (a, b) => KEYS.every((k) => a[k] === b[k]);
/** 무엇이든 시키는 대로 고치는 리듀서 — 검문만 시험한다 */
const base = (s, a) => (a.patch ? { ...s, ...a.patch } : s);
const guarded = withReadOnly(base, { sameDoc, docOf });
const S = (readOnly) => ({ readOnly, placed: [], zones: [], beltSpeed: 0.6 });

t('편집 모드에서는 아무것도 안 막는다', () => {
  const out = guarded(S(false), { type: 'SET', patch: { beltSpeed: 1.4 } });
  assert.equal(out.beltSpeed, 1.4);
});

t('**`SET` 으로 도면을 뚫는 길을 막는다** — 벨트 속도가 바로 그 자리다', () => {
  const before = S(true);
  const out = guarded(before, { type: 'SET', patch: { beltSpeed: 1.4 } });
  assert.equal(out.beltSpeed, 0.6, '보기 전용인데 벨트 속도가 바뀌었다');
  assert.equal(out, before, '막을 때는 상태를 **그대로** 돌려줘야 한다');
});

t('도면을 안 바꾸는 것은 그대로 통과한다 — 고르기·뷰 전환·탭·배율', () => {
  const out = guarded(S(true), { type: 'SET', patch: { view: 'iso', uiScale: 2 } });
  assert.equal(out.view, 'iso');
  assert.equal(out.uiScale, 2);
});

t('도면을 바꾸는 액션은 이름을 몰라도 막힌다 — 새 액션이 늘어도 여기를 안 고친다', () => {
  for (const type of ['PLACE', 'DELETE', 'MOVE_MANY', 'IMPORT_CAD', 'CLEAR', 'UNDO', '아직없는액션']) {
    const out = guarded(S(true), { type, patch: { placed: ['새것'] } });
    assert.deepEqual(out.placed, [], `${type} 이 도면을 바꿨다`);
  }
});

/* ── 통과시켜야 하는 것 ────────────────────────────────────────────────── */

t('**LOAD_LAYOUT 은 통과한다** — 막으면 새로고침마다 빈 도면이 뜬다', () => {
  assert.ok(ALWAYS_OK.includes('LOAD_LAYOUT'));
  const out = guarded(S(true), { type: 'LOAD_LAYOUT', patch: { placed: ['불러온것'] } });
  assert.deepEqual(out.placed, ['불러온것'], '공용 도면을 열 수 없다');
});

t('**ADD_LIB_ITEM 은 통과한다** — 막으면 사용자 GLB 가 영영 안 돌아온다', () => {
  assert.ok(ALWAYS_OK.includes('ADD_LIB_ITEM'));
  assert.equal(isAllowed({ type: 'ADD_LIB_ITEM' }), true);
});

t('부팅 복원이 그 둘을 실제로 쏜다 — 통과 목록의 근거가 코드에 있다', () => {
  /* 이 근거가 사라지면 통과 목록은 그냥 구멍이 된다 */
  assert.match(store, /dispatch\(\{ type: 'ADD_LIB_ITEM'/, '부팅이 ADD_LIB_ITEM 을 안 쓴다');
  assert.match(store, /dispatch\(\{ type: 'LOAD_LAYOUT'/, '부팅이 LOAD_LAYOUT 을 안 쓴다');
});

t('**구역 감추기는 통과한다** — 보기 기능인데 도면을 건드린다', () => {
  assert.equal(isZoneHide({ type: 'UPDATE_ZONE', patch: { hidden: true } }), true);
  /* **검문을 통과하는지 값으로 확인한다.** 판정 함수만 시험하면, 검문이 그
     판정을 안 쓰게 되어도 검사는 통과한다 — 실제로 그 구멍이 있었다.
     그래서 zones 를 진짜로 바꾸는 리듀서에 태워 본다. */
  const hides = (s, a) => (a.type === 'UPDATE_ZONE' ? { ...s, zones: ['감춘것'] } : s);
  const g = withReadOnly(hides, { sameDoc, docOf });
  const out = g(S(true), { type: 'UPDATE_ZONE', patch: { hidden: true } });
  assert.deepEqual(out.zones, ['감춘것'], '보기 전용에서 구역을 감출 수 없다');
  /* 같은 리듀서인데 편집 액션이면 막혀야 한다 — 통과가 액션에 달렸다는 증거 */
  const blocked = g(S(true), { type: 'UPDATE_ZONE', patch: { name: '새 이름' } });
  assert.deepEqual(blocked.zones, [], '이름을 고치는 것까지 통과했다');
});

t('구역을 **고치는** UPDATE_ZONE 은 막힌다 — 이름·색을 같이 보내면 편집이다', () => {
  assert.equal(isZoneHide({ type: 'UPDATE_ZONE', patch: { hidden: true, name: '새 이름' } }), false);
  assert.equal(isZoneHide({ type: 'UPDATE_ZONE', patch: { name: '새 이름' } }), false);
  assert.equal(isZoneHide({ type: 'UPDATE_ZONE' }), false);
  assert.equal(isZoneHide({ type: 'UPDATE_AREA', patch: { hidden: true } }), false);
  /* 감추기 판정이 UPDATE_ZONE 을 통째로 열어 주지 않는다 */
  const out = guarded(S(true), { type: 'UPDATE_ZONE', patch: { zones: ['고친것'] } });
  assert.deepEqual(out.zones, []);
});

t('실제 구역 목록이 그 꼴로 쏜다 — 아니면 위 판정이 헛것을 지킨다', () => {
  assert.match(zones, /type: 'UPDATE_ZONE', uid: z\.uid, patch: \{ hidden: !z\.hidden \}/,
    '구역 감추기가 hidden 하나만 보내지 않는다');
});

/* ── 배선 ──────────────────────────────────────────────────────────────── */

t('**검문이 되돌리기 바깥이다** — 안쪽이면 막힌 편집이 Ctrl+Z 한 칸을 남긴다', () => {
  assert.match(store, /const historyReducer = withReadOnly\(\s*withHistory\(/,
    'withReadOnly 가 withHistory 를 감싸지 않는다');
});

t('store 의 sameDoc·docOf 를 **넘겨받는다** — 베끼면 DOC_KEYS 가 늘 때 조용히 어긋난다', () => {
  assert.match(store, /\{ sameDoc, docOf \}/, 'store 것을 안 넘긴다');
  /* 주석에서 「DOC_KEYS 를 다시 적지 말라」 고 **말하는** 것은 괜찮다 —
     막을 것은 실제로 목록을 베낀 것이다. 그래서 열쇠 이름을 짚는다. */
  assert.ok(!/'placed'|'links'|'carts'|'beltSpeed'/.test(roSrc),
    'readOnly.js 가 도면 열쇠를 베꼈다 — store 의 DOC_KEYS 가 늘면 조용히 어긋난다');
});

t('사람이 켜고 끈다 — **자동으로 안 켠다**(배율과 같은 원칙)', () => {
  assert.match(persist, /localStorage\.getItem\(READONLY_KEY\) === '1'/, '저장값을 안 읽는다');
  const after = persist.slice(persist.indexOf('export function loadReadOnly'));
  assert.ok(!/matchMedia|innerWidth|NARROW_AT/.test(after), '폭이나 미디어 쿼리로 자동 결정한다');
  assert.match(toolbar, /patch: \{ readOnly: !ro \}/, '툴바에 켜고 끄는 자리가 없다');
});

t('들어갈 때 **손에 든 것을 놓는다** — 안 놓으면 「클릭해서 놓기」 가 거짓말로 남는다', () => {
  assert.match(store, /if \(state\.readOnly\) dispatch\(\{ type: 'SET_TOOL', tool: TOOL\.SELECT/,
    '보기 전용으로 들어갈 때 도구를 안 놓는다');
});

t('단축키를 **거기서 끊는다** — 리듀서까지 보내면 눌린 것이 먹혔는지 알 수가 없다', () => {
  assert.match(app, /if \(state\.readOnly && e\.key !== 'Tab' && e\.key !== 'Escape'\) return;/,
    '단축키 검문이 없다');
});

t('나가는 길을 화면에 남긴다 — 모드에 갇히는 것이 이 기능의 흔한 실패다', () => {
  assert.match(app, /보기 전용 — 눌러서 편집으로/, '상태바에 나가는 길이 없다');
  assert.match(lib, /보기 전용입니다/, '왼쪽 패널이 왜 비었는지 안 말한다');
});

t('**초기화는 반드시 감춘다** — 막기만 하면 「지웠다」 고 믿게 만든다', () => {
  /* 주석이 아니라 **단추**를 짚는다 — 첫 '초기화' 는 다른 주석 안에 있다 */
  const at = toolbar.indexOf('<Trash2 size={13} /> 초기화');
  assert.ok(at > 0, '초기화 단추를 못 찾았다');
  const before = toolbar.slice(Math.max(0, at - 700), at);
  assert.match(before, /\{!ro && \(/, '초기화가 보기 전용에서도 보인다');
  /* 물어보는 창이 리듀서보다 **먼저** 뜬다는 것이 이 검사의 이유다 */
  assert.match(before, /window\.confirm/, '초기화가 묻지 않는다 — 검사의 전제가 바뀌었다');
});

t('보는 일은 남긴다 — 내보내기와 공용 도면', () => {
  for (const mark of ['btn-export', '<GalleryButton']) {
    const at = toolbar.indexOf(mark);
    assert.ok(at > 0, `${mark} 를 못 찾았다`);
    assert.ok(!/\{!ro &&/.test(toolbar.slice(Math.max(0, at - 200), at)), `${mark} 가 감춰졌다`);
  }
});

t('고치는 칸을 죽이되 **패널 자체는 안 건드린다** — 스크롤이 살아야 값을 다 본다', () => {
  const at = css.indexOf(':root[data-readonly="1"]');
  assert.ok(at > 0, '보기 전용 CSS 가 없다');
  const block = css.slice(at, css.indexOf('}', at) + 1);
  assert.match(block, /pointer-events: none/, '칸이 안 죽는다');
  assert.ok(!/:root\[data-readonly="1"\] aside \{/.test(css), 'aside 통째로 죽였다 — 스크롤이 막힌다');
  /* fieldset 을 쓰면 붙는 머리(`[&>div:first-child]`)가 통째로 죽는다 */
  assert.ok(!/<fieldset/.test(insp), 'fieldset 을 끼웠다 — 붙는 머리가 죽는다');
});

t('루트에 표시를 건다 — 그 표시가 없으면 위 CSS 가 영영 안 걸린다', () => {
  assert.match(store, /dataset\.readonly = state\.readOnly \? '1' : ''/, '루트에 표시를 안 건다');
});
