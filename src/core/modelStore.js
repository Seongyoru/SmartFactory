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
 *  조립(BOM)을 하려면 "A 2개 + B 1개 → C 1개" 처럼 반송물이 최소 셋은 있어야
 *  한다. 그런데 모델러가 준 반송물 GLB 는 둘뿐이다. 종류를 하나 더 만들자고
 *  모델을 새로 그리라고 할 일은 아니라서, **같은 형상을 색만 바꿔** 쓴다.
 *
 *  캐시 키가 URL 과 따로 놀 수 있다는 점을 그대로 이용한다 — 키를 다르게 주면
 *  같은 파일을 한 번 더 읽어 **독립된 재질**을 가진 사본이 생긴다. 재질을
 *  공유하지 않으므로 한쪽을 물들여도 다른 쪽 색이 따라 변하지 않는다.
 *  (반송물은 24 KB · 256² 라 사본 하나가 늘어도 비용이 사실상 없다)
 *
 *  색은 텍스처에 **곱해진다.** 그래서 밑바탕이 밝은 회색인 모델에서만 뜻대로
 *  나온다 — 노란 모델을 빨갛게 물들이면 탁한 주황이 될 뿐이다. 새 종류를 만들
 *  때는 회색 모델(OBJ_1)을 밑바탕으로 삼을 것.
 */
function applyTint(scene, tint) {
  const color = new THREE.Color(tint);
  scene.traverse((n) => {
    if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
    n.material = n.material.clone();
    n.material.color = color.clone();
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
 * URL 또는 ArrayBuffer 로 모델을 로드한다. 같은 key 는 한 번만 로드.
 *  @param merge 재질이 같은 조각들을 한 메시로 합칠지 (mergeByMaterial 참고).
 *               이름으로 찾는 노드가 없는 모델에만 켤 것.
 *  @param tint  같은 파일을 색만 바꿔 쓸 때의 색 (applyTint 참고). 이때 key 는
 *               URL 과 달라야 원본과 따로 캐시된다.
 */
export function loadModel(key, { url = null, buffer = null, axis = null, merge = false, tint = null } = {}) {
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;

  const entry = { status: 'loading', spec: null, error: null };
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
    else loader.load(url ?? key, onDone, undefined, onErr);
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
    if (!cache.has(key)) {
      loadModel(key, {
        url: item.url, buffer: item.buffer, axis: item.axis, merge: item.merge, tint: item.tint,
      }).catch(() => {});
    }
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
