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

const LAYOUT_KEY = 'egis.factory.layout.v1';
const LIB_KEY = 'egis.factory.userlib.v1';
const THEME_KEY = 'egis.factory.appearance';
const DB_NAME = 'egis-factory';
const STORE = 'models';

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

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
