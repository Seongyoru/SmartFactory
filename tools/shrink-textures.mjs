/**
 * =============================================================================
 *  GLB 텍스처 줄이기 — 마스터(GLB_model) → 앱이 서비스하는 사본(public/models)
 * =============================================================================
 *  모델러가 내보내는 GLB 는 텍스처가 4096 × 4096 이다. 화면에서는 설비 하나가
 *  손바닥만 하게 보이는데, GPU 는 밉맵까지 **장당 약 85 MB** 를 물고 있다.
 *  모델 다섯 개면 그것만 400 MB 다 — 오브젝트가 늘수록 느려지던 주된 이유다.
 *
 *  1024 로 줄이면 같은 계산이 5.3 MB 가 된다(16분의 1). 도면을 보는 거리에서는
 *  차이를 알아보기 어렵고, 2의 거듭제곱이라 밉맵도 깔끔하게 떨어진다.
 *
 *  ── 무엇을 건드리고 무엇을 안 건드리는가 ──────────────────────────────────
 *  **텍스처 픽셀만** 줄인다. 메시·UV·노드 이름·재질 설정은 그대로 옮긴다.
 *  마스터(`GLB_model/`)는 읽기만 한다 — 원본은 남아 있어야 나중에 더 큰 크기가
 *  필요할 때 다시 뽑을 수 있다.
 *
 *  ── 쓰는 법 ───────────────────────────────────────────────────────────────
 *      node tools/shrink-textures.mjs                 # 기본 1024, 4096짜리만
 *      node tools/shrink-textures.mjs --size 512
 *      node tools/shrink-textures.mjs --min 0         # 크기와 무관하게 전부
 *      node tools/shrink-textures.mjs Cart.glb Truck.glb
 *      node tools/shrink-textures.mjs --dry           # 무엇을 할지만 보기
 *
 *  이미지 리샘플은 Windows 기본 GDI+ 에 맡긴다(`resize-jpeg.ps1`). 이 저장소에
 *  이미지 라이브러리를 하나 더 들이는 것보다, 이미 있는 것을 쓰는 편이 낫다.
 * ---------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_DIR = path.join(ROOT, 'GLB_model');
const OUT_DIR = path.join(ROOT, 'public', 'models');

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/* ── GLB 읽고 쓰기 ──────────────────────────────────────────────────────── */

function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`GLB 가 아니다: ${file}`);
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN) bin = Buffer.from(data);
    off += 8 + len;
  }
  if (!json) throw new Error(`JSON 청크가 없다: ${file}`);
  return { json, bin, size: buf.length };
}

function writeGLB(file, json, bin) {
  const j = Buffer.from(JSON.stringify(json), 'utf8');
  const jPad = (4 - (j.length % 4)) % 4;          // JSON 은 공백으로 채운다
  const bPad = (4 - (bin.length % 4)) % 4;        // BIN 은 0 으로
  const total = 12 + 8 + j.length + jPad + (bin.length ? 8 + bin.length + bPad : 0);

  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);

  let o = 12;
  out.writeUInt32LE(j.length + jPad, o);
  out.writeUInt32LE(CHUNK_JSON, o + 4);
  o += 8;
  j.copy(out, o);
  o += j.length;
  out.fill(0x20, o, o + jPad);
  o += jPad;

  if (bin.length) {
    out.writeUInt32LE(bin.length + bPad, o);
    out.writeUInt32LE(CHUNK_BIN, o + 4);
    o += 8;
    bin.copy(out, o);
    o += bin.length;
    out.fill(0, o, o + bPad);
  }
  fs.writeFileSync(file, out);
  return total;
}

/**
 * BIN 을 처음부터 다시 쌓는다.
 *  이미지 한 장의 크기가 바뀌면 그 뒤 bufferView 의 위치가 전부 밀린다. 뒤쪽만
 *  손보는 것보다 순서대로 다시 쌓고 offset 을 새로 적는 편이 틀릴 여지가 없다.
 *  4바이트 정렬을 지키면 accessor 의 상대 offset 은 건드릴 필요가 없다.
 */
function repack(json, bin, replaced) {
  const parts = [];
  let offset = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const bv = json.bufferViews[i];
    const from = bv.byteOffset ?? 0;
    const data = replaced.get(i) ?? bin.subarray(from, from + bv.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
    bv.byteOffset = offset;
    bv.byteLength = data.length;
    parts.push(data);
    offset += data.length;
  }
  const out = Buffer.concat(parts);
  if (json.buffers?.[0]) json.buffers[0].byteLength = out.length;
  return out;
}

/* ── 이미지 ─────────────────────────────────────────────────────────────── */

/** JPEG/PNG 헤더에서 픽셀 크기만 읽는다 (디코드하지 않는다) */
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [0, 0];
}

function resizeJPEG(bytes, size, quality) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glbtex-'));
  const inFile = path.join(tmp, 'in.jpg');
  const outFile = path.join(tmp, 'out.jpg');
  try {
    fs.writeFileSync(inFile, bytes);
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(HERE, 'resize-jpeg.ps1'),
      '-In', inFile, '-Out', outFile, '-Size', String(size), '-Quality', String(quality),
    ], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(outFile)) {
      throw new Error(`리샘플 실패: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
    }
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ── 본체 ──────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const SIZE = flag('size', 1024);
const QUALITY = flag('quality', 88);
const MIN = flag('min', 2048);          // 이보다 큰 텍스처만 손댄다
const DRY = args.includes('--dry');
const named = args.filter((a) => a.endsWith('.glb'));

const files = named.length ? named : fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.glb'));
const MB = (n) => (n / 1048576).toFixed(2);
/** 밉맵까지 친 대략의 GPU 메모리 (RGBA8 × 4/3) */
const vram = (w, h) => (w * h * 4 * 4) / 3 / 1048576;

let before = 0;
let after = 0;
let touched = 0;

for (const name of files) {
  const src = path.join(SRC_DIR, name);
  const dst = path.join(OUT_DIR, name);
  if (!fs.existsSync(src)) { console.log(`· ${name} — 마스터가 없다, 건너뜀`); continue; }

  const { json, bin, size } = readGLB(src);
  const images = json.images ?? [];
  const replaced = new Map();
  const notes = [];

  for (const img of images) {
    if (img.bufferView == null) continue;                 // 외부 파일 참조 — 손대지 않는다
    const bv = json.bufferViews[img.bufferView];
    const from = bv.byteOffset ?? 0;
    const bytes = bin.subarray(from, from + bv.byteLength);
    const [w, h] = imageSize(bytes);
    if (Math.max(w, h) <= MIN) { notes.push(`${w}×${h} 그대로`); continue; }
    if (img.mimeType !== 'image/jpeg') { notes.push(`${w}×${h} ${img.mimeType} 건너뜀`); continue; }
    if (DRY) { notes.push(`${w}×${h} → ${SIZE}×${SIZE} (예정)`); continue; }

    const small = resizeJPEG(bytes, SIZE, QUALITY);
    replaced.set(img.bufferView, small);
    notes.push(`${w}×${h} → ${SIZE}×${SIZE} · ${MB(bytes.length)}→${MB(small.length)} MB · VRAM ${vram(w, h).toFixed(0)}→${vram(SIZE, SIZE).toFixed(1)} MB`);
  }

  if (!replaced.size) {
    console.log(`· ${name} — ${notes.join(' / ') || '이미지 없음'}`);
    if (!DRY && !fs.existsSync(dst)) fs.copyFileSync(src, dst);   // 사본이 없으면 그대로 둔다
    continue;
  }

  const nextBin = repack(json, bin, replaced);
  const total = writeGLB(dst, json, nextBin);
  before += size;
  after += total;
  touched++;
  console.log(`✓ ${name} — ${notes.join(' / ')}\n    파일 ${MB(size)} → ${MB(total)} MB`);
}

if (touched) console.log(`\n${touched}개 · 파일 합계 ${MB(before)} → ${MB(after)} MB`);
