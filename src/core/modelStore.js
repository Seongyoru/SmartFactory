/**
 * =============================================================================
 *  모델 캐시 — GLB 로드 · 분석 · 공유
 * =============================================================================
 *  drei 의 useGLTF 를 쓰지 않고 직접 로더를 돌린다. 이유:
 *   - 사용자가 올린 GLB(ArrayBuffer)도 같은 경로로 다뤄야 한다.
 *   - 로드 직후 포트 추출/바운딩 박스 계산을 한 번만 하고 결과를 공유해야
 *     충돌 판정·풋프린트 표시 같은 R3F 밖 로직에서도 즉시 쓸 수 있다.
 *
 *  캐시는 URL(또는 사용자 모델 id) 하나당 "원본 씬 1개". 화면에 놓을 때마다
 *  clone 해서 쓴다. 원본은 절대 건드리지 않는다.
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useEffect, useState } from 'react';
import { analyzeConnector, analyzeModel } from './ports.js';

const loader = new GLTFLoader();

/**
 * 앱이 놓인 자리를 앞에 붙인다.
 * ---------------------------------------------------------------------------
 *  라이브러리의 모델 주소는 `/models/Machine_1.glb` 처럼 **뿌리에서** 시작한다.
 *  앱이 뿌리에 있으면 맞지만 `…/SmartFactory/` 같은 하위 경로에 올리면 뿌리로
 *  새어 나가 전부 404 가 된다 — 설비 모델이 하나도 안 뜬다.
 *
 *  뿌리에서 시작하는 것만 손댄다. 올린 파일의 `blob:`, 캐시 열쇠로 쓰는 이름은
 *  주소가 아니므로 그대로 둔다.
 *
 *  `import.meta.env` 는 Vite 가 채워 준다. 검사는 Node 로 곧장 부르므로 그것이
 *  없다 — 그때는 `/` 로 두어 지금까지와 똑같이 동작한다.
 */
export const withBase = (base, p) =>
  (typeof p === 'string' && p.startsWith('/')
    ? String(base ?? '/').replace(/\/$/, '') + p
    : p);

const BASE = import.meta.env?.BASE_URL ?? '/';
const atBase = (p) => withBase(BASE, p);

/** key → { status, spec, error, promise } */
const cache = new Map();
const listeners = new Set();

const notify = () => listeners.forEach((l) => l());

export function subscribeModels(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * =============================================================================
 *  메시 합치기 — 재질이 같은 조각을 한 덩어리로
 * =============================================================================
 *  같은 모델이 화면에 수십 개씩 뜨는 것들이 있다. 벨트 위를 흐르는 반송물은 벨트
 *  하나에 최대 60개, 적치대·선반에도 쌓인다. 그런데 모델러가 물건 하나를 여러
 *  조각(프리미티브)으로 내보내면 GLTFLoader 가 조각마다 메시를 만든다 — 조각이
 *  6개면 **물건 하나가 드로우콜 6번**이고, 벨트 하나에 360번이 된다.
 *
 *  재질이 같으면 그 조각들은 화면에서 구분되지 않는다. 합쳐도 그림은 똑같고
 *  드로우콜만 조각 수만큼 줄어든다. 정점 수는 그대로라 메모리도 그대로다.
 *
 *  ── 아무 모델에나 걸지 않는다 ─────────────────────────────────────────────
 *  합치면 **노드 이름과 계층이 사라진다.** 이 프로젝트는 이름으로 찾는 것이 많다
 *  — 포트 마커(`PORT_IN@Z+`), 컨베이어의 벨트 메시(`*Belt*`), 카트 안의 적재물
 *  노드(`OBJ`). 그래서 라이브러리 항목이 `merge: true` 라고 **말한 모델만** 합친다.
 *
 *  아래 경우에는 스스로 물러난다(합치지 않고 원본을 쓴다).
 *    · 스킨·모프·인스턴스 메시 — 정점이 뼈대나 표정에 매여 있어 구울 수 없다
 *    · 애니메이션이 있는 모델 — 노드가 움직이므로 월드 변환을 못 굽는다
 *    · 재질이 배열인 메시, 정점 속성 구성이 서로 다른 조각 — 합치면 깨진다
 */
function mergeByMaterial(scene) {
  scene.updateMatrixWorld(true);

  const meshes = [];
  let blocked = false;
  scene.traverse((n) => {
    if (!n.isMesh) return;
    if (n.isSkinnedMesh || n.isInstancedMesh || n.morphTargetInfluences?.length) blocked = true;
    if (!n.material || Array.isArray(n.material)) blocked = true;
    meshes.push(n);
  });
  if (blocked || meshes.length < 2) return null;

  /* 재질별로 모으고, 각 조각의 지오메트리에 월드 변환을 구워 넣는다.
     (합친 뒤에는 부모 계층이 없어지므로 위치를 지오메트리가 들고 있어야 한다) */
  const groups = new Map();
  const clones = [];
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    clones.push(g);
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(g);
  }

  /* 한 재질 안에서 속성 구성이 갈리면 합칠 수 없다 — mergeGeometries 가 null 을
     주는데, 그때는 만들던 것을 전부 버리고 조용히 원본을 쓴다
     (모양이 깨지는 것보다 드로우콜이 많은 편이 낫다) */
  const out = new THREE.Group();
  out.name = scene.name || 'merged';
  for (const [material, list] of groups) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) {
      out.traverse((n) => n.geometry?.dispose());
      clones.forEach((g) => g.dispose());
      return null;
    }
    if (merged !== list[0]) list.forEach((g) => g.dispose());
    out.add(new THREE.Mesh(merged, material));
  }

  /* 원본 조각의 지오메트리는 이제 아무도 안 쓴다 (재질은 합친 메시가 계속 쓴다) */
  for (const m of meshes) m.geometry.dispose();
  return out;
}

/**
 * =============================================================================
 *  색만 다른 변형 — 모델 하나로 여러 종류를 만든다
 * =============================================================================
 *  반송물은 종류가 여럿인데 모델러가 준 GLB 는 몇 개뿐이다. 종류를 늘리자고
 *  모델을 새로 그리라고 할 일은 아니라서, **같은 형상을 색만 바꿔** 쓴다.
 *
 *  캐시 키가 URL 과 따로 놀 수 있다는 점을 그대로 이용한다 — 키를 다르게 주면
 *  같은 파일을 한 번 더 읽어 **독립된 재질**을 가진 사본이 생긴다. 재질을
 *  공유하지 않으므로 한쪽을 물들여도 다른 쪽 색이 따라 변하지 않는다.
 *  (반송물은 24 KB · 256² 라 사본 하나가 늘어도 비용이 사실상 없다)
 *
 *  ── 곱하기만 해서는 지정한 색이 안 나온다 ────────────────────────────────
 *  three 의 `material.color` 는 텍스처에 **곱해진다.** 밑바탕이 회색이면 뜻대로
 *  나오지만, 노란 텍스처(Assembly.glb 는 평균 #dddf22 다)에 청록을 곱하면 초록이
 *  되고 자홍을 곱하면 빨강이 된다 — 고른 색과 화면의 색이 다르면 목록의 색
 *  견본이 거짓말을 하게 되고, 그 견본은 "저 벨트 위의 것이 무엇인가" 를 읽는
 *  유일한 단서다.
 *
 *  그래서 **밑바탕을 회색으로 만든 뒤에** 곱한다(`neutralize`). 무늬와 음영은
 *  그대로 남고 색만 없어지므로, 어떤 모델을 가져와도 고른 색 그대로 나온다.
 */

/** 중립화한 텍스처의 목표 평균 밝기 — 곱했을 때 색이 죽지 않을 만큼 */
const TINT_BASE = 0.82;

/**
 * 텍스처에서 색을 빼고 밝기를 맞춘다.
 * ---------------------------------------------------------------------------
 *  밝기까지 맞추는 이유는 **모델끼리 견줄 수 있어야** 하기 때문이다. 회색
 *  텍스처(평균 0.60)와 노란 텍스처(휘도 0.82)를 그냥 회색으로만 바꾸면, 같은
 *  빨강을 줘도 한쪽은 어둡고 한쪽은 밝게 나온다 — 화면에서 같은 색으로 안 읽힌다.
 *
 *  캔버스로 한 번 굽고 새 텍스처를 만든다. 256² 짜리라 한 종류당 한 번이면 되고,
 *  결과는 모델 캐시에 그대로 얹힌다.
 */
function neutralize(map) {
  const img = map?.image;
  if (!img?.width || !img?.height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  let data;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;                       // 다른 출처의 이미지면 읽을 수 없다 — 원본을 쓴다
  }

  /* 1차: 휘도로 바꾸면서 평균을 잰다 */
  const p = data.data;
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) {
    const y = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    p[i] = p[i + 1] = p[i + 2] = y;
    sum += y;
  }
  const mean = sum / (p.length / 4);

  /* 2차: 평균을 목표에 맞춰 올린다(내린다). 흰 쪽은 255 에서 잘린다 */
  const scale = mean > 1 ? (TINT_BASE * 255) / mean : 1;
  if (Math.abs(scale - 1) > 0.01) {
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.min(255, p[i] * scale);
      p[i] = p[i + 1] = p[i + 2] = v;
    }
  }
  ctx.putImageData(data, 0, 0);

  /* 원본의 샘플링 설정을 그대로 옮긴다. flipY 를 안 옮기면 무늬가 뒤집힌다
     (GLTFLoader 는 flipY = false 로 읽는다), colorSpace 를 안 옮기면 색이 뜬다 */
  const out = new THREE.CanvasTexture(canvas);
  out.flipY = map.flipY;
  out.colorSpace = map.colorSpace;
  out.wrapS = map.wrapS;
  out.wrapT = map.wrapT;
  out.repeat.copy(map.repeat);
  out.offset.copy(map.offset);
  out.channel = map.channel ?? 0;
  out.needsUpdate = true;
  return out;
}

function applyTint(scene, tint) {
  const color = new THREE.Color(tint);
  /* 같은 재질을 쓰는 메시가 여럿이면 한 번만 굽는다 */
  const done = new Map();
  scene.traverse((n) => {
    if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
    const src = n.material;
    let next = done.get(src);
    if (!next) {
      next = src.clone();
      if (src.map) next.map = neutralize(src.map) ?? src.map;
      next.color = color.clone();
      done.set(src, next);
    }
    n.material = next;
  });
}

function buildSpec(key, gltf, opts = {}) {
  let scene = gltf.scene ?? gltf.scenes[0];
  scene.updateMatrixWorld(true);

  /* 조각난 모델을 한 덩어리로 (라이브러리 항목이 요청했을 때만).
     애니메이션이 있으면 노드가 움직이므로 월드 변환을 구울 수 없다. */
  if (opts.merge && !(gltf.animations?.length)) {
    const merged = mergeByMaterial(scene);
    if (merged) scene = merged;
  }

  /* 색 변형은 합치기 **뒤**에 건다 — 합치기는 재질이 같은 조각을 한 덩어리로
     모으는 일이라, 먼저 물들이면 재질이 갈려 합칠 것이 없어진다. */
  if (opts.tint) applyTint(scene, opts.tint);

  /* CAD 익스포트는 얇은 판재가 많아 뒷면이 뚫려 보인다. 양면 렌더로 고정.
     머티리얼이 없는 모델(테스트 모델처럼)에는 기본 회색 재질을 물려 준다. */
  scene.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    n.receiveShadow = true;
    if (!n.material || Array.isArray(n.material)) return;
    n.material.side = THREE.DoubleSide;
  });

  const analysis = analyzeModel(scene);
  const spec = {
    key,
    scene,
    animations: gltf.animations ?? [],
    ...analysis,
    connector: analyzeConnector(analysis, { axis: opts.axis }),
  };
  return spec;
}

/**
 * 항목 하나를 로드 옵션으로 바꾼다.
 * ---------------------------------------------------------------------------
 *  **부르는 곳마다 손으로 골라 넘기지 않기 위해서다.** 예전에는 네 군데가 각자
 *  `{ url, axis, merge }` 를 적어 넘겼는데, 그중 한 곳(App 의 프리로드)이 `tint`
 *  를 빠뜨렸다. 그 한 곳이 **먼저** 캐시를 채우면 뒤에 제대로 넘긴 호출은 아래
 *  `hit.promise` 에 걸려 통째로 무시된다 — 반송물이 전부 원본 색으로 나왔고,
 *  코드는 어디도 틀린 데가 없어 보였다.
 *
 *  옵션을 만드는 곳을 하나로 두면 항목에 필드를 더해도 부르는 곳을 안 고쳐도 된다.
 */
export const modelOptions = (item) => ({
  url: item?.url ?? null,
  buffer: item?.buffer ?? null,
  axis: item?.axis ?? null,
  merge: !!item?.merge,
  tint: item?.tint ?? null,
});

/** 같은 키를 다른 옵션으로 불렀는지 가리기 위한 지문 (buffer 는 키가 이미 고유하다) */
const optionSig = ({ url, axis, merge, tint }) => `${url ?? ''}|${axis ?? ''}|${merge ? 1 : 0}|${tint ?? ''}`;

/**
 * URL 또는 ArrayBuffer 로 모델을 로드한다. 같은 key 는 한 번만 로드.
 *  @param merge 재질이 같은 조각들을 한 메시로 합칠지 (mergeByMaterial 참고).
 *               이름으로 찾는 노드가 없는 모델에만 켤 것.
 *  @param tint  같은 파일을 색만 바꿔 쓸 때의 색 (applyTint 참고). 이때 key 는
 *               URL 과 달라야 원본과 따로 캐시된다.
 */
export function loadModel(key, { url = null, buffer = null, axis = null, merge = false, tint = null } = {}) {
  const sig = optionSig({ url, axis, merge, tint });
  const hit = cache.get(key);
  if (hit?.promise) {
    /* 먼저 부른 쪽이 이긴다 — 그 사실을 조용히 넘기면 "색이 안 먹네" 로만 보이고
       코드에서는 아무 데도 틀린 곳을 못 찾는다. 어긋난 순간에 말하게 한다. */
    if (hit.sig !== sig) {
      console.warn(
        `[modelStore] "${key}" 를 서로 다른 옵션으로 두 번 불렀습니다 — 먼저 부른 쪽이 남습니다.\n` +
        `  캐시: ${hit.sig}\n  요청: ${sig}\n` +
        '  (옵션은 modelOptions(item) 으로 만들어 넘기세요)',
      );
    }
    return hit.promise;
  }

  const entry = { status: 'loading', spec: null, error: null, sig };
  const promise = new Promise((resolve, reject) => {
    const onDone = (gltf) => {
      try {
        entry.spec = buildSpec(key, gltf, { axis, merge, tint });
        entry.status = 'ready';
        notify();
        resolve(entry.spec);
      } catch (e) {
        entry.status = 'error';
        entry.error = e;
        notify();
        reject(e);
      }
    };
    /* 파일이 없어도 되는 모델(선반처럼 절차적 대안이 있는 것)은 실패해도
       그냥 'error' 로 두고 넘어간다. 호출부가 상태를 보고 대안을 그린다. */
    const onErr = (e) => {
      entry.status = 'error';
      entry.error = e;
      notify();
      reject(e);
    };
    if (buffer) loader.parse(buffer, '', onDone, onErr);
    else loader.load(atBase(url ?? key), onDone, undefined, onErr);
  });
  entry.promise = promise;
  cache.set(key, entry);
  notify();
  return promise;
}

export const getSpec = (key) => cache.get(key)?.spec ?? null;

/**
 * 이미 로드된 모델의 연결장치 해석을 다시 한다 (흐름축을 바꿀 때).
 *  길이축이 바뀌면 타일링 방향과 메시 썰기 방향이 통째로 달라지므로
 *  구워 둔 파트 캐시를 버려야 한다.
 */
export function retuneConnector(key, opts) {
  const spec = getSpec(key);
  if (!spec) return null;
  spec.connector = analyzeConnector(spec, opts);
  delete spec.__parts;
  delete spec.__sliced;
  notify();
  return spec;
}
export const getStatus = (key) => cache.get(key)?.status ?? 'idle';
export const dropModel = (key) => { cache.delete(key); notify(); };

/**
 * 라이브러리 항목의 모델 규격을 얻는 훅.
 *  아직 로드 전이면 로드를 걸고 null 을 돌려준다(호출부는 로딩 표시).
 */
export function useModelSpec(item) {
  const key = item?.modelKey ?? null;
  const [, force] = useState(0);

  useEffect(() => subscribeModels(() => force((n) => n + 1)), []);
  useEffect(() => {
    if (!key) return;
    if (!cache.has(key)) loadModel(key, modelOptions(item)).catch(() => {});
  }, [key, item?.url, item?.buffer, item?.axis, item?.merge, item?.tint]);

  if (!key) return null;
  return getSpec(key);
}

/** 모델을 못 구했는지 (없어도 되는 모델의 대안 렌더 판단용) */
export function useModelMissing(item) {
  const key = item?.modelKey ?? null;
  const [, force] = useState(0);
  useEffect(() => subscribeModels(() => force((n) => n + 1)), []);
  return !!key && getStatus(key) === 'error';
}

/** 씬 사본. 머티리얼까지 복제할지 선택 (하이라이트/고스트용) */
export function cloneScene(spec, { cloneMaterials = false } = {}) {
  const obj = spec.scene.clone(true);
  if (cloneMaterials) {
    obj.traverse((n) => {
      if (n.isMesh && n.material && !Array.isArray(n.material)) n.material = n.material.clone();
    });
  }
  return obj;
}
