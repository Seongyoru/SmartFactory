/**
 * 손가락 — **탑뷰에서 도면을 밀고 오므려 확대하기**
 * ---------------------------------------------------------------------------
 *  전에는 탑뷰에서 손가락으로 카메라를 **전혀** 못 움직였다. 탑뷰에는 컨트롤
 *  객체가 아예 없고(OrbitControls 는 3D 에만 붙는다), 직접 만든 TopControls 가
 *  듣는 것은 휠(확대)과 가운데/오른쪽 버튼(팬) 뿐인데 손가락은 그 둘을 안 낸다.
 *  3D 뷰는 반대로 OrbitControls 기본값 덕에 이미 핀치가 됐다 — 그래서 3D 는
 *  손대지 않는다.
 *
 *  ── 왜 두 손가락인가 ────────────────────────────────────────────────────
 *  한 손가락은 **이미 쓰이고 있다.** PointerDriver 가 pointerType 을 안 보므로
 *  손가락이 마우스 왼쪽 버튼과 똑같이 취급되어, 설비를 놓고 끌고 마키로 고르는
 *  일이 터치로 다 된다. 한 손가락을 팬으로 돌리면 그 전부가 터치에서 사라진다.
 *
 *  ── 여기서 조심할 것 셋 ─────────────────────────────────────────────────
 *  1. 두 번째 손가락이 닿는 순간 **하던 편집을 버린다.** 안 하면 확대하는 내내
 *     첫 손가락이 잡은 설비가 딸려 온다.
 *  2. `pointercancel` 을 듣는다. 손가락은 pointerup 없이 사라질 수 있다 —
 *     안 들으면 유령 손가락이 남아 다음 한 손가락 조작이 핀치로 오인된다.
 *  3. 두 번째 손가락의 `pointermove` 를 흘려보낸다. 안 그러면 두 스트림이 섞여
 *     끌던 것이 두 손가락 사이를 오간다.
 */
import assert from 'node:assert/strict';
import { group, readSrc, t } from './_harness.mjs';

group('손가락');

const scene = await readSrc('scene/EditorScene.jsx');
const css = await readSrc('index.css');
const focus = await readSrc('core/focusStore.js');
const libSrc = await readSrc('ui/LibraryPanel.jsx');

/** TopControls 의 본문만 떼어 낸다 — 다른 데서 우연히 맞는 글자에 속지 않게 */
const topAt = scene.indexOf('function TopControls(');
const topBody = scene.slice(topAt, scene.indexOf('\nconst CameraRig', topAt));
/** PointerDriver 의 본문 */
const pdAt = scene.indexOf('function PointerDriver(');
const pdBody = scene.slice(pdAt, scene.indexOf('\n  return null;\n}', pdAt));

t('TopControls 를 떼어 냈다 — 아래 검사들이 헛것을 보고 있지 않다', () => {
  assert.ok(topAt > 0 && topBody.length > 400, 'TopControls 본문을 못 찾았다');
  assert.ok(pdAt > 0 && pdBody.length > 400, 'PointerDriver 본문을 못 찾았다');
});

/* ── 손가락이 카메라를 움직인다 ────────────────────────────────────────── */

t('**두 손가락**을 센다 — 한 손가락은 건드리지 않는다', () => {
  assert.match(topBody, /pointerType === 'touch'/, '손가락을 안 가른다');
  assert.match(topBody, /pts\.set\(e\.pointerId/, '손가락을 pointerId 로 안 담는다');
  assert.match(topBody, /pts\.size === 2/, '두 손가락일 때를 안 본다');
});

t('핀치 확대가 휠과 **같은 식**을 쓴다 — 따로 쓰면 값이 갈라진다', () => {
  assert.match(topBody, /const zoomAt = \(nx, ny, want\)/, '확대 식을 안 떼어 냈다');
  const wheel = topBody.slice(topBody.indexOf('const onWheel'), topBody.indexOf('const pts'));
  assert.match(wheel, /zoomAt\(/, '휠이 그 식을 안 쓴다');
  const move = topBody.slice(topBody.indexOf('const onMove'));
  assert.match(move, /zoomAt\(/, '핀치가 그 식을 안 쓴다');
});

t('확대가 2~120 으로 묶여 있다 — 풀리면 도면이 점이 되거나 화면을 넘친다', () => {
  assert.match(topBody, /Math\.min\(120, Math\.max\(2, want\)\)/, '확대 상·하한이 없다');
});

t('**확대는 제스처 시작 기준이다** — 직전 값에 곱하면 오차가 쌓인다', () => {
  assert.match(topBody, /pinch\.z0 \* \(s\.d \/ pinch\.d0\)/,
    '핀치가 시작 시점의 확대·거리를 기준으로 안 잡는다');
});

t('확대를 zoomRef 에 남긴다 — 안 남기면 3D 로 갔다 오는 순간 되돌아간다', () => {
  const za = topBody.slice(topBody.indexOf('const zoomAt'), topBody.indexOf('const ndc'));
  assert.match(za, /zoomRef\.current = z1/, '확대 식이 zoomRef 를 안 고친다');
});

/* ── 편집과 다투지 않는다 ──────────────────────────────────────────────── */

t('**두 번째 손가락이 닿으면 하던 편집을 버린다**', () => {
  const down = topBody.slice(topBody.indexOf('const onDown'), topBody.indexOf('const onMove'));
  assert.match(down, /cancelRef\?\.current\?\.\(\)/, '취소를 안 부른다');
  assert.ok(down.indexOf('pts.size === 2') < down.indexOf('cancelRef'),
    '두 손가락이 되기 전에 취소한다 — 한 손가락 편집이 시작도 못 한다');
});

t('취소가 **진행 중인 것 넷을 다 지운다** — 하나라도 남으면 확대하는 내내 딸려 온다', () => {
  const at = scene.indexOf('cancelRef.current = () => {');
  assert.ok(at > 0, '취소 함수를 못 찾았다');
  const body = scene.slice(at, scene.indexOf('};', at));
  for (const [what, re] of [
    ['끌던 것', /drag\.current = null/],
    ['마키', /setMarquee\(null\)/],
    ['끌어 그리던 사각형', /setRectDraft\(null\)/],
    ['들여다보기', /cancelFocus\(\)/],
  ]) {
    assert.match(body, re, `취소가 ${what} 을 안 지운다`);
  }
});

t('취소는 **끝내는 것이 아니라 버리는 것이다** — onUp 을 부르면 선택이 확정된다', () => {
  const at = scene.indexOf('cancelRef.current = () => {');
  const body = scene.slice(at, scene.indexOf('};', at));
  assert.ok(!/onUp\(/.test(body), '취소가 onUp 을 부른다 — 마키가 선택을 확정해 버린다');
  assert.ok(!/dispatch\(/.test(body), '취소가 dispatch 를 한다 — 확대하려던 사람에게 사고다');
});

t('들여다보기를 멈출 수 있다 — 안 멈추면 매 프레임 덮어써져 안 움직인다', () => {
  assert.match(focus, /export function cancelFocus\(\)/, 'focusStore 에 취소가 없다');
  assert.match(scene, /goal\.current = r\?\.at \? r : null/,
    '받는 쪽이 빈 목표를 안 거른다 — 다음 프레임에 at\[0\] 이 터진다');
});

/* ── 사라지는 손가락 ───────────────────────────────────────────────────── */

t('**pointercancel 을 듣는다** — 손가락은 pointerup 없이 사라진다', () => {
  assert.match(topBody, /addEventListener\('pointercancel'/, 'TopControls 가 안 듣는다');
  assert.match(pdBody, /addEventListener\('pointercancel'/, 'PointerDriver 가 안 듣는다');
  assert.match(topBody, /removeEventListener\('pointercancel'/, 'TopControls 가 안 거둔다');
  assert.match(pdBody, /removeEventListener\('pointercancel'/, 'PointerDriver 가 안 거둔다');
});

t('취소로 들어온 것은 **클릭으로 치지 않는다** — 사람이 뗀 것이 아니다', () => {
  assert.match(pdBody, /e\.type !== 'pointercancel' && e\.button === 0/,
    'pointercancel 이 클릭을 쏜다');
});

t('두 번째 손가락의 move 를 흘려보낸다 — 안 그러면 끌던 것이 둘 사이를 오간다', () => {
  assert.match(pdBody, /e\.pointerType === 'touch' && e\.isPrimary === false/,
    '두 번째 손가락을 안 가른다');
  const move = pdBody.slice(pdBody.indexOf('const onMove'), pdBody.indexOf('const onDown'));
  assert.match(move, /secondFinger\(e\)/, 'onMove 가 안 거른다');
  const down = pdBody.slice(pdBody.indexOf('const onDown'), pdBody.indexOf('const onUp'));
  assert.match(down, /secondFinger\(e\)/, 'onDown 이 안 거른다');
});

/* ── 브라우저에 제스처를 뺏기지 않는다 ─────────────────────────────────── */

t('**캔버스의 touch-action: none** — 없으면 핀치가 브라우저 확대에 먹힌다', () => {
  assert.match(css, /canvas\s*\{[^}]*touch-action:\s*none/,
    'canvas 에 touch-action: none 이 없다');
});

t('3D 뷰의 조작은 손대지 않았다 — 이미 손가락으로 되고, camera.mjs 가 그 글자에 묶여 있다', () => {
  /* OrbitControls 에 touches 를 명시하지 않는다 — 기본값(한 손가락 회전 ·
     두 손가락 돌리+팬)이 그대로 살아야 한다 */
  assert.ok(!/touches=\{/.test(scene), 'OrbitControls 에 touches 를 명시했다 — 기본값이 죽는다');
  assert.match(scene, /maxPolarAngle=\{Math\.PI \/ 2\.05\}/, '3D 카메라 설정이 바뀌었다');
});

t('탑뷰에 OrbitControls 를 들이지 않았다 — 왼쪽 버튼을 배치에 써야 한다', () => {
  const rig = scene.slice(scene.indexOf('const CameraRig'), scene.indexOf('const CameraRig') + 900);
  const top = rig.slice(0, rig.indexOf('return ('), rig.length);
  assert.match(rig, /<TopControls/, '탑뷰가 TopControls 를 안 쓴다');
  const topBranch = rig.slice(rig.indexOf('view === VIEW.TOP'), rig.indexOf('<TopControls'));
  assert.ok(!/OrbitControls/.test(topBranch), '탑뷰에 OrbitControls 가 들어왔다');
  assert.ok(top !== null);
});

t('마우스 조작 조건이 **글자 그대로** 남아 있다 — 터치를 넣으면서 안 바꿨다', () => {
  assert.match(topBody, /e\.button === 1 \|\| e\.button === 2/, '가운데/오른쪽 버튼 팬 조건이 바뀌었다');
  assert.match(topBody, /Math\.exp\(-e\.deltaY \* 0\.0012\)/, '휠 확대 속도가 바뀌었다');
});

/* ==========================================================================
 *  누를 자리 크기 — 손가락이 닿는가
 * ==========================================================================
 *  세어 보니 누를 수 있는 목표 243곳 중 **237곳이 44px 미만**이었다.
 *  가장 심한 곳: 띠 손잡이 8px · 슬라이더 12px · 휴지통 단추들 15px.
 *
 *  실측(모바일 375×812, pointer: coarse):
 *      서랍 닫힘   목표 35곳 — 높이 미달 0 · 아이콘 단추 21곳 폭 미달 0
 *      라이브러리   목표 41곳 — 미달 0
 *      속성        목표 43곳 — 미달 0
 *  데스크톱(pointer: fine)에서는 min-block-size 가 `auto` 이고 34곳이 여전히
 *  44 미만이다 — **밀도가 한 톨도 안 바뀌었다**는 뜻이다.
 *
 *  배율 되나누기 실측: min-block-size 가 배율 1·1.5·2 에서 44 · 29.33 · 22px.
 */

const coarseAt = css.indexOf('@media (pointer: coarse)');
/* 이 블록은 파일의 맨 끝에 둔다 — 뒤에 다른 규칙이 붙으면 여기를 같이 고칠 것 */
const coarse = coarseAt < 0 ? '' : css.slice(coarseAt);

t('**`pointer: coarse` 다 — `any-pointer` 가 아니다.** 마우스 쓰는 사람의 밀도를 지킨다', () => {
  assert.ok(coarseAt > 0, '(pointer: coarse) 블록이 없다');
  assert.ok(!/@media \(any-pointer: coarse\)/.test(css),
    'any-pointer 를 쓴다 — 트랙패드로 쓰는 2-in-1 에서도 단추가 커진다');
});

t('**44px 을 배율로 되나눈다** — 안 나누면 배율 2 에서 단추가 88px 이 된다', () => {
  const sizes = [...coarse.matchAll(/(?:min-)?(?:block|inline)-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 3, `크기를 정하는 줄을 ${sizes.length}줄만 찾았다`);
  for (const v of sizes) {
    assert.match(v, /calc\(44px \/ var\(--z, 1\)\)/,
      `${v} — calc(44px / var(--z, 1)) 이 아니다`);
  }
});

t('`--z` 에 기본값 1 이 있다 — 없으면 마운트 전 한 틱에 calc 이 통째로 무효가 된다', () => {
  for (const m of coarse.matchAll(/var\(--z[^)]*\)/g)) {
    assert.match(m[0], /var\(--z, 1\)/, `${m[0]} — 기본값이 없다`);
  }
});

t('슬라이더는 **높이를 직접 준다** — range 는 min-height 가 안 먹는다', () => {
  assert.match(coarse, /input\[type="range"\]\s*\{\s*block-size:/,
    'range 에 block-size 를 안 준다 — UA 기본 12~21px 로 남는다');
});

t('아이콘만 있는 단추는 **폭도** 깐다 — 15×15 짜리 휴지통이 여럿 있었다', () => {
  assert.match(coarse, /button:has\(> svg:only-child\)/, '아이콘 단추를 안 가른다');
  assert.match(coarse, /min-inline-size/, '폭을 안 깐다');
});

t('글자 있는 단추의 **폭은 안 건드린다** — 좁은 줄의 배치가 무너진다', () => {
  const generic = coarse.slice(0, coarse.indexOf('button:has('));
  assert.ok(!/min-inline-size/.test(generic),
    '모든 단추에 폭을 깔았다 — 구역 목록과 오더 한 줄이 무너진다');
});

t('**hover 로만 나타나던 것을 손가락에도 보여 준다** — 크기가 아니라 닿을 수 없던 문제', () => {
  assert.match(coarse, /\[data-touch-show\]/, 'CSS 에 표시를 읽는 규칙이 없다');
  const lib = libSrc;
  assert.match(lib, /data-touch-show=""/, '라이브러리 삭제 단추에 표시가 없다');
  const at = lib.indexOf('data-touch-show=""');
  assert.match(lib.slice(at, at + 400), /group-hover:block/,
    '표시를 붙인 자리가 hover 로만 나타나는 그 단추가 아니다');
});

t('숨긴 파일 고르개는 빼 둔다 — 안 보이는 것에 크기를 주는 것은 뜻이 없다', () => {
  assert.match(coarse, /input:not\(\[type="file"\]\)/, 'file 을 안 뺐다');
});
