/**
 * =============================================================================
 *  테마 — 라이트 / 다크
 * =============================================================================
 *  UI 색은 CSS 변수(index.css)로 두고 여기서는 만지지 않는다. 클래스 문자열을
 *  테마별로 두 벌 들고 다니면 어느 한쪽만 고치는 사고가 반드시 생기기 때문에,
 *  화면 쪽은 `bg-panel` `text-ink` 처럼 의미 이름 하나만 쓰고 색은 루트의
 *  data-theme 이 결정한다.
 *
 *  반면 3D 씬 색은 three.js 로 넘어가는 실제 값이라 CSS 변수를 쓸 수 없다.
 *  그래서 씬에 필요한 값만 이 파일에서 자바스크립트 값으로 관리한다.
 * ---------------------------------------------------------------------------
 */

export const APPEARANCE = { DARK: 'dark', LIGHT: 'light' };

export const SCENE_THEME = {
  dark: {
    bg: '#070b14',
    fog: [90, 320],
    floor: '#0d1526',
    floorRoughness: 1,
    gridCell: '#1e3a5f',
    gridSection: '#2f5f9e',
    bounds: '#334155',
    /* 조명 — 어두운 배경에서는 모델이 묻히지 않게 대비를 준다 */
    hemiSky: '#dbeafe',
    hemiGround: '#0f172a',
    hemiTop: 1.4,
    hemiIso: 0.9,
    ambientTop: 0.7,
    ambientIso: 0.35,
    keyTop: 1.1,
    keyIso: 1.6,
    fill: 0.35,
    /* 하이라이트 — 어두운 바닥 위라 밝은 톤이 잘 보인다 */
    select: '#38bdf8',
    ghostOk: '#22d3ee',
    ghostBad: '#f43f5e',
    fillOpacity: 0.22,
  },
  light: {
    bg: '#dde5ee',
    fog: [120, 400],
    floor: '#eef2f7',
    floorRoughness: 0.95,
    gridCell: '#b6c4d6',
    gridSection: '#7f9bbd',
    bounds: '#94a3b8',
    /* 밝은 배경에서는 전체 광량을 올리고 그림자 대비를 낮춘다.
       다크 값 그대로 쓰면 모델이 배경보다 어두워져 실루엣만 남는다. */
    hemiSky: '#ffffff',
    hemiGround: '#c7d2de',
    hemiTop: 1.7,
    hemiIso: 1.2,
    ambientTop: 0.95,
    ambientIso: 0.6,
    keyTop: 1.0,
    keyIso: 1.35,
    fill: 0.45,
    /* 밝은 바닥 위에서는 파스텔 톤이 날아가므로 한 단계 진하게 */
    select: '#0284c7',
    ghostOk: '#0891b2',
    ghostBad: '#e11d48',
    fillOpacity: 0.3,
  },
};

export const sceneTheme = (appearance) => SCENE_THEME[appearance] ?? SCENE_THEME.dark;
