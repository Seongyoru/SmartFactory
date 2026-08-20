/**
 * =============================================================================
 *  진짜 모델을 화면 없이 읽는다
 * =============================================================================
 *  설비 포트는 GLB 안의 노드 이름(`PORT_IN@Z+`)에서 나온다. 그래서 모델이 없으면
 *  `portsOf` 가 빈 배열을 돌려주고, 정차역 검사는 선반·적치대(형상이 코드에 있는
 *  것)까지밖에 못 갔다. **설비 유입부에 카트가 내려놓는 라인**은 값으로 확인할
 *  길이 없었다 — 인수인계 문서에 「끝까지 못 봤다」로 남아 있던 항목이 그것이다.
 *
 *  그런데 GLTFLoader 는 Node 에서 그냥 돈다. 막고 있던 것은 딱 하나였다.
 *
 *      globalThis.self = globalThis      ← three 의 워커 감지가 self 를 읽는다
 *
 *  텍스처만 못 읽고(경고 한 줄) 노드 이름·좌표·바운딩 박스는 전부 나온다. 검사가
 *  보는 것은 그쪽이라 충분하다. 이제 도면을 **실제 모델 치수로** 세워 돌릴 수 있다.
 * ---------------------------------------------------------------------------
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SRC } from './_harness.mjs';

globalThis.self = globalThis;

const M = await import(SRC + 'core/modelStore.js');
export const LIB = await import(SRC + 'data/library.js');

/** 라이브러리 항목 id → 항목 */
export const itemOf = (id) => LIB.BUILTIN_LIBRARY.find((i) => i.id === id) ?? null;

const loaded = new Set();

/**
 * 이 항목들의 GLB 를 캐시에 올린다. 파일이 없으면 **조용히 넘어간다** —
 * 선반처럼 절차적 대안이 있는 것이 있고, 없는 파일 때문에 검사 전체가
 * 멈추면 안 된다. 그 대신 올라간 것만 돌려준다.
 */
export async function loadModels(ids) {
  const ok = [];
  for (const id of ids) {
    const item = itemOf(id);
    if (!item?.modelKey) continue;
    if (loaded.has(item.modelKey)) { ok.push(id); continue; }
    try {
      const buf = await readFile(path.join(ROOT, 'public', item.modelKey));
      await M.loadModel(item.modelKey, {
        ...M.modelOptions(item),
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      });
      loaded.add(item.modelKey);
      ok.push(id);
    } catch { /* 파일이 없거나 못 읽었다 — 그 항목만 건너뛴다 */ }
  }
  return ok;
}

export const specOf = (id) => M.getSpec(itemOf(id)?.modelKey ?? '');
