/**
 * =============================================================================
 *  저장 — 레이아웃(localStorage) · 사용자 모델(IndexedDB)
 * =============================================================================
 *  GLB 는 수 MB 가 되기도 해서 localStorage(5MB 한도, 문자열만)에 넣을 수 없다.
 *  그래서 두 곳으로 나눈다.
 *    localStorage : 배치 결과 + 사용자 모델의 "메타데이터"(이름/분류)
 *    IndexedDB    : 사용자 모델의 GLB 바이너리
 *  둘의 연결고리는 사용자 모델 id 다.
 * ---------------------------------------------------------------------------
 */

const LAYOUT_KEY = 'factory.layout.v1';
const LIB_KEY = 'factory.userlib.v1';
const THEME_KEY = 'factory.appearance';
const GUIDE_KEY = 'factory.guide.v1';
const SCENARIO_KEY = 'factory.scenarios.v1';
const DB_NAME = 'factory';
const STORE = 'models';

/* 저장 키가 바뀌면 **그 전에 저장해 둔 도면은 안 읽힌다.** 옮겨 오는 코드를 두는
   쪽도 있었지만, 그러면 키를 두 벌 들고 다니게 된다 — 「어느 쪽이 진짜인가」가
   늘 따라붙는다. 남은 데이터는 브라우저의 사이트 데이터 지우기로 정리하면 된다. */

/**
 * 저장할 도면 한 벌.
 * ---------------------------------------------------------------------------
 *  자동 저장 · 수동 저장 · 파일 내보내기 세 군데가 각자 객체를 만들다가
 *  카트를 빠뜨린 적이 있다. 저장 대상이 늘어날 때 한 곳만 고치면 되도록
 *  여기로 모은다.
 */
export const layoutSnapshot = (state) => ({
  placed: state.placed,
  links: state.links,
  carts: state.carts,
  areas: state.areas,
  walls: state.walls,
  pillars: state.pillars,
  zones: state.zones,
  openings: state.openings,
  /** 교대조 — 배치와 함께 저장한다. 인원이 몇 명인지는 그 도면의 성질이다 */
  shifts: state.shifts,
  /** 생산 오더 — 「무엇을 몇 개, 언제까지」. 이것도 그 도면에 딸린 계획이다 */
  orders: state.orders,
  /**
   * 기본 벨트 속도 — **도면의 성질이다.** 자기 속도를 따로 정하지 않은 벨트가
   * 전부 이 값으로 돌고, 이제는 **덩어리 간격까지 여기서 나온다**(process.js 의
   * spacingFor). 저장을 안 하면 새로고침할 때마다 0.6 으로 돌아가는데, 간격은
   * 설비에 저장돼 그대로 남아서 **아무것도 안 건드렸는데 처리량이 바뀐다.**
   */
  beltSpeed: state.beltSpeed,
  /** 단가 — 전기·인건비·자재비. 공장마다 다르니 **그 도면에 딸린 값**이다 */
  rates: state.rates,
  seq: state.seq,
});

/* ---- localStorage ------------------------------------------------------- */

export function saveLayout(data) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('레이아웃 저장 실패', e);
    return false;
  }
}

export function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveUserLibrary(items) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn('사용자 라이브러리 저장 실패', e);
  }
}

export function loadUserLibrary() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 화면 테마.
 *  저장된 값이 없으면 OS 설정을 따른다 — 첫 실행에서 눈부시거나 캄캄한 화면이
 *  뜨는 걸 막는다. 한 번이라도 직접 고르면 그 선택이 우선한다.
 */
export function loadAppearance() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* 무시 */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function saveAppearance(value) {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch { /* 무시 */ }
}

/**
 * 따라 하기 안내가 어디까지 왔는가 — 'welcome' · 'steps' · null(닫힘).
 * ---------------------------------------------------------------------------
 *  환영 창은 **처음 여는 브라우저에만** 띄운다. 두 번째부터도 뜨면 성가시다.
 *  체크리스트는 닫기 전까지 남는다 — 따라 하는 도중에 새로고침했다고 안내가
 *  사라지면, 그때가 하필 제일 아쉬운 순간이다.
 *
 *  **도면이 아니라 이 브라우저의 습관**이라 레이아웃과 따로 둔다. 도면을
 *  불러오거나 초기화해도 안내는 그대로다.
 *
 *  단계별 진행도는 저장하지 않는다. 그건 도면을 보면 알 수 있고(바닥이 있는가,
 *  설비가 있는가), 따로 적어 두면 도면과 어긋날 수 있다.
 */
/**
 * 저장하는 값은 **지금 어느 화면인가** 하나다 — `'welcome'` · `'pick'` ·
 * 갈래 이름(`'basics'` · `'cost'` …) · 닫힘(`'done'`).
 *
 *  안내가 갈래로 나뉘면서 값의 가짓수가 늘었다. 여기서 이름을 하나하나 알 필요는
 *  없으므로 **글자를 그대로 오간다** — 모르는 이름이 남아 있으면(옛 판이 적어 둔
 *  `'steps'` 같은 것) 화면 쪽이 고르는 창으로 돌린다.
 */
export function loadGuidePhase() {
  try {
    const v = localStorage.getItem(GUIDE_KEY);
    if (v === null) return 'welcome';          // 이 브라우저에서 처음 연다
    return v === 'done' ? null : v;            // 'done' 은 닫아 둔 것
  } catch {
    return null;
  }
}

export function saveGuidePhase(phase) {
  try {
    localStorage.setItem(GUIDE_KEY, phase ? String(phase) : 'done');
  } catch { /* 무시 */ }
}

/**
 * 시나리오 — 도면 한 벌과 그 도면으로 돌린 성적표의 짝.
 * ---------------------------------------------------------------------------
 *  **지금 도면과 따로 저장한다.** 지금 도면은 작업 중인 한 벌이고, 시나리오는
 *  비교하려고 모아 둔 여러 벌이다. 한 곳에 담으면 도면을 초기화할 때 비교 기록도
 *  함께 날아간다 — 배치를 바꿔 가며 견주는 일이 곧 초기화의 연속인데 말이다.
 */
export function saveScenarios(list) {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(list ?? []));
  } catch (e) {
    console.warn('시나리오 저장 실패', e);
  }
}

export function loadScenarios() {
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* ---- IndexedDB ---------------------------------------------------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putModelBuffer = (id, buffer) => tx('readwrite', (s) => s.put(buffer, id));
export const getModelBuffer = (id) => tx('readonly', (s) => s.get(id));
export const deleteModelBuffer = (id) => tx('readwrite', (s) => s.delete(id));

/* ---- 파일 내보내기/가져오기 --------------------------------------------- */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  /* 문서에 붙였다 뗀다 — 떨어져 있는 앵커의 click() 을 무시하는 브라우저가 있다 */
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJSON(data, filename) {
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

/**
 * 표 한 장을 CSV 로.
 * ---------------------------------------------------------------------------
 *  시나리오 JSON 은 **이 도구가 다시 읽으려고** 만드는 것이고, CSV 는 **밖으로
 *  들고 나가려고** 만드는 것이다. 성적을 보고서에 붙이거나 엑셀에서 그래프를
 *  다시 그리는 일은 JSON 으로 못 한다.
 *
 *  ── 엑셀이 한글을 깨뜨리지 않게 ──────────────────────────────────────────
 *  엑셀은 CSV 를 열 때 UTF-8 이라고 **말해 주지 않으면** 시스템 코드페이지로
 *  읽는다. 그러면 설비 이름이 통째로 깨진다. 맨 앞에 BOM(`﻿`)을 붙이는 것이
 *  그 신호다 — 한 글자로 끝나는 일이라 안 붙일 이유가 없다.
 *
 *  값 감싸기도 마찬가지다. 이름에 쉼표가 하나 들어가면 그 줄의 칸이 전부 밀린다.
 *  쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고, 안의 따옴표는 두 번 적는다(RFC 4180).
 *
 *  @param rows 첫 줄이 머리글인 2차원 배열
 */
export function downloadCSV(rows, filename) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = (rows ?? []).map((r) => r.map(cell).join(',')).join('\r\n');
  saveBlob(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }), filename);
}

/**
 * 읽는 보고서 한 장을 HTML 로.
 * ---------------------------------------------------------------------------
 *  CSV 는 **엑셀에서 다시 계산하려고** 만드는 것이라 꾸밀 수가 없다 — 표가
 *  여럿 붙어 있고 셀에 색도 못 넣는다. 회의에 들고 갈 것은 성질이 다르므로
 *  따로 만든다. 브라우저로 열면 그대로 읽히고 Ctrl+P 로 PDF 가 된다.
 */
export function downloadHTML(html, filename) {
  saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
}

/** 파일 이름에 붙일 시각 — `2026-08-12_1430` */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
