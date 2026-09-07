/**
 * 출하 누계 — **많이 나온 것이 위로**
 * ---------------------------------------------------------------------------
 *  화면 왼쪽 위에 품종별 출하 누계가 줄로 선다. 예전에는 들어온 차례대로 늘어놔서
 *  「무엇이 제일 많이 나왔나」를 눈으로 세어야 했다.
 *
 *  ── 순서가 바뀔 때 순간이동하면 안 된다 ─────────────────────────────────
 *  그냥 다시 그리면 두 줄이 툭 자리를 바꿔서 **무엇이 무엇을 제쳤는지 못 쫓는다.**
 *  옮기기 전 자리를 재 뒀다가 옛 자리로 되돌려 놓고 다음 프레임에 푸는 방식
 *  (FLIP)으로 미끄러뜨린다.
 *
 *  실측(창 1280×720):
 *      제작품2 9 · 제작품1 3 · 제작품3 1  →  제작품3 에 20 을 더하면
 *      21 · 9 · 3 으로 다시 서고, 그때 translateY 가 58.5 / −29.25 / −29.25
 *      배율 2 에서도 **같은 58.5** 다 — 안 나눴으면 117 이 나온다
 */
import assert from 'node:assert/strict';
import { group, readSrc, t } from './_harness.mjs';

group('출하 누계');

const app = await readSrc('App.jsx');

/* 훑을 자리를 먼저 떼어 둔다 — 파일 다른 데의 비슷한 글자에 속지 않게 */
const hudAt = app.indexOf('function ShippedHUD(');
const hud = app.slice(hudAt, app.indexOf('\nfunction ', hudAt + 10));
const flipAt = app.indexOf('function useSlideOrder(');
const flip = app.slice(flipAt, app.indexOf('\nfunction ', flipAt + 10));

t('떼어 낸 자리가 맞다 — 아래 검사가 헛것을 보고 있지 않다', () => {
  assert.ok(hudAt > 0 && hud.length > 400, 'ShippedHUD 를 못 찾았다');
  assert.ok(flipAt > 0 && flip.length > 300, 'useSlideOrder 를 못 찾았다');
});

t('**많은 것이 위로 선다** — 들어온 차례가 아니다', () => {
  const m = hud.match(/\.sort\(\(a, b\) => ([^)]+)\)/);
  assert.ok(m, '정렬을 안 한다');
  assert.match(m[1], /b\[1\] - a\[1\]/, '오름차순이거나 개수로 안 센다');
});

t('같은 값이면 **이름으로 갈라 둔다** — 안 그러면 매 틱 순서가 떨린다', () => {
  assert.match(hud, /b\[1\] - a\[1\] \|\| a\[0\]\.localeCompare\(b\[0\]\)/,
    '동점일 때 순서가 안 정해져 있다');
});

/* ── 미끄러짐 ─────────────────────────────────────────────────────────── */

t('순서가 바뀌면 **미끄러진다** — 순간이동하면 뭐가 뭘 제쳤는지 못 쫓는다', () => {
  assert.match(hud, /useSlideOrder\(kinds\.map\(\(\[k\]\) => k\)\.join\('\|'\)\)/,
    'HUD 가 순서를 미끄러짐에 안 넘긴다');
  assert.match(hud, /ref=\{\(el\) => \{ if \(el\) slide\.current\.set\(kind, el\)/,
    '줄을 붙잡아 두지 않는다 — 잴 대상이 없다');
  assert.match(hud, /else slide\.current\.delete\(kind\)/,
    '사라진 줄을 안 놓아 준다 — 지도에 유령이 쌓인다');
});

t('**옮길 거리를 배율로 나눈다** — 안 나누면 배율 2 에서 두 배로 미끄러진다', () => {
  assert.match(flip, /\(was - is\) \/ zoomOf\(el\)/,
    'rect(배율 곱해진 값)를 transform(안 곱해진 값)에 그대로 넣는다');
  assert.match(app, /import \{ zoomOf \} from '\.\/core\/uiScale\.js'/, 'zoomOf 를 안 들여왔다');
});

t('**다음 프레임에 푼다** — 같은 프레임에 풀면 아무 일도 없던 것처럼 보인다', () => {
  assert.match(flip, /requestAnimationFrame\(\(\) => \{/, '한 프레임 기다리지 않는다');
  const at = flip.indexOf('requestAnimationFrame');
  const body = flip.slice(at, at + 220);
  assert.match(body, /transition = 'transform/, '푸는 자리에서 전이를 안 건다');
  assert.match(body, /transform = ''/, '되돌려 놓은 것을 안 푼다');
  /* 되돌릴 때는 전이가 없어야 한다 — 있으면 되돌아가는 것까지 보인다.
     **있는지부터 본다.** `indexOf` 는 없으면 −1 을 주는데, 그냥 `< at` 로만
     견주면 그 −1 이 조건을 통과시킨다 — 지워도 안 무는 검사가 된다(당했다). */
  const off = flip.indexOf("transition = 'none'");
  assert.ok(off >= 0, '옛 자리로 되돌릴 때 전이를 안 껐다 — 되돌아가는 것까지 보인다');
  assert.ok(off < at, '전이를 끄는 자리가 푸는 자리보다 뒤에 있다');
});

t('아주 작은 움직임은 건너뛴다 — 반올림 찌꺼기로 매번 떨면 안 된다', () => {
  assert.match(flip, /Math\.abs\(dy\) < 0\.5/, '문턱이 없다');
});

t('**손이 덜 가는 화면을 원하면 안 움직인다** — 자리만 바꿔 준다', () => {
  assert.match(flip, /prefers-reduced-motion: reduce/, '설정을 안 본다');
  assert.match(flip, /if \(!still\)/, '설정을 읽어 놓고 안 쓴다');
});

t('잰 자리를 다음 번을 위해 남긴다 — 안 남기면 두 번째부터 안 움직인다', () => {
  assert.match(flip, /prev\.current = now;/, '이번에 잰 자리를 안 남긴다');
});

t('**높이를 px 로 박지 않는다** — 배율과 글꼴에 따라 줄 높이가 달라진다', () => {
  assert.ok(!/ROW_H|rowHeight|24px|29px/.test(flip), '줄 높이를 박아 두었다');
  assert.match(flip, /getBoundingClientRect\(\)\.top/, '자리를 재지 않는다');
});
