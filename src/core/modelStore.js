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

function buildSpec(key, gltf, opts = {}) {
  const scene = gltf.scene ?? gltf.scenes[0];
  scene.updateMatrixWorld(true);

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

/** URL 또는 ArrayBuffer 로 모델을 로드한다. 같은 key 는 한 번만 로드. */
export function loadModel(key, { url = null, buffer = null, axis = null } = {}) {
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;

  const entry = { status: 'loading', spec: null, error: null };
  const promise = new Promise((resolve, reject) => {
    const onDone = (gltf) => {
      try {
        entry.spec = buildSpec(key, gltf, { axis });
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
      loadModel(key, { url: item.url, buffer: item.buffer, axis: item.axis }).catch(() => {});
    }
  }, [key, item?.url, item?.buffer, item?.axis]);

  if (!key) return null;
  return getSpec(key);
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
