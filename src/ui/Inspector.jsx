/**
 * 우측 인스펙터 — 선택한 설비/연결의 상세, 없으면 도면 요약
 */

import React, { useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCw, Trash2 } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { getSpec, subscribeModels } from '../core/modelStore.js';
import { MAX_LAYER, layerLift, linkPath, portsOf } from '../core/link.js';
import { cartPath, cartStations, stationStyle } from '../core/cart.js';
import { clearStock, setStock, useStock } from '../core/simStore.js';
import { isShelf } from '../data/library.js';
import {
  MAX_BAYS,
  MAX_BAY_LENGTH,
  MAX_LEVELS,
  MAX_LEVEL_GAP,
  MAX_PER_LEVEL,
  MIN_BAYS,
  MIN_BAY_LENGTH,
  MIN_LEVELS,
  MIN_LEVEL_GAP,
  bayLength,
  levelGap,
  perLevel,
  shelfBays,
  shelfCapacity,
  shelfHeight,
  shelfLength,
  shelfLevelCount,
  shelfSpec,
  slotPitch,
} from '../core/shelf.js';
import { footprintOf } from '../core/grid.js';
import { shelfBBox } from '../core/shelf.js';
import { ALIGN, AXIS, alignMoves, distributeMoves, gapOf } from '../core/align.js';
import { FLOOR_COLOR, edgeSpec, inZone, mpArea, mpEdges, wallBox } from '../core/area.js';
import { focusOn } from '../core/focusStore.js';
import { sliceCountFor, tileCount } from '../scene/connectorGeometry.js';
import { Btn, ColorField, Field, Row, Section, Slider } from './common.jsx';

function useModelsVersion() {
  const [v, setV] = React.useState(0);
  React.useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

const ROT_LABEL = ['0°', '90°', '180°', '270°'];

function EquipmentPanel({ placed }) {
  const { state, dispatch, itemOf } = useEditor();
  const beltSpeed = state.beltSpeed;
  const item = itemOf(placed.itemId);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const rect = spec ? footprintOf(placed, spec) : null;
  const ports = spec ? portsOf(placed, item) : [];

  return (
    <>
      <Section title="설비">
        <Field
          label="이름"
          value={placed.name}
          onChange={(e) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? placed.itemId}</Row>
        <Row label="ID">{placed.uid}</Row>
      </Section>

      <Section title="배치">
        <Row label="위치 X / Z">
          {placed.pos[0].toFixed(2)} , {placed.pos[1].toFixed(2)} m
        </Row>
        <Row label="회전">{ROT_LABEL[placed.rot]}</Row>
        {rect && (
          <Row label="점유 크기">
            {(rect.maxX - rect.minX).toFixed(2)} × {(rect.maxZ - rect.minZ).toFixed(2)} m
          </Row>
        )}
        {spec && <Row label="높이">{spec.bbox.size[1].toFixed(2)} m</Row>}
        <div className="mt-2 flex gap-2">
          <Btn onClick={() => dispatch({ type: 'ROTATE', uid: placed.uid })}>
            <RotateCw size={13} /> 90° 회전
          </Btn>
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'equip', uid: placed.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>

      {/* 출하 — 이 설비가 유출부로 내보내는 자재의 모양과 빈도 */}
      <Section title="출하">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            적재 층수
            <b className="text-ink tabular-nums">{placed.outputCount ?? 3} 층</b>
          </span>
          <input
            type="range"
            min="1"
            max="8"
            step="1"
            value={placed.outputCount ?? 3}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { outputCount: Number(e.target.value) } })
            }
            className="w-full accent-sky-500"
          />
        </label>

        <label className="mt-2 block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            내보내는 간격
            <b className="text-ink tabular-nums">{(placed.spawnGap ?? 3).toFixed(2)} m</b>
          </span>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.25"
            value={placed.spawnGap ?? 3}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { spawnGap: Number(e.target.value) } })
            }
            className="w-full accent-sky-500"
          />
          <span className="text-[10px] text-ink4">
            벨트 {beltSpeed.toFixed(2)} m/s 기준 {(60 / ((placed.spawnGap ?? 3) / Math.max(beltSpeed, 0.01))).toFixed(1)} 개/분
          </span>
        </label>

        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          이 설비의 <b className="text-ink3">유출부</b>에서 나가는 컨베이어 위로 이 간격마다
          자재가 흐릅니다. 카트가 유출부 앞을 지날 때 싣는 양도 같은 층수를 따르고,
          <b className="text-ink3"> 유입부</b> 앞에서 내려놓습니다.
        </p>
      </Section>

      <Section title={`포트 ${ports.length}개`}>
        {ports.length === 0 && <p className="text-[11px] text-ink4">모델 로딩 중…</p>}
        <ul className="space-y-1">
          {ports.map((p) => (
            <li key={p.key}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-ink2">
                  <i
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: p.kind === 'in' ? '#34d399' : p.kind === 'out' ? '#fb923c' : '#38bdf8' }}
                  />
                  {p.id}
                </span>
                <span className="tabular-nums text-ink4">
                  {p.dir[0] ? (p.dir[0] > 0 ? 'X+' : 'X−') : p.dir[1] > 0 ? 'Z+' : 'Z−'} · h{p.world[1].toFixed(2)}
                </span>
              </div>
              {p.warning && (
                <p className="mt-0.5 flex items-start gap-1 pl-3 text-[10px] leading-tight text-amber-600">
                  <AlertTriangle size={10} className="mt-px shrink-0" />
                  {p.warning}
                </p>
              )}
            </li>
          ))}
        </ul>
        {spec && !spec.hasExplicitPorts && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-amber-600">
            자동 생성된 포트입니다. 모델에 PORT_IN / PORT_OUT 더미를 넣으면 정확한 위치·높이로 연결됩니다.
          </p>
        )}
      </Section>
    </>
  );
}

function LinkPanel({ link }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion(); // 모델이 늦게 로드돼도 길이가 갱신되도록
  const item = itemOf(link.itemId);
  const path = useMemo(() => linkPath(link, state.placed, itemOf), [link, state.placed, itemOf, version]);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;

  const endName = (ep) => {
    if (ep.point) return `자유 끝점 (${ep.point[0].toFixed(1)}, ${ep.point[1].toFixed(1)})`;
    const p = state.placed.find((x) => x.uid === ep.uid);
    return `${p?.name ?? ep.uid} · ${ep.portId}`;
  };

  return (
    <>
      <Section title="연결장치">
        <Field
          label="이름"
          value={link.name}
          onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? link.itemId}</Row>
        <Row label="연장 방식">{item?.render === 'tube' ? '튜브 (절차적)' : '모델 반복'}</Row>
      </Section>

      <Section title="경로">
        <Row label="총 길이">{path ? `${path.length.toFixed(2)} m` : '—'}</Row>
        {spec && path && (
          <>
            <Row label="토막 길이">{spec.connector.span.toFixed(2)} m</Row>
            <Row label="타일 개수">
              {tileCount(path, spec.connector.span)} 개 ×{' '}
              {(path.length / tileCount(path, spec.connector.span) / spec.connector.span).toFixed(2)} 배
            </Row>
            <Row label="곡선 분할">{sliceCountFor(path, spec.connector.span, link.radius ?? 1)} 단</Row>
          </>
        )}
        <Row label="꺾임 점">{path ? Math.max(0, path.pts.length - 2) : 0}</Row>

        <label className="mt-2 block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            코너 반경
            <b className="text-ink2 tabular-nums">{(link.radius ?? 1).toFixed(2)} m</b>
          </span>
          <input
            type="range"
            min="0"
            max="4"
            step="0.05"
            value={link.radius ?? 1}
            onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { radius: Number(e.target.value) } })}
            className="w-full accent-sky-500"
          />
        </label>
      </Section>

      {/* 경유점 — 그린 뒤에 라인을 직접 고치는 곳 */}
      <Section title={`경유점 ${(link.waypoints ?? []).length}개`}>
        <p className="text-[10.5px] leading-relaxed text-ink4">
          선택하면 경로 위에 손잡이가 뜹니다. <b className="text-ink3">진한 점</b>을 끌어 옮기고,
          <b className="text-ink3"> 흐린 점</b>을 끌면 그 자리에 경유점이 새로 생깁니다.
          <b className="text-ink3"> Alt+클릭</b>으로 지웁니다.
        </p>
        {(link.waypoints ?? []).length > 0 && (
          <ul className="mt-2 space-y-1">
            {link.waypoints.map((w, i) => (
              <li key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-ink2 tabular-nums">
                  #{i + 1} · {w[0].toFixed(2)} , {w[1].toFixed(2)}
                </span>
                <button
                  onClick={() =>
                    dispatch({
                      type: 'UPDATE_LINK',
                      uid: link.uid,
                      patch: { waypoints: link.waypoints.filter((_, k) => k !== i) },
                    })
                  }
                  className="rounded p-0.5 text-ink4 hover:bg-red-500/15 hover:text-red-500"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { waypoints: [] } })}
                className="mt-1 text-[10px] text-sky-600 hover:underline"
              >
                경유점 모두 지우고 자동 경로로
              </button>
            </li>
          </ul>
        )}
      </Section>

      {/* 배관·전선 높이 */}
      {item?.utility && (
        <Section title="설치 높이">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
              높이
              <b className="text-ink tabular-nums">{(link.height ?? item.height ?? 1).toFixed(2)} m</b>
            </span>
            <input
              type="range"
              min="0.1"
              max="8"
              step="0.05"
              value={link.height ?? item.height ?? 1}
              onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { height: Number(e.target.value) } })}
              className="w-full accent-sky-500"
            />
          </label>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink4">
            배관·전선은 컨베이어 포트를 쓰지 않고 이 높이에 놓입니다. 겹쳐도 층을 쌓지 않아
            T·+ 자로 만날 수 있습니다.
          </p>
        </Section>
      )}

      {/* 층 ------------------------------------------------------------- */}
      {!item?.utility && (
      <Section title="층 (겹칠 때 쌓이는 높이)">
        <div className="flex items-center gap-2">
          <Btn
            disabled={(link.layer ?? 0) <= 0}
            onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { layer: Math.max(0, (link.layer ?? 0) - 1) } })}
          >
            <ChevronDown size={13} /> 내리기
          </Btn>
          <span className="flex-1 text-center text-sm font-semibold text-ink tabular-nums">
            {link.layer ?? 0}층
          </span>
          <Btn
            disabled={(link.layer ?? 0) >= MAX_LAYER}
            onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { layer: Math.min(MAX_LAYER, (link.layer ?? 0) + 1) } })}
          >
            <ChevronUp size={13} /> 올리기
          </Btn>
        </div>
        <div className="mt-1">
          <Row label="들림 높이">+{layerLift(link.layer ?? 0).toFixed(2)} m</Row>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink4">
          그릴 때 기존 레일과 겹치면 자동으로 위층에 놓입니다. 양 끝은 포트 높이를 지키고
          가운데만 들립니다.
        </p>
      </Section>
      )}

      {/* 벨트 ----------------------------------------------------------- */}
      {spec && item?.render !== 'tube' && (
        <Section title="벨트">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
              폭
              <b className="text-ink2 tabular-nums">
                {(spec.connector.nativeWidth * (link.widthScale ?? 1)).toFixed(2)} m
              </b>
            </span>
            <input
              type="range"
              min="0.3"
              max="3"
              step="0.05"
              value={spec.connector.nativeWidth * (link.widthScale ?? 1)}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_LINK',
                  uid: link.uid,
                  patch: { widthScale: Number(e.target.value) / spec.connector.nativeWidth },
                })
              }
              className="w-full accent-sky-500"
            />
            <span className="text-[10px] text-ink4">
              모델 원본 {spec.connector.nativeWidth.toFixed(2)} m · 배율 {(link.widthScale ?? 1).toFixed(2)}
            </span>
          </label>

          {spec.connector.belt ? (
            <label className="mt-2 block">
              <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
                구동 속도
                <b className="text-ink2 tabular-nums">
                  {(link.speed ?? state.beltSpeed).toFixed(2)} m/s
                  {link.speed == null && <span className="ml-1 text-ink4">(기본)</span>}
                </b>
              </span>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={link.speed ?? state.beltSpeed}
                onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { speed: Number(e.target.value) } })}
                className="w-full accent-sky-500"
              />
              {link.speed != null && (
                <button
                  onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { speed: null } })}
                  className="mt-1 text-[10px] text-sky-400 hover:underline"
                >
                  전역 기본값으로 되돌리기
                </button>
              )}
            </label>
          ) : (
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
              이 모델에는 벨트 메시가 없어 UV 구동을 하지 않습니다. 벨트 부분을 별도 메시로
              분리하고 이름에 <code className="rounded bg-field px-1">Belt</code> 를 넣어 주세요.
            </p>
          )}
        </Section>
      )}

      <Section title="끝점">
        <Row label="시작">{endName(link.from)}</Row>
        <Row label="끝">{endName(link.to)}</Row>
        <div className="mt-2">
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'link', uid: link.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>
    </>
  );
}

function ShelfPanel({ placed }) {
  const { dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const item = itemOf(placed.itemId);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const stock = useStock(placed.uid);

  const s = shelfSpec(spec);
  const bays = shelfBays(placed);
  const bayLen = bayLength(placed, spec);
  const levelCount = shelfLevelCount(placed);
  const gap = levelGap(placed, spec);
  const length = shelfLength(placed, spec);
  const per = perLevel(placed, spec);
  const pitch = slotPitch(placed, spec);
  const capacity = shelfCapacity(placed, spec);
  const shown = Math.min(stock, capacity);   // 수용량이 줄면 표시도 따라 줄어든다

  const set = (patch) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch });

  const num = (label, key, min, max, step, value, text) => (
    <label className="mt-2 block first:mt-0">
      <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
        {label}
        <b className="text-ink tabular-nums">{text}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
        className="w-full accent-sky-500"
      />
    </label>
  );

  return (
    <>
      <Section title="선반">
        <Field
          label="이름"
          value={placed.name}
          onChange={(e) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? placed.itemId}</Row>
        <Row label="위치 X / Z">
          {placed.pos[0].toFixed(2)} , {placed.pos[1].toFixed(2)} m
        </Row>
        <Row label="회전">{['0°', '90°', '180°', '270°'][placed.rot]}</Row>
        <Row label="모델">{spec?.shelf ? 'Shelf.glb' : '절차적 (모델 없음)'}</Row>
      </Section>

      <Section title="크기">
        {num('칸 수', 'bays', MIN_BAYS, MAX_BAYS, 1, bays, `${bays}칸 · 전체 ${length.toFixed(2)} m`)}
        {num('한 칸 길이', 'bayLength', MIN_BAY_LENGTH, MAX_BAY_LENGTH, 0.05, bayLen, `${bayLen.toFixed(2)} m`)}
        {num('단 수', 'levels', MIN_LEVELS, MAX_LEVELS, 1, levelCount, `${levelCount} 단`)}
        {num('단 간격', 'levelGap', MIN_LEVEL_GAP, MAX_LEVEL_GAP, 0.05, gap, `${gap.toFixed(2)} m`)}
        <Row label="전체 높이">{shelfHeight(placed, spec).toFixed(2)} m</Row>
      </Section>

      <Section title="수용량">
        <div>
          <Row label="한 단 적재수">{per} 개 · 간격 {pitch.toFixed(2)} m</Row>
          <Row label="총 수용량">{per} × {levelCount}단 = {capacity} 개</Row>
          <div className="mb-1 mt-1 flex items-center justify-between text-[11px]">
            <span className="text-ink4">현재 재고</span>
            <b className="text-ink tabular-nums">{shown} / {capacity}</b>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-kbd">
            <div
              className="h-full bg-emerald-500 transition-[width]"
              style={{ width: `${capacity ? Math.min(100, (shown / capacity) * 100) : 0}%` }}
            />
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <Btn onClick={() => setStock(placed.uid, capacity)}>가득 채우기</Btn>
          <Btn onClick={() => clearStock(placed.uid)}>비우기</Btn>
        </div>
      </Section>

      <Section title="입출고">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            빈 카트에 실어 보낼 수량
            <b className="text-ink tabular-nums">{placed.dispatchCount ?? 3} 개</b>
          </span>
          <input
            type="range"
            min="0"
            max="12"
            step="1"
            value={placed.dispatchCount ?? 3}
            onChange={(e) => set({ dispatchCount: Number(e.target.value) })}
            className="w-full accent-sky-500"
          />
        </label>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          선반 앞뒤 바닥에 <b className="text-emerald-600">녹색(내리기)</b> ·
          <b className="text-amber-600"> 주황(싣기)</b> 구역이 반씩 깔려 있습니다.
          카트가 <b className="text-ink3">녹색</b>을 지나면 싣고 있던 자재를 내려놓고,
          <b className="text-ink3"> 주황</b>을 지나면 이 수량만큼 실어 갑니다.
          실어 온 곳에는 도로 내려놓지 않고, 한 번 주고받은 선반은 다른 곳을 거치기
          전까지 다시 반응하지 않습니다.
          재고는 시뮬레이션 값이라 도면 파일에는 저장되지 않습니다.
        </p>
      </Section>

      <Section title="배치">
        <div className="flex gap-2">
          <Btn onClick={() => dispatch({ type: 'ROTATE', uid: placed.uid })}>
            <RotateCw size={13} /> 90° 회전
          </Btn>
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'equip', uid: placed.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>
    </>
  );
}

function CartPanel({ cart }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const item = itemOf(cart.itemId);
  const path = useMemo(() => cartPath(cart), [cart]);
  const stations = useMemo(
    () => (path ? cartStations(path, state.placed, itemOf) : []),
    [path, state.placed, itemOf, version],
  );

  const slider = (label, key, min, max, step, unit, fallback) => (
    <label className="mt-2 block">
      <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
        {label}
        <b className="text-ink tabular-nums">
          {(cart[key] ?? fallback).toFixed(2)} {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={cart[key] ?? fallback}
        onChange={(e) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { [key]: Number(e.target.value) } })}
        className="w-full accent-sky-500"
      />
    </label>
  );

  return (
    <>
      <Section title="카트">
        <Field
          label="이름"
          value={cart.name}
          onChange={(e) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? cart.itemId}</Row>
        <Row label="배치 대수">{cart.count ?? 1} 대</Row>
        <Row label="경로 길이">{path ? `${path.length.toFixed(2)} m` : '—'}</Row>
        <Row label="경유점">{cart.points.length} 개</Row>
        <Row label="주행 방식">{cart.closed ? '고리 (계속 순환)' : '왕복'}</Row>
      </Section>

      <Section title="배치 대수">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            이 경로에 올릴 카트
            <b className="text-ink tabular-nums">{cart.count ?? 1} 대</b>
          </span>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={cart.count ?? 1}
            onChange={(e) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { count: Number(e.target.value) } })}
            className="w-full accent-sky-500"
          />
          {path && (
            <span className="text-[10px] text-ink4">
              간격 {(path.length / (cart.count ?? 1)).toFixed(2)} m
            </span>
          )}
        </label>
        {!cart.closed && (cart.count ?? 1) > 1 && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-amber-600">
            왕복 경로에서는 되돌아오는 카트끼리 스쳐 지나갑니다. 여러 대를 굴릴 거라면
            <b> 고리로 순환</b>을 켜는 편이 자연스럽습니다.
          </p>
        )}
      </Section>

      <Section title="주행">
        {slider('이동 속도', 'speed', 0, 5, 0.05, 'm/s', 1.4)}
        {slider('코너 반경', 'radius', 0, 4, 0.05, 'm', 1.2)}
        {slider('정차 시간', 'dwell', 0, 5, 0.1, '초', 1.2)}
        <div className="mt-2 flex gap-2">
          <Btn
            active={cart.closed}
            onClick={() => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { closed: !cart.closed } })}
          >
            고리로 순환
          </Btn>
          <Btn
            active={cart.reverse}
            onClick={() => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { reverse: !cart.reverse } })}
          >
            앞뒤 반전
          </Btn>
        </div>
        {!state.running && (
          <p className="mt-2 text-[10.5px] text-amber-600">툴바의 ▶ 를 눌러야 움직입니다.</p>
        )}
      </Section>

      <Section title={`정차역 ${stations.length}개`}>
        {stations.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-ink4">
            경로가 설비 포트 옆(3.5m 이내)을 지나가면 자동으로 역이 됩니다. 유출부면 싣고,
            유입부면 내립니다.
          </p>
        )}
        <ul className="space-y-1">
          {stations.map((st, i) => {
            const style = stationStyle(st.kind);
            const qty = st.kind === 'load' ? ` ${st.count}개` : st.kind === 'shelf-out' ? ` ${st.dispatch}개` : '';
            return (
              <li key={i} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-ink2">
                  <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: style.color }} />
                  {st.name}
                </span>
                <span className="tabular-nums text-ink4">
                  {style.label}{qty} · {st.s.toFixed(1)}m
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="경로 편집">
        <p className="text-[10.5px] leading-relaxed text-ink4">
          <b className="text-ink3">진한 점</b>을 끌어 옮기고, <b className="text-ink3">흐린 점</b>을 끌면
          경유점이 새로 생깁니다. <b className="text-ink3">Alt+클릭</b>으로 지웁니다.
        </p>
        <div className="mt-2">
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'cart', uid: cart.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>
    </>
  );
}

/* ==========================================================================
 * 작업 영역 — 영역 / 벽 / 기둥 / 구역
 * ======================================================================== */

const WALL_RANGE = { thickness: [0.05, 1.5, 0.05], height: [0.3, 12, 0.1] };

/** 두께·높이·색 — 영역 전체에도, 면 하나에도, 내벽에도 똑같이 쓰인다 */
function WallFields({ spec, onChange }) {
  return (
    <>
      <Slider
        label="두께" min={WALL_RANGE.thickness[0]} max={WALL_RANGE.thickness[1]} step={WALL_RANGE.thickness[2]}
        value={spec.thickness} text={`${spec.thickness.toFixed(2)} m`}
        onChange={(v) => onChange({ thickness: v })}
      />
      <Slider
        label="높이" min={WALL_RANGE.height[0]} max={WALL_RANGE.height[1]} step={WALL_RANGE.height[2]}
        value={spec.height} text={`${spec.height.toFixed(2)} m`}
        onChange={(v) => onChange({ height: v })}
      />
      <ColorField label="색" value={spec.color} onChange={(v) => onChange({ color: v })} />
    </>
  );
}

/**
 * 영역 패널.
 * ---------------------------------------------------------------------------
 *  바닥과 벽은 **서로 다른 대상**이다. 벽 한 장을 골라 이름을 고쳤는데 작업장
 *  이름까지 바뀌면 안 되므로, 면을 고른 상태에서는 영역의 이름·바닥 색을
 *  아예 보여 주지 않고 그 면의 것만 다룬다.
 */
function AreaPanel({ area, edge }) {
  const { state, dispatch } = useEditor();
  const edges = useMemo(() => mpEdges(area.mp), [area.mp]);
  const picked = edge ? edges.find((e) => e.key === edge) : null;

  const toArea = () => dispatch({ type: 'SELECT', selected: { kind: 'area', uid: area.uid } });

  /* ---- 벽 한 장 ------------------------------------------------------- */
  if (picked) {
    const spec = edgeSpec(area, edge);
    const o = area.edges?.[edge] ?? {};
    const idx = edges.indexOf(picked) + 1;
    return (
      <>
        <Section
          title="벽 (한 면)"
          right={
            <button className="text-[11px] text-sky-500 hover:underline" onClick={toArea}>
              영역 전체
            </button>
          }
        >
          <Field
            label="이름"
            value={o.name ?? `${area.name} 벽 ${idx}`}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_AREA_EDGE', uid: area.uid, edge, patch: { name: e.target.value } })
            }
          />
          <Row label="소속 영역">{area.name}</Row>
          <Row label="길이">{picked.len.toFixed(2)} m</Row>
        </Section>

        <Section title="규격">
          <WallFields
            spec={spec}
            onChange={(patch) => dispatch({ type: 'UPDATE_AREA_EDGE', uid: area.uid, edge, patch })}
          />
          {(o.thickness !== undefined || o.height !== undefined || o.color !== undefined) && (
            <div className="mt-2">
              <Btn onClick={() => dispatch({ type: 'UPDATE_AREA_EDGE', uid: area.uid, edge, patch: null })}>
                영역 기본값으로
              </Btn>
            </div>
          )}
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
            벽은 영역 테두리에서 만들어지므로 따로 지울 수 없습니다. 없애려면 영역의
            모양을 바꾸세요.
          </p>
        </Section>
      </>
    );
  }

  /* ---- 영역(바닥) ------------------------------------------------------ */
  return (
    <>
      <Section title="영역 (바닥)">
        <Field
          label="이름"
          value={area.name}
          onChange={(e) => dispatch({ type: 'UPDATE_AREA', uid: area.uid, patch: { name: e.target.value } })}
        />
        <Row label="바닥 넓이">{mpArea(area.mp).toFixed(1)} ㎡</Row>
        <Row label="벽 면 수">{edges.length} 면</Row>
        <Row label="바닥 색">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm border border-edge" style={{ background: FLOOR_COLOR }} />
            {FLOOR_COLOR} (고정)
          </span>
        </Row>
      </Section>

      <Section title="벽 기본값 (전체)">
        <WallFields
          spec={edgeSpec(area, null)}
          onChange={(patch) => dispatch({ type: 'UPDATE_AREA', uid: area.uid, patch })}
        />
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          벽을 직접 클릭하면 그 면만 따로 이름·두께·높이·색을 정할 수 있습니다.
        </p>
      </Section>

      <Section title="벽 면">
        <ul className="space-y-1">
          {edges.map((e, i) => (
            <li key={e.key}>
              <button
                onClick={() => dispatch({ type: 'SELECT', selected: { kind: 'area', uid: area.uid, edge: e.key } })}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-ink2 hover:bg-raiseh"
              >
                <span className="truncate">{area.edges?.[e.key]?.name ?? `${area.name} 벽 ${i + 1}`}</span>
                <span className="shrink-0 tabular-nums text-[10px] text-ink4">{e.len.toFixed(1)} m</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'area', uid: area.uid })}>
          <Trash2 size={13} /> 영역 삭제
        </Btn>
      </Section>
    </>
  );
}

function WallPanel({ wall }) {
  const { dispatch } = useEditor();
  const g = wallBox(wall);
  return (
    <>
      <Section title="내벽">
        <Field
          label="이름"
          value={wall.name}
          onChange={(e) => dispatch({ type: 'UPDATE_WALL', uid: wall.uid, patch: { name: e.target.value } })}
        />
        <Row label="길이">{g.len.toFixed(2)} m</Row>
        <Row label="시작 → 끝">
          {wall.a[0].toFixed(1)},{wall.a[1].toFixed(1)} → {wall.b[0].toFixed(1)},{wall.b[1].toFixed(1)}
        </Row>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          탑뷰에서 양 끝의 <b className="text-ink3">손잡이</b>를 끌어 옮길 수 있습니다.
          놓을 때와 같이 다른 벽 끝·영역 경계에 달라붙습니다.
        </p>
      </Section>
      <Section title="규격">
        <WallFields spec={wall} onChange={(patch) => dispatch({ type: 'UPDATE_WALL', uid: wall.uid, patch })} />
      </Section>
      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'wall', uid: wall.uid })}>
          <Trash2 size={13} /> 벽 삭제
        </Btn>
      </Section>
    </>
  );
}

function PillarPanel({ pillar }) {
  const { dispatch } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_PILLAR', uid: pillar.uid, patch });
  return (
    <>
      <Section title="기둥">
        <Field label="이름" value={pillar.name} onChange={(e) => set({ name: e.target.value })} />
        <Row label="위치 X / Z">{pillar.pos[0].toFixed(2)} , {pillar.pos[1].toFixed(2)} m</Row>
      </Section>
      <Section title="규격">
        <Slider
          label="가로" min={0.1} max={3} step={0.05} value={pillar.size[0]}
          text={`${pillar.size[0].toFixed(2)} m`}
          onChange={(v) => set({ size: [v, pillar.size[1]] })}
        />
        <Slider
          label="세로" min={0.1} max={3} step={0.05} value={pillar.size[1]}
          text={`${pillar.size[1].toFixed(2)} m`}
          onChange={(v) => set({ size: [pillar.size[0], v] })}
        />
        <Slider
          label="높이" min={0.3} max={12} step={0.1} value={pillar.height}
          text={`${pillar.height.toFixed(2)} m`}
          onChange={(v) => set({ height: v })}
        />
        <ColorField label="색" value={pillar.color} onChange={(v) => set({ color: v })} />
      </Section>
      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'pillar', uid: pillar.uid })}>
          <Trash2 size={13} /> 기둥 삭제
        </Btn>
      </Section>
    </>
  );
}

/**
 * 구역 패널.
 *  "이 구역 안에 무엇이 있는가" 를 목록으로 보여 준다. 구역은 결국 자리를
 *  묶어 부르기 위한 것이라, 이름만 있고 내용물을 못 보면 쓸 데가 없다.
 *  이름을 누르면 그 설비를 선택하고 화면을 그리로 옮긴다.
 */
function ZonePanel({ zone }) {
  const { state, dispatch, itemOf } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_ZONE', uid: zone.uid, patch });

  const contents = useMemo(() => {
    const inside = (pos) => inZone(zone, pos);
    return [
      ...state.placed.filter((p) => inside(p.pos)).map((p) => ({ kind: 'equip', uid: p.uid, name: p.name, at: p.pos })),
      ...state.carts
        .filter((c) => c.points.some(inside))
        .map((c) => ({ kind: 'cart', uid: c.uid, name: c.name, at: c.points.find(inside) })),
    ];
  }, [zone, state.placed, state.carts]);

  return (
    <>
      <Section title="구역">
        <Field label="이름" value={zone.name} onChange={(e) => set({ name: e.target.value })} />
        <Row label="넓이">{mpArea(zone.mp).toFixed(1)} ㎡</Row>
        <ColorField label="색" value={zone.color} onChange={(v) => set({ color: v })} />
        <Slider
          label="투명도" min={0.05} max={0.9} step={0.05} value={zone.opacity ?? 0.28}
          text={`${Math.round((zone.opacity ?? 0.28) * 100)} %`}
          onChange={(v) => set({ opacity: v })}
        />
        <Slider
          label="이름 크기" min={0.5} max={8} step={0.1} value={zone.labelSize ?? 1.6}
          text={`${(zone.labelSize ?? 1.6).toFixed(1)} m`}
          onChange={(v) => set({ labelSize: v })}
        />
      </Section>

      {/* 외곽선 — 반투명 면만으로는 옆 구역과 맞닿는 자리가 흐려진다.
          굵기는 화면 픽셀이 아니라 도면상의 미터라, 확대해도 축척이 유지된다. */}
      <Section
        title="외곽선"
        right={
          <button
            onClick={() => set({ outline: zone.outline === false })}
            className={`rounded px-1.5 py-0.5 text-[10.5px] ${
              zone.outline === false ? 'bg-kbd text-ink4' : 'bg-sky-500/15 text-sky-500'
            }`}
          >
            {zone.outline === false ? '꺼짐' : '켜짐'}
          </button>
        }
      >
        {zone.outline === false ? (
          <p className="py-1 text-[11px] text-ink4">외곽선을 그리지 않습니다</p>
        ) : (
          <>
            <ColorField
              label="선 색"
              value={zone.outlineColor ?? zone.color}
              onChange={(v) => set({ outlineColor: v })}
            />
            <Slider
              label="선 굵기" min={0.02} max={1} step={0.02} value={zone.outlineWidth ?? 0.14}
              text={`${((zone.outlineWidth ?? 0.14) * 100).toFixed(0)} cm`}
              onChange={(v) => set({ outlineWidth: v })}
            />
          </>
        )}
      </Section>

      <Section title={`이 구역 안 (${contents.length})`}>
        {contents.length === 0 ? (
          <p className="py-1 text-[11px] text-ink4">아직 아무것도 없습니다</p>
        ) : (
          <ul className="space-y-1">
            {contents.map((c) => (
              <li key={c.uid}>
                <button
                  onClick={() => {
                    dispatch({ type: 'SELECT', selected: { kind: c.kind, uid: c.uid } });
                    focusOn(c.at);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-ink2 hover:bg-raiseh"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-[10px] text-ink4">
                    {c.kind === 'cart' ? '카트' : isShelf(itemOf(state.placed.find((p) => p.uid === c.uid)?.itemId)) ? '선반' : '설비'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'zone', uid: zone.uid })}>
          <Trash2 size={13} /> 구역 삭제
        </Btn>
      </Section>
    </>
  );
}

/* ==========================================================================
 * 여러 개를 골랐을 때 — 정렬 · 등간격
 * ==========================================================================
 *  좌표를 직접 계산해서 한 번의 MOVE_MANY 로 넘긴다. 리듀서가 크기를 알려면
 *  모델 규격(설비)과 설정값(기둥)을 둘 다 알아야 하는데, 그건 씬과 인스펙터가
 *  이미 하는 일이다 — 리듀서는 "어디로 갈지" 만 받는다.
 *
 *  정렬은 **차지하는 네모(풋프린트) 기준**이다. 원점 기준으로 맞추면 모델마다
 *  원점 위치가 달라서 눈에는 안 맞아 보인다.
 *
 *  결과 좌표는 그리드에 다시 스냅하지 않는다. 정렬은 "정확히 맞춰라" 라는
 *  명시적인 지시라서, 스냅으로 반 칸 어긋나면 시킨 일을 안 한 게 된다.
 * ======================================================================== */

const ALIGN_X = [
  { id: ALIGN.MIN, label: '왼쪽' },
  { id: ALIGN.CENTER, label: '가로 가운데' },
  { id: ALIGN.MAX, label: '오른쪽' },
];
const ALIGN_Z = [
  { id: ALIGN.MIN, label: '위쪽' },
  { id: ALIGN.CENTER, label: '세로 가운데' },
  { id: ALIGN.MAX, label: '아래쪽' },
];

function MultiPanel({ kind, uids }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion();

  /* 고른 것들의 { uid, pos, rect } — 정렬은 전부 이 값으로만 한다 */
  const items = useMemo(() => {
    const set = new Set(uids);
    if (kind === 'pillar') {
      return state.pillars.filter((p) => set.has(p.uid)).map((p) => {
        const [w, d] = p.size;
        return {
          uid: p.uid,
          pos: p.pos,
          rect: { minX: p.pos[0] - w / 2, maxX: p.pos[0] + w / 2, minZ: p.pos[1] - d / 2, maxZ: p.pos[1] + d / 2 },
        };
      });
    }
    return state.placed
      .filter((p) => set.has(p.uid))
      .map((p) => {
        const it = itemOf(p.itemId);
        const bbox = isShelf(it)
          ? shelfBBox(p, it.modelKey ? getSpec(it.modelKey) : null)
          : it?.modelKey ? getSpec(it.modelKey)?.bbox : null;
        if (!bbox) return null;
        return { uid: p.uid, pos: p.pos, rect: footprintOf({ ...p, bboxOverride: bbox }, null) };
      })
      .filter(Boolean);
  }, [kind, uids, state.pillars, state.placed, itemOf, version]);

  const bounds = useMemo(() => {
    if (!items.length) return null;
    return {
      minX: Math.min(...items.map((i) => i.rect.minX)),
      maxX: Math.max(...items.map((i) => i.rect.maxX)),
      minZ: Math.min(...items.map((i) => i.rect.minZ)),
      maxZ: Math.max(...items.map((i) => i.rect.maxZ)),
    };
  }, [items]);

  const apply = (moves) => { if (moves.length) dispatch({ type: 'MOVE_MANY', kind, moves }); };

  const Tile = ({ onClick, disabled, children }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line bg-raise px-2 py-1.5 text-[11px] text-ink2 transition-colors hover:border-edge hover:bg-raiseh disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );

  const label = kind === 'pillar' ? '기둥' : '설비';
  /* 폈을 때 생길 틈을 미리 보여 준다. 음수면 자리가 모자라 서로 겹친다는 뜻이라,
     누르기 전에 알 수 있어야 한다. */
  const gapX = items.length >= 3 ? gapOf(items, AXIS.X) : null;
  const gapZ = items.length >= 3 ? gapOf(items, AXIS.Z) : null;

  return (
    <>
      <Section title={`${label} ${items.length}개 선택`}>
        {bounds && (
          <>
            <Row label="전체 크기">
              {(bounds.maxX - bounds.minX).toFixed(2)} × {(bounds.maxZ - bounds.minZ).toFixed(2)} m
            </Row>
            <Row label="중심">
              {((bounds.minX + bounds.maxX) / 2).toFixed(2)} , {((bounds.minZ + bounds.maxZ) / 2).toFixed(2)}
            </Row>
          </>
        )}
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          <kbd className="rounded bg-kbd px-1 text-ink2">Ctrl</kbd>+클릭으로 더하고 빼며,
          빈 바닥을 끌면 사각형 안의 것이 한 번에 잡힙니다. 하나를 끌면 묶음이 함께 움직입니다.
        </p>
      </Section>

      <Section title="정렬 (가로)">
        <div className="grid grid-cols-3 gap-1.5">
          {ALIGN_X.map((m) => (
            <Tile key={m.id} onClick={() => apply(alignMoves(items, AXIS.X, m.id))} disabled={items.length < 2}>
              {m.label}
            </Tile>
          ))}
        </div>
      </Section>

      <Section title="정렬 (세로)">
        <div className="grid grid-cols-3 gap-1.5">
          {ALIGN_Z.map((m) => (
            <Tile key={m.id} onClick={() => apply(alignMoves(items, AXIS.Z, m.id))} disabled={items.length < 2}>
              {m.label}
            </Tile>
          ))}
        </div>
      </Section>

      <Section title="등간격">
        <div className="grid grid-cols-2 gap-1.5">
          <Tile onClick={() => apply(distributeMoves(items, AXIS.X))} disabled={items.length < 3}>
            가로 등간격
          </Tile>
          <Tile onClick={() => apply(distributeMoves(items, AXIS.Z))} disabled={items.length < 3}>
            세로 등간격
          </Tile>
        </div>
        {items.length >= 3 && (
          <div className="mt-1.5">
            <Row label="펴면 생기는 틈">
              가로 {gapX.toFixed(2)} · 세로 {gapZ.toFixed(2)} m
            </Row>
          </div>
        )}
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink4">
          {items.length < 3
            ? '등간격은 3개 이상부터 쓸 수 있습니다.'
            : gapX < 0 || gapZ < 0
              ? '틈이 음수인 방향은 자리가 모자라 서로 겹칩니다. 먼저 벌려 놓으세요.'
              : '양 끝은 그대로 두고 사이의 빈틈을 똑같이 벌립니다. 크기가 다른 설비도 고르게 보입니다.'}
        </p>
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind, uids })}>
          <Trash2 size={13} /> {items.length}개 삭제
        </Btn>
      </Section>
    </>
  );
}

function Summary() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();

  const total = useMemo(
    () =>
      state.links.reduce((sum, l) => {
        const p = linkPath(l, state.placed, itemOf);
        return sum + (p?.length ?? 0);
      }, 0),
    [state.links, state.placed, itemOf, version],
  );

  return (
    <>
      <Section title="도면 요약">
        <Row label="설비">{state.placed.length} 대</Row>
        <Row label="연결장치">{state.links.length} 개</Row>
        <Row label="카트">
          {state.carts.reduce((n, c) => n + (c.count ?? 1), 0)} 대 / 경로 {state.carts.length}
        </Row>
        <Row label="총 연장 길이">{total.toFixed(2)} m</Row>
      </Section>

      <Section title="조작">
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink3">
          <li><b className="text-ink">좌클릭</b> — 배치 / 선택</li>
          <li><b className="text-ink">좌드래그</b> — 선택한 설비 이동 (탑뷰)</li>
          <li><b className="text-ink">우·휠 드래그</b> — 화면 이동</li>
          <li><b className="text-ink">휠</b> — 커서 기준 확대/축소</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">R</kbd> — 90° 회전</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">X</kbd> — 지우개</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">Del</kbd> — 선택 삭제</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">Esc</kbd> — 도구 해제 / 연결 취소</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">Tab</kbd> — 탑뷰 ↔ 3D</li>
        </ul>
      </Section>
    </>
  );
}

export default function Inspector() {
  const { state } = useEditor();
  useModelsVersion();
  const sel = state.selected;

  const placed = sel?.kind === 'equip' ? state.placed.find((p) => p.uid === sel.uid) : null;
  const link = sel?.kind === 'link' ? state.links.find((l) => l.uid === sel.uid) : null;
  const cart = sel?.kind === 'cart' ? state.carts.find((c) => c.uid === sel.uid) : null;
  const area = sel?.kind === 'area' ? state.areas.find((a) => a.uid === sel.uid) : null;
  const wall = sel?.kind === 'wall' ? state.walls.find((w) => w.uid === sel.uid) : null;
  const pillar = sel?.kind === 'pillar' ? state.pillars.find((p) => p.uid === sel.uid) : null;
  const zone = sel?.kind === 'zone' ? state.zones.find((z) => z.uid === sel.uid) : null;
  const shelf = placed && isShelf(state.library.find((i) => i.id === placed.itemId)) ? placed : null;

  /* 여러 개를 골랐으면 개별 상세 대신 정렬 도구를 보여 준다 */
  const multi = (sel?.uids?.length ?? 0) > 1 ? sel : null;

  return (
    <aside className="w-[292px] shrink-0 overflow-y-auto border-l border-line bg-panel">
      {multi ? <MultiPanel kind={multi.kind} uids={multi.uids} />
        : area ? <AreaPanel area={area} edge={sel.edge} />
        : wall ? <WallPanel wall={wall} />
          : pillar ? <PillarPanel pillar={pillar} />
            : zone ? <ZonePanel zone={zone} />
              : shelf ? <ShelfPanel placed={shelf} />
                : placed ? <EquipmentPanel placed={placed} />
                  : link ? <LinkPanel link={link} />
                    : cart ? <CartPanel cart={cart} />
                      : <Summary />}
    </aside>
  );
}
