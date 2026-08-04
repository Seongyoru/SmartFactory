/**
 * =============================================================================
 *  사용자 모델 추가
 * =============================================================================
 *  GLB 를 받아서 즉시 분석해 보여 준다. 포트가 없으면 그 사실을 여기서 알려
 *  줘야 한다 — 나중에 연결이 엉뚱한 곳에 붙고 나서 원인을 찾는 것보다,
 *  등록하는 순간 "이 모델엔 유입/유출부 정의가 없다" 고 말해 주는 편이 낫다.
 * ---------------------------------------------------------------------------
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { analyzeConnector } from '../core/ports.js';
import { AlertTriangle, CheckCircle2, Upload, X } from 'lucide-react';
import { dropModel, loadModel, retuneConnector } from '../core/modelStore.js';
import { putModelBuffer } from '../core/persistence.js';
import { CATEGORY, userItem } from '../data/library.js';
import { Btn, Field } from './common.jsx';

const newId = () => `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`;

export default function ImportDialog({ defaultCategory, onClose, onAdd }) {
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null); // { id, key, name, spec, buffer }
  const [category, setCategory] = useState(defaultCategory ?? CATEGORY.EQUIPMENT);
  const [render, setRender] = useState('tile');
  const [axis, setAxis] = useState(null); // null = 자동 판정
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const id = newId();
      const key = `user:${id}`;
      const spec = await loadModel(key, { buffer });
      setPending({ id, key, spec, buffer, file });
      setName(file.name.replace(/\.(glb|gltf)$/i, ''));
    } catch (e) {
      console.error(e);
      setError('GLB 를 읽지 못했습니다. glTF 2.0 (.glb) 파일인지 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = () => {
    if (pending) dropModel(pending.key);
    onClose();
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await putModelBuffer(pending.id, pending.buffer);
      if (category === CATEGORY.CONNECTOR && axis) retuneConnector(pending.key, { axis });
      onAdd(
        userItem({
          id: pending.id,
          name: name.trim() || pending.file.name,
          category,
          render,
          axis,
        }),
      );
      onClose();
    } catch (e) {
      console.error(e);
      setError('브라우저 저장소에 모델을 넣지 못했습니다.');
      setBusy(false);
    }
  };

  const spec = pending?.spec;
  const size = spec?.bbox.size;
  /* 흐름축을 바꿔 보는 동안에는 모델을 다시 굽지 않고 해석만 다시 한다 */
  const effective = useMemo(
    () => (spec ? analyzeConnector(spec, { axis }) : null),
    [spec, axis],
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-6" onClick={cancel}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-head shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">라이브러리에 모델 추가</h2>
          <button onClick={cancel} className="text-ink4 hover:text-ink">
            <X size={16} />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {/* 파일 선택 */}
          <div
            className="cursor-pointer rounded-lg border border-dashed border-edge bg-field px-4 py-6 text-center hover:border-sky-500/60"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <Upload size={20} className="mx-auto mb-2 text-ink4" />
            <p className="text-xs text-ink3">
              {pending ? pending.file.name : 'GLB 파일을 끌어다 놓거나 클릭해서 선택'}
            </p>
            <p className="mt-1 text-[11px] text-ink4">glTF 2.0 (.glb / .gltf) · Y-up</p>
            <input
              ref={fileRef}
              type="file"
              accept=".glb,.gltf,model/gltf-binary"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500 ring-1 ring-red-500/30">{error}</p>
          )}

          {/* 분석 결과 */}
          {spec && (
            <div className="space-y-3 rounded-lg bg-field px-3 py-3 ring-1 ring-edge">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <span className="text-ink4">크기 (W×H×D)</span>
                <span className="text-ink tabular-nums">
                  {size[0].toFixed(2)} × {size[1].toFixed(2)} × {size[2].toFixed(2)} m
                </span>
                <span className="text-ink4">포트</span>
                <span className="text-ink">
                  {spec.ports.length}개 {spec.hasExplicitPorts ? '(모델 정의)' : '(자동 생성)'}
                </span>
                {category === CATEGORY.CONNECTOR && (
                  <>
                    <span className="text-ink4">1 피치 / 폭</span>
                    <span className="text-ink tabular-nums">
                      {effective.span.toFixed(2)} m / {effective.nativeWidth.toFixed(2)} m
                    </span>
                    <span className="text-ink4">흐름축</span>
                    <span className="text-ink">
                      {effective.axis.toUpperCase()}
                      <span className="ml-1 text-ink4">
                        ({{ override: '지정', ports: '포트 기준', 'belt-uv': '벨트 UV 기준', bbox: 'bbox 기준' }[effective.axisSource]})
                      </span>
                    </span>
                    <span className="text-ink4">벨트 메시</span>
                    <span className={effective.belt ? 'text-emerald-600' : 'text-ink3'}>
                      {effective.belt ? `${effective.belt.names.join(', ')} · UV 구동 가능` : '없음 (구동 안 함)'}
                    </span>
                  </>
                )}
              </div>

              {spec.hasExplicitPorts ? (
                <p className="flex items-start gap-2 text-[11px] text-emerald-600">
                  <CheckCircle2 size={13} className="mt-px shrink-0" />
                  포트 노드를 찾았습니다: {spec.ports.map((p) => p.id).join(', ')}
                </p>
              ) : (
                <p className="flex items-start gap-2 text-[11px] text-amber-600">
                  <AlertTriangle size={13} className="mt-px shrink-0" />
                  포트 정의가 없어 바운딩 박스 4방향에 자동 생성했습니다. 정확한 연결이 필요하면 모델에
                  <code className="mx-1 rounded bg-field px-1">PORT_IN</code>
                  <code className="mr-1 rounded bg-field px-1">PORT_OUT</code>
                  더미를 넣어 다시 내보내세요.
                </p>
              )}
            </div>
          )}

          {/* 메타 입력 */}
          <Field label="이름" value={name} onChange={(e) => setName(e.target.value)} placeholder="설비 이름" />

          <div>
            <span className="mb-1 block text-[11px] text-ink4">분류</span>
            <div className="flex gap-2">
              <Btn active={category === CATEGORY.EQUIPMENT} onClick={() => setCategory(CATEGORY.EQUIPMENT)}>
                설비
              </Btn>
              <Btn active={category === CATEGORY.CONNECTOR} onClick={() => setCategory(CATEGORY.CONNECTOR)}>
                연결장치
              </Btn>
            </div>
          </div>

          {category === CATEGORY.CONNECTOR && (
            <>
              <div>
                <span className="mb-1 block text-[11px] text-ink4">연장 방식</span>
                <div className="flex gap-2">
                  <Btn active={render === 'tile'} onClick={() => setRender('tile')}>
                    모델 반복 (컨베이어·레일)
                  </Btn>
                  <Btn active={render === 'tube'} onClick={() => setRender('tube')}>
                    튜브 (전선·배관)
                  </Btn>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[11px] text-ink4">
                  흐름축 <span className="text-ink4">— 자재가 흐르는 방향. 자동 판정이 틀리면 직접 지정</span>
                </span>
                <div className="flex gap-2">
                  <Btn active={axis === null} onClick={() => setAxis(null)}>자동</Btn>
                  <Btn active={axis === 'x'} onClick={() => setAxis('x')}>X축</Btn>
                  <Btn active={axis === 'z'} onClick={() => setAxis('z')}>Z축</Btn>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Btn onClick={cancel}>취소</Btn>
          <Btn active disabled={!pending || busy} onClick={confirm}>
            라이브러리에 추가
          </Btn>
        </footer>
      </div>
    </div>
  );
}
