// PDF storyboard extraction pipeline. Ported from the original — preserves
// every pass and heuristic so behavior is identical. Replaces the CDN globals
// (pdfjsLib, Tesseract) with NPM imports.

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
// @ts-ignore — Tesseract has its own bundled types but we use createWorker dynamically
import { createWorker } from 'tesseract.js';

import { COLORS, state, useStore, resetStoryboardState } from '../store/state';
import { setProgress, showToast } from './modals';
import { fhTrack } from './tracking';
import { updateFrameBadge } from './helpers';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  rw?: number;
  rh?: number;
  label?: string;
  labelItem?: TextItem | null;
  dedupedLabel?: boolean;
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExtractedFrame {
  src: string;
  label: string;
  cropW: number;
  cropH: number;
  textContent: string;
  ocrCrop?: HTMLCanvasElement | null;
  pageIdx?: number;
  sortX?: number;
  sortY?: number;
  // Position data (scale=2 page coords) for Adjust tool
  pageW?: number; pageH?: number;
  imgX?: number; imgY?: number; imgW?: number; imgH?: number;
  labelX?: number; labelY?: number; labelW?: number; labelH?: number;
  textX?: number; textY?: number; textW?: number; textH?: number;
}

async function renderPage(page: any, scale: number): Promise<HTMLCanvasElement> {
  const vp = page.getViewport({ scale });
  const pc = document.createElement('canvas');
  pc.width = Math.round(vp.width);
  pc.height = Math.round(vp.height);
  await page.render({ canvasContext: pc.getContext('2d')!, viewport: vp }).promise;
  return pc;
}

async function extractCandidates(
  page: any
): Promise<{ candidates: Candidate[]; inverted: boolean }> {
  const SCALE = 2;
  const vp = page.getViewport({ scale: SCALE });
  const W = Math.round(vp.width),
    H = Math.round(vp.height);

  const pc = await renderPage(page, SCALE);
  const px = pc.getContext('2d')!.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;

  const DARK = 200;
  // Helper: returns true for yellow-ish pixels (section headers like OPENING,
  // INSTORE, TAŠKY, MÜSLI …) and bright-red pixels (cross-out marks).
  // These are visually prominent but should not count as "dark frame content"
  // because they fill gaps between frames and pollute row/column profiling.
  function isColorNoise(idx: number): boolean {
    const r = px[idx], g = px[idx + 1], b = px[idx + 2];
    if (r > 200 && g > 150 && b < 120) return true;   // yellow
    if (r > 180 && g < 100 && b < 100) return true;    // red
    return false;
  }

  // Inset the row profile by ~4% on each side to ignore thick page borders.
  // Some PDFs (e.g. Armadillo) draw a 30pt stroked rectangle around the page;
  // its left/right borders inject dark pixels into every row, preventing the
  // profiler from detecting gaps between frame rows.  Excluding the edges
  // removes the border contribution while preserving frame content detection.
  const marginX = Math.round(W * 0.04);
  const profW = W - 2 * marginX;
  const rowProf = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = marginX; x < W - marginX; x++) {
      if (isColorNoise((y * W + x) * 4)) continue;
      if (gray[y * W + x] < DARK) s++;
    }
    rowProf[y] = s / profW;
  }

  function findBands(
    prof: Float32Array,
    len: number,
    highT: number,
    lowT: number,
    minSize: number
  ): { a: number; b: number }[] {
    const bands: { a: number; b: number }[] = [];
    let on = false,
      start = 0;
    for (let i = 0; i < len; i++) {
      if (!on && prof[i] >= highT) {
        on = true;
        start = i;
      } else if (on && prof[i] < lowT) {
        if (i - start >= minSize) bands.push({ a: start, b: i });
        on = false;
      }
    }
    if (on && len - start >= minSize) bands.push({ a: start, b: len });
    return bands;
  }

  let rowBands = findBands(rowProf, H, 0.08, 0.02, Math.round(H * 0.04));
  const rowBandsLow = findBands(rowProf, H, 0.04, 0.015, Math.round(H * 0.04));
  if (rowBandsLow.length > rowBands.length) rowBands = rowBandsLow;

  const overallDark = rowProf.reduce((a, b) => a + b, 0) / H;
  let useInverted = false;
  if (rowBands.length === 1 && rowBands[0].b - rowBands[0].a > H * 0.8 && overallDark > 0.5) {
    useInverted = true;
  }

  let activeRowBands = rowBands;
  // For inverted (dark-bg) pages, compute a proper light-pixel profile.
  // splitRowBand needs this to detect gaps correctly — using 1-rowProf
  // gives garbage (~0.01) when the page is 99% dark.
  let rowProfForSplit = rowProf;
  if (useInverted) {
    const LIGHT = 100;
    const rowProfLight = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = marginX; x < W - marginX; x++) if (gray[y * W + x] > LIGHT) s++;
      rowProfLight[y] = s / profW;
    }
    activeRowBands = findBands(rowProfLight, H, 0.05, 0.02, Math.round(H * 0.04));
    rowProfForSplit = rowProfLight;
  }

  const mergedRowBands: { a: number; b: number }[] = [];
  const MIN_GAP = Math.round(H * 0.02);
  for (const rb of activeRowBands) {
    const last = mergedRowBands.length > 0 ? mergedRowBands[mergedRowBands.length - 1] : null;
    if (last && rb.a - last.b < MIN_GAP) {
      const lastH = last.b - last.a, rbH = rb.b - rb.a;
      // Only merge bands of similar height — prevents thin label rows from
      // fusing with tall frame rows, which would create an oversized band that
      // fails the dominant-size filter and causes frame rows to be dropped.
      if (Math.min(lastH, rbH) / Math.max(lastH, rbH) > 0.5) {
        last.b = rb.b;
      } else {
        mergedRowBands.push({ ...rb });
      }
    } else {
      mergedRowBands.push({ ...rb });
    }
  }

  // Recursively split oversized row bands.  Two-tier thresholds:
  //   - If a CLEAR gap (near-zero dark pixels) is found inside, split bands
  //     as small as H*0.20 — this handles merged vertically-stacked frames.
  //   - Smoothed-minimum fallback only fires for truly large bands (> H*0.45)
  //     — this protects solid single-row frame bands (typically 30-35% of H)
  //     from being cut through the middle of a frame.
  function splitRowBand(rb: { a: number; b: number }): { a: number; b: number }[] {
    const bandH = rb.b - rb.a;
    // Below the gap-split threshold — never split
    if (bandH <= H * 0.20) return [rb];

    const searchA = rb.a + Math.round(bandH * 0.15);
    const searchB = rb.a + Math.round(bandH * 0.85);
    const gapThresh = 0.025;
    let bestGapStart = -1,
      bestGapEnd = -1,
      bestGapLen = 0;
    let gapStart = -1;
    for (let y = searchA; y < searchB; y++) {
      const val = rowProfForSplit[y];
      if (val < gapThresh) {
        if (gapStart < 0) gapStart = y;
      } else {
        if (gapStart >= 0) {
          const len = y - gapStart;
          if (len > bestGapLen) {
            bestGapLen = len;
            bestGapStart = gapStart;
            bestGapEnd = y;
          }
        }
        gapStart = -1;
      }
    }
    if (gapStart >= 0) {
      const len = searchB - gapStart;
      if (len > bestGapLen) {
        bestGapLen = len;
        bestGapStart = gapStart;
        bestGapEnd = searchB;
      }
    }
    // Clear gap found — split even for smaller bands
    if (bestGapLen >= Math.round(H * 0.005)) {
      const splitRow = Math.round((bestGapStart + bestGapEnd) / 2);
      return [
        ...splitRowBand({ a: rb.a, b: splitRow }),
        ...splitRowBand({ a: splitRow, b: rb.b }),
      ];
    }
    // No clear gap found — don't split. The smoothed-minimum fallback was
    // removed because it wrongly splits tall single-row bands (e.g. pages
    // with large frames + text below) at local dips in dark-pixel density.
    return [rb];
  }

  const finalRowBands = mergedRowBands.flatMap(splitRowBand);

  const colProf = new Float32Array(W);
  if (finalRowBands.length > 0) {
    // Only use tall row bands for the column profile — short bands are label/caption
    // rows whose text fills column gaps and prevents frame separation.
    const tallBands = finalRowBands.filter(rb => rb.b - rb.a >= Math.round(H * 0.08));
    const colSrcBands = tallBands.length > 0 ? tallBands : finalRowBands;
    let totalRows = 0;
    for (const rb of colSrcBands) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        if (useInverted) {
          const LIGHT = 100;
          for (let y = rb.a; y < rb.b; y++) if (gray[y * W + x] > LIGHT) s++;
        } else {
          for (let y = rb.a; y < rb.b; y++) {
            if (isColorNoise((y * W + x) * 4)) continue;
            if (gray[y * W + x] < DARK) s++;
          }
        }
        colProf[x] += s;
      }
      totalRows += rb.b - rb.a;
    }
    for (let x = 0; x < W; x++) colProf[x] /= totalRows;
  } else {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = 0; y < H; y++) if (gray[y * W + x] < DARK) s++;
      colProf[x] = s / H;
    }
  }
  const colBands = useInverted
    ? findBands(colProf, W, 0.05, 0.02, Math.round(W * 0.04))
    : findBands(colProf, W, 0.04, 0.01, Math.round(W * 0.04));

  // Recursively split wide column bands so adjacent frames aren't merged
  function splitColBand(band: { a: number; b: number }): { a: number; b: number }[] {
    const bandW = band.b - band.a;
    if (bandW <= W * 0.25) return [band];
    const searchA = band.a + Math.round(bandW * 0.15);
    const searchB = band.a + Math.round(bandW * 0.85);
    const gapThresh = 0.015;
    let bestGapStart = -1, bestGapEnd = -1, bestGapLen = 0, gapStart = -1;
    for (let cx = searchA; cx < searchB; cx++) {
      const val = useInverted ? 1 - colProf[cx] : colProf[cx];
      if (val < gapThresh) {
        if (gapStart < 0) gapStart = cx;
      } else {
        if (gapStart >= 0) {
          const len = cx - gapStart;
          if (len > bestGapLen) { bestGapLen = len; bestGapStart = gapStart; bestGapEnd = cx; }
          gapStart = -1;
        }
      }
    }
    if (gapStart >= 0) {
      const len = searchB - gapStart;
      if (len > bestGapLen) { bestGapLen = len; bestGapStart = gapStart; bestGapEnd = searchB; }
    }
    if (bestGapLen < Math.round(W * 0.005)) return [band];
    const mid = Math.round((bestGapStart + bestGapEnd) / 2);
    return [...splitColBand({ a: band.a, b: mid }), ...splitColBand({ a: mid, b: band.b })];
  }
  const finalColBands = colBands.flatMap(splitColBand);


  if (finalRowBands.length === 0 || finalColBands.length === 0)
    return { candidates: [], inverted: useInverted };

  const candidates: Candidate[] = [];
  for (const rb of finalRowBands) {
    for (const cb of finalColBands) {
      const x = cb.a,
        y = rb.a,
        w = cb.b - cb.a,
        h = rb.b - rb.a;
      if (w < W * 0.06 || h < H * 0.04) continue;
      if (w * h > W * H * 0.9) continue;
      if (w < h) continue;
      let dark = 0,
        total = 0,
        sumG = 0,
        sumGsq = 0;
      const step = 4;
      for (let sy = y; sy < y + h; sy += step)
        for (let sx = x; sx < x + w; sx += step) {
          const g = gray[sy * W + sx];
          if (useInverted ? g > 100 : g < DARK) dark++;
          sumG += g;
          sumGsq += g * g;
          total++;
        }
      if (dark / total < 0.02) continue;
      const mean = sumG / total;
      const variance = sumGsq / total - mean * mean;
      // Reject low-variance regions only when they're light-toned (empty slots,
      // title cards, solid-colored boxes). Dark solid regions (e.g. a "black
      // screen" storyboard shot) have mean ≈ 0 and near-zero variance but are
      // valid frames — don't reject them.
      if (mean > 160 && variance < 800) continue;
      candidates.push({ x, y, w, h });
    }
  }

  const kept: Candidate[] = [];
  candidates.sort((a, b) => b.w * b.h - a.w * a.h);
  for (const c of candidates) {
    const dup = kept.some((k) => {
      const ix = Math.max(0, Math.min(c.x + c.w, k.x + k.w) - Math.max(c.x, k.x));
      const iy = Math.max(0, Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y));
      if (ix <= 0 || iy <= 0) return false;
      return (ix * iy) / Math.min(c.w * c.h, k.w * k.h) > 0.4;
    });
    if (!dup) kept.push(c);
  }

  kept.sort((a, b) => {
    const rb = Math.round(H * 0.1);
    const ra = Math.floor(a.y / rb),
      rb2 = Math.floor(b.y / rb);
    return ra !== rb2 ? ra - rb2 : a.x - b.x;
  });

  return { candidates: kept, inverted: useInverted };
}

export async function getTextItems(page: any, scale: number): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale });
  const raw: TextItem[] = content.items
    .filter((i: any) => i.str && i.str.trim())
    .map((item: any) => {
      const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
      const h = (item.height || 10) * scale;
      const w = (item.width || 10) * scale;
      return { text: item.str.trim(), x: tx[4], y: tx[5] - h, w, h };
    });

  const combined: TextItem[] = [];
  let i = 0;
  while (i < raw.length) {
    const item = raw[i];
    if (i + 1 < raw.length) {
      const next = raw[i + 1];
      const sameLine = Math.abs(next.y - item.y) < item.h * 1.5;
      const closeX = next.x - item.x < item.w * 4;
      if (/^\d{1,3}[A-Z]?$/.test(item.text) && i + 3 < raw.length) {
        const n2 = raw[i + 2],
          n3 = raw[i + 3];
        const sameLine3 = Math.abs(n2.y - item.y) < item.h * 1.5 && Math.abs(n3.y - item.y) < item.h * 1.5;
        if (/^[-/]$/.test(next.text) && /^alt\.?$/i.test(n2.text) && /^[A-Z]$/.test(n3.text) && sameLine3) {
          combined.push({
            text: `${item.text} - alt ${n3.text}`,
            x: item.x,
            y: item.y,
            w: n3.x + n3.w - item.x,
            h: item.h,
          });
          i += 4;
          continue;
        }
      }
      if (/^FRAME$/i.test(item.text) && sameLine && closeX) {
        combined.push({
          text: `FRAME ${next.text}`,
          x: item.x,
          y: item.y,
          w: next.x + next.w - item.x,
          h: item.h,
        });
        i += 2;
        continue;
      }
      // Combine scene-identifier prefixes like "AE" + "28" → "AE 28"
      // so the number isn't mistaken for a standalone frame label.
      if (
        /^[A-Z]{1,4}$/i.test(item.text) &&
        !/^FRAME$/i.test(item.text) &&
        /^\d{1,3}$/.test(next.text) &&
        sameLine &&
        closeX
      ) {
        combined.push({
          text: `${item.text} ${next.text}`,
          x: item.x,
          y: item.y,
          w: next.x + next.w - item.x,
          h: item.h,
        });
        i += 2;
        continue;
      }
      if (/^\d{1,3}$/.test(item.text) && /^[A-Z]\)$/.test(next.text) && sameLine && closeX) {
        combined.push({
          text: `${item.text} ${next.text}`,
          x: item.x,
          y: item.y,
          w: next.x + next.w - item.x,
          h: item.h,
        });
        i += 2;
        continue;
      }
      // Combine split label fragments: "11" + "a." → "11a."
      // Some PDF generators (Illustrator/InDesign) store digits and suffix in
      // separate text runs.  Without this, "11a" and "11b" both resolve to
      // "11" and the second frame gets deduped and loses its label entirely.
      if (
        /^\d{1,3}$/.test(item.text) &&
        /^[a-z]\.?$/.test(next.text) &&
        sameLine &&
        closeX
      ) {
        combined.push({
          text: `${item.text}${next.text}`,
          x: item.x,
          y: item.y,
          w: next.x + next.w - item.x,
          h: item.h,
        });
        i += 2;
        continue;
      }
      const belowLine = next.y > item.y && next.y < item.y + item.h * 3;
      const sameColumn = Math.abs(next.x - item.x) < item.w * 1.5;
      if (
        /^\d{1,3}:\d{1,3}$/.test(item.text) &&
        /^[a-z]$/.test(next.text) &&
        belowLine &&
        sameColumn
      ) {
        combined.push({
          text: `${item.text}${next.text}`,
          x: item.x,
          y: item.y,
          w: item.w,
          h: next.y + next.h - item.y,
        });
        i += 2;
        continue;
      }
    }
    combined.push(item);
    i++;
  }
  return combined;
}

function isLabel(t: string): boolean {
  t = t.trim();
  return (
    /^\d{1,3}$/.test(t) ||
    /^\d{1,3}\.$/.test(t) ||
    /^\d{1,3}[A-Z]$/i.test(t) ||
    /^\d{1,3}[A-Z]\.$/i.test(t) ||
    /^\d{1,3}\.[A-Z]$/i.test(t) ||
    /^\d{1,3}\.[A-Z]\.$/i.test(t) ||
    /^\d{1,3}[A-Z]?\s*[-/]\s*alt$/i.test(t) ||
    /^\d{1,3}[A-Z]?\s+alt$/i.test(t) ||
    /^\d{1,3}[A-Z]?\s*-\s*alt\s*[A-Z]$/i.test(t) ||
    /^\d{1,3}[A-Z]?\s*\/?optional\/?$/i.test(t) ||
    /^FRAME\s+\d{1,3}[A-Z]?$/i.test(t) ||
    /^NEW\s+SHOT\s+[A-Z]$/i.test(t) ||
    /^\d{1,3}\s+[A-Z]\)$/.test(t) ||
    // Timecode-style labels like "1:30a" — but NOT "9:16" aspect-ratio tags.
    // Reject pure N:N patterns where the second number is 9, 16, or 1 (common AR annotations).
    (/^\d{1,3}:\d{1,3}$/.test(t) && !/^(?:9|16|1):(?:9|16|1)$/.test(t)) ||
    /^\d{1,3}:\d{1,3}[a-z]$/.test(t)
  );
}

export function matchLabel(
  items: TextItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  returnItem?: boolean
): { text: string; item: TextItem } | string | null {
  let best: string | null = null,
    bestScore = Infinity,
    bestItem: TextItem | null = null;
  for (const item of items) {
    if (!isLabel(item.text)) continue;
    const lx0 = item.x,
      ly0 = item.y,
      lx1 = item.x + item.w,
      ly1 = item.y + item.h,
      lcy = (ly0 + ly1) / 2;
    const condLeft = lx1 <= x + 10 && lx0 >= x - 150 && y - 80 <= lcy && lcy <= y + h + 80;
    const condAbove = ly1 <= y + 10 && y - ly1 <= 160 && lx0 >= x - 80 && lx0 <= x + w * 0.4;
    const condTopLeft = x - 150 <= lx0 && lx0 <= x + w * 0.25 && y - 150 <= ly0 && ly0 <= y + 30;
    const condTopRight = lx0 >= x + w - 10 && lx0 <= x + w + 150 && y - 60 <= ly0 && ly0 <= y + Math.max(30, h * 0.15);
    const condBottomLeft = x - 150 <= lx0 && lx0 <= x + w * 0.25 && y + h * 0.6 <= ly0 && ly0 <= y + h + 15;
    const condBelow = ly0 >= y + h - 20 && ly0 <= y + h + 40 && lx0 >= x - 80 && lx0 <= x + w * 0.5;
    if (condLeft || condAbove || condTopLeft || condTopRight || condBottomLeft || condBelow) {
      let score: number;
      if (condTopLeft || condAbove) {
        score = Math.abs(lx0 - x) + Math.abs(ly0 - y);
      } else if (condTopRight) {
        score = Math.abs(lx0 - (x + w)) + Math.abs(ly0 - y);
      } else if (condLeft) {
        score = Math.abs(lx1 - x) + Math.abs(lcy - (y + h / 2));
      } else {
        score = Math.abs(lx0 - x) + Math.abs(ly0 - (y + h));
      }
      if (score < bestScore) {
        bestScore = score;
        best = item.text.trim();
        bestItem = item;
      }
    }
  }
  if (!best) return returnItem ? null : null;
  const ANNOT = /^(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i;
  for (const item of items) {
    if (!ANNOT.test(item.text.trim())) continue;
    const nearX = Math.abs(item.x - bestItem!.x) < bestItem!.w * 3;
    const nearY = item.y >= bestItem!.y - bestItem!.h * 3 && item.y <= bestItem!.y + bestItem!.h * 4;
    if (nearX && nearY) {
      best = best + ' ' + item.text.trim();
      break;
    }
  }
  if (returnItem) return { text: best!, item: bestItem! };
  return best;
}

export function matchText(
  items: TextItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  maxY?: number
): string {
  // Allow text slightly beyond the next row (captions can overlap row boundaries)
  const limit = maxY ? maxY + Math.round(h * 0.25) : y + h + 300;
  // Collect text BELOW the frame (traditional layout)
  const belowItems: TextItem[] = [];
  // Collect text to the RIGHT of the frame (vertical layout — limit distance
  // to avoid capturing text from adjacent columns in multi-column grids)
  const rightItems: TextItem[] = [];
  const rightLimit = x + w + Math.round(w * 0.5);
  for (const item of items) {
    if (isLabel(item.text)) continue;
    const iy = item.y,
      ix = item.x;
    // Below: text starts near/below frame bottom, within frame x range
    if (iy >= y + h - 10 && iy <= limit && ix + item.w >= x - 20 && ix <= x + w + 20) {
      belowItems.push(item);
    }
    // Right: text starts to the right of frame, within half a frame width
    if (ix > x + w - 10 && ix < rightLimit && iy >= y - 20 && iy <= y + h + 20) {
      rightItems.push(item);
    }
  }

  // Use whichever zone captured more text
  const collected = rightItems.length > belowItems.length ? rightItems : belowItems;
  collected.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: TextItem[][] = [];
  for (const item of collected) {
    if (lines.length > 0 && Math.abs(item.y - lines[lines.length - 1][0].y) < 12) {
      lines[lines.length - 1].push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines.map((ln) => ln.map((i) => i.text).join(' ')).join('\n').trim();
}

export async function handlePDF(file: File): Promise<void> {
  fhTrack('pdf_loaded');
  const lastPdfName = file.name.replace(/\.pdf$/i, '');
  resetStoryboardState();
  useStore.setState({ lastPdfName });
  document.getElementById('progressOverlay')!.classList.remove('hidden');
  setProgress(0, 'Loading PDF…');
  try {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

    setProgress(5, 'Scanning pages…');
    const allCandidates: any[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      setProgress(5 + Math.round((p / pdf.numPages) * 40), `Scanning page ${p} of ${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const pageW = Math.round(vp.width),
        pageH = Math.round(vp.height);
      const result = await extractCandidates(page);
      const candidates = result.candidates;
      candidates.forEach((c) => {
        c.rw = c.w / pageW;
        c.rh = c.h / pageH;
      });
      allCandidates.push({ page, candidates, pageNum: p, pageW, pageH, inverted: result.inverted });
      console.log(`[StripBoard] Page ${p}: ${candidates.length} candidates (${pageW}x${pageH})`);
    }

    const allSizes = allCandidates.flatMap((pc) => pc.candidates).map((c: any) => ({ rw: c.rw, rh: c.rh }));
    let dominantRW: number | null = null,
      dominantRH: number | null = null;
    if (allSizes.length > 0) {
      const rws = allSizes.map((s: any) => s.rw).sort((a: number, b: number) => a - b);
      const rhs = allSizes.map((s: any) => s.rh).sort((a: number, b: number) => a - b);
      const medRW = rws[Math.floor(rws.length / 2)];
      const medRH = rhs[Math.floor(rhs.length / 2)];
      const TOLERANCE = 0.3;
      const matching = allSizes.filter(
        (s: any) =>
          Math.abs(s.rw - medRW) / medRW < TOLERANCE && Math.abs(s.rh - medRH) / medRH < TOLERANCE
      );
      if (matching.length / allSizes.length > 0.35) {
        dominantRW = medRW;
        dominantRH = medRH;
      }
    }

    const allFrames: ExtractedFrame[] = [];
    const labelAnchors: any[] = [];
    const pageTextItems: TextItem[][] = [];
    for (let i = 0; i < allCandidates.length; i++) {
      setProgress(50 + Math.round((i / allCandidates.length) * 40), `Extracting page ${i + 1} of ${allCandidates.length}…`);
      const { page, candidates, pageW, pageH } = allCandidates[i];
      const textItems = await getTextItems(page, 2);
      pageTextItems.push(textItems);
      const pc = await renderPage(page, 2);

      const TOLERANCE = 0.3;
      let filtered = dominantRW
        ? candidates.filter(
            (c: any) => {
              const rwOk = Math.abs(c.rw - dominantRW!) / dominantRW! < TOLERANCE;
              const rhOk = Math.abs(c.rh - dominantRH!) / dominantRH! < TOLERANCE;
              return rwOk && rhOk;
            }
          )
        : candidates;

      // Extra guard: reject candidates whose aspect ratio (w/h) deviates more
      // than 60% from the dominant aspect ratio.  This catches thin text-strip
      // bands (AR >> 1) that survive the independent rw/rh checks because
      // their individual dimension tolerances are met individually.
      if (dominantRW && dominantRH) {
        const domAR = dominantRW / dominantRH;
        filtered = filtered.filter((c: any) => {
          const ar = c.rw / c.rh;
          return Math.abs(ar - domAR) / domAR < 0.6;
        });
      }

      if (dominantRW && filtered.length >= 2 && filtered.length < candidates.length) {
        const removed = candidates.filter((c: any) => !filtered.includes(c));
        if (
          removed.length === filtered.length &&
          removed.every((c: any) => Math.abs(c.rw - dominantRW!) / dominantRW! < TOLERANCE)
        ) {
          const remMaxBot = Math.max(...removed.map((c: any) => c.y + c.h));
          const filMinTop = Math.min(...filtered.map((c: any) => c.y));
          if (remMaxBot < filMinTop - pageH * 0.02) {
            const remXs = removed.map((c: any) => c.x).sort((a: number, b: number) => a - b);
            const filXs = filtered.map((c: any) => c.x).sort((a: number, b: number) => a - b);
            let aligned = true;
            for (let ai = 0; ai < remXs.length; ai++) {
              if (Math.abs(remXs[ai] - filXs[ai]) > pageW * 0.05) {
                aligned = false;
                break;
              }
            }
            if (aligned) {
              console.log(
                `[StripBoard] Illustration-over-text swap: using ${removed.length} top-row candidates instead of ${filtered.length} bottom-row`
              );
              filtered = removed;
            }
          }
        }
      }

      if (dominantRH) {
        const pxRef = pc.getContext('2d')!.getImageData(0, 0, pc.width, pc.height).data;
        for (let ci = 0; ci < filtered.length; ci++) {
          const c = filtered[ci];
          if (c.rh <= dominantRH * 1.15) continue;
          const BORDER_DARK = 120;
          for (let dy = c.h - 1; dy > c.h * 0.35; dy--) {
            let darkRun = 0,
              maxRun = 0;
            for (let dx = 0; dx < c.w; dx++) {
              const idx = ((c.y + dy) * pageW + (c.x + dx)) * 4;
              const g = (pxRef[idx] + pxRef[idx + 1] + pxRef[idx + 2]) / 3;
              if (g < BORDER_DARK) {
                darkRun++;
                if (darkRun > maxRun) maxRun = darkRun;
              } else darkRun = 0;
            }
            if (maxRun > c.w * 0.5) {
              c.h = dy + 3;
              c.rh = c.h / pageH;
              break;
            }
          }
        }
      }

      const withLabels: Candidate[] = filtered.map((c: any) => {
        const m = matchLabel(textItems, c.x, c.y, c.w, c.h, true) as { text: string; item: TextItem } | null;
        return { ...c, label: m ? m.text : '', labelItem: m ? m.item : null };
      });

      // Dedup labels: when multiple candidates claim the same label, keep it
      // on the one whose area is closest to the median (dominant) frame size.
      // This prevents header/junk candidates from stealing labels from real frames.
      const labelMap = new Map<string, Candidate[]>();
      for (const c of withLabels) {
        if (!c.label) continue;
        const arr = labelMap.get(c.label) || [];
        arr.push(c);
        labelMap.set(c.label, arr);
      }
      const allAreas = withLabels.map(c => c.w * c.h).sort((a, b) => a - b);
      const medArea = allAreas[Math.floor(allAreas.length / 2)] || 1;
      for (const [, cands] of labelMap) {
        if (cands.length <= 1) continue;
        // Keep label on candidate closest to median area
        cands.sort((a, b) =>
          Math.abs(a.w * a.h - medArea) - Math.abs(b.w * b.h - medArea)
        );
        for (let ci = 1; ci < cands.length; ci++) {
          cands[ci].label = '';
          cands[ci].dedupedLabel = true;
        }
      }

      const labelled = withLabels.filter((c) => c.label);
      let finalCandidates = withLabels;
      if (labelled.length >= 2) {
        const lws = labelled.map((c) => c.w).sort((a, b) => a - b);
        const lhs = labelled.map((c) => c.h).sort((a, b) => a - b);
        const refW = lws[Math.floor(lws.length / 2)];
        const refH = lhs[Math.floor(lhs.length / 2)];
        const T = 0.35;
        const sizeOk = (c: Candidate) => Math.abs(c.w - refW) / refW < T && Math.abs(c.h - refH) / refH < T;
        finalCandidates = withLabels.filter(
          (c) => c.label || (c.dedupedLabel && sizeOk(c)) || sizeOk(c)
        );
      }

      // (Proximity dedup removed — correct picture extraction takes priority
      // over eliminating duplicate candidates.  The label-order correction and
      // dominant-size filter handle the most common false positives.)

      // Label-order correction: when frames are stacked vertically (single
      // column), ensure the labels assigned match spatial top-to-bottom order.
      // A slightly-offset label (e.g. "1A" sitting lower than others) can
      // cause matchLabel to assign it to the wrong frame.  Fix: collect the
      // numbered labels, sort them numerically, and re-assign them to frames
      // sorted by Y position so spatial order = label order.
      {
        const sorted = [...finalCandidates].sort((a, b) => a.y - b.y);
        // Detect vertical stack: all frames roughly in the same X column
        const xs = sorted.map(c => c.x);
        const xRange = Math.max(...xs) - Math.min(...xs);
        const isVertical = sorted.length >= 2 && xRange < (sorted[0].w || 100) * 0.5;
        if (isVertical) {
          // Collect labels with a numeric prefix, keep their order
          const numberedLabels: { idx: number; label: string; num: number; suffix: string }[] = [];
          for (let ci = 0; ci < sorted.length; ci++) {
            const lbl = sorted[ci].label || '';
            const m = lbl.match(/^(\d+)(.*)$/);
            if (m) numberedLabels.push({ idx: ci, label: lbl, num: parseInt(m[1]), suffix: m[2] });
          }
          if (numberedLabels.length >= 2) {
            // Sort labels numerically, then by suffix
            const labelsSorted = [...numberedLabels].sort((a, b) =>
              a.num !== b.num ? a.num - b.num : a.suffix.localeCompare(b.suffix)
            );
            // Check if label order already matches spatial order
            const needsFix = numberedLabels.some((nl, i) => nl.label !== labelsSorted[i]?.label);
            if (needsFix) {
              console.log(`[StripBoard] Label-order fix: spatial order doesn't match label order, reassigning`);
              // Re-assign: the topmost frame gets the lowest label, etc.
              for (let ci = 0; ci < numberedLabels.length; ci++) {
                sorted[numberedLabels[ci].idx].label = labelsSorted[ci].label;
              }
            }
          }
        }
        finalCandidates = sorted;
      }

      console.log(
        `[StripBoard] Page ${i + 1}: ${candidates.length} raw → ${filtered.length} dom-filtered → ${
          finalCandidates.length
        } final (labels: ${labelled.length})`
      );
      if (finalCandidates.length === 0) continue;

      const rowTops = [...new Set(finalCandidates.map((c) => c.y))].sort((a, b) => a - b);
      const rowClusters: number[] = [];
      for (const yt of rowTops) {
        if (rowClusters.length === 0 || yt - rowClusters[rowClusters.length - 1] > 40) rowClusters.push(yt);
      }

      for (const c of finalCandidates) {
        const pad = 3;
        const cx = Math.max(0, c.x - pad),
          cy = Math.max(0, c.y - pad);
        const cw = Math.min(pc.width - cx, c.w + pad * 2),
          ch = Math.min(pc.height - cy, c.h + pad * 2);
        const crop = document.createElement('canvas');
        crop.width = cw;
        crop.height = ch;
        crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);
        const nextRowY = rowClusters.find((ry) => ry > c.y + c.h * 0.5);
        const maxY = nextRowY !== undefined ? nextRowY : pageH;
        // Allow text slightly beyond next row (captions can overlap row boundaries)
        const extMaxY = Math.min(pageH, maxY + Math.round(c.h * 0.25));
        const txt = matchText(textItems, c.x, c.y, c.w, c.h, maxY);
        let ocrCrop: HTMLCanvasElement | null = null;
        if (!txt) {
          const tRegionY = c.y + c.h;
          const tRegionH = Math.min(extMaxY, pageH) - tRegionY;
          if (tRegionH > 10) {
            ocrCrop = document.createElement('canvas');
            const ocrX = Math.max(0, c.x - 10);
            const ocrW = Math.min(pc.width - ocrX, c.w + 20);
            ocrCrop.width = ocrW;
            ocrCrop.height = Math.round(tRegionH);
            ocrCrop.getContext('2d')!.drawImage(
              pc,
              ocrX,
              Math.round(tRegionY),
              ocrW,
              Math.round(tRegionH),
              0,
              0,
              ocrW,
              Math.round(tRegionH)
            );
          }
        }
        // Compute text bounding box for Adjust tool.
        // RULE: text area must NEVER overlap the image area — text is never
        // read from inside a picture.  The image rect defines the boundary.
        let _tX: number | undefined, _tY: number | undefined, _tW: number | undefined, _tH: number | undefined;
        if (txt) {
          const _rightLimit = c.x + c.w + Math.round(c.w * 0.5);
          const belowItems = textItems.filter(item => !isLabel(item.text) && item.y >= c.y + c.h - 10 && item.y <= extMaxY && item.x + item.w >= c.x - 20 && item.x <= c.x + c.w + 20);
          const rightItems = textItems.filter(item => !isLabel(item.text) && item.x > c.x + c.w - 10 && item.x < _rightLimit && item.y >= c.y - 20 && item.y <= c.y + c.h + 20);
          const matched = rightItems.length > belowItems.length ? rightItems : belowItems;
          if (matched.length > 0) {
            _tX = Math.min(...matched.map(it => it.x)); _tY = Math.min(...matched.map(it => it.y));
            _tW = Math.max(...matched.map(it => it.x + it.w)) - _tX; _tH = Math.max(...matched.map(it => it.y + it.h)) - _tY;
            // Clamp: text bbox must not enter the image area
            const imgBottom = c.y + c.h;
            const imgRight = c.x + c.w;
            if (rightItems.length > belowItems.length) {
              // Text is to the right of the image — left edge must be at or past image right
              if (_tX < imgRight) { _tW -= (imgRight - _tX); _tX = imgRight; }
            } else {
              // Text is below the image — top edge must be at or past image bottom
              if (_tY < imgBottom) { _tH -= (imgBottom - _tY); _tY = imgBottom; }
            }
            // If clamping made the box invalid, discard it
            if (_tW <= 0 || _tH <= 0) { _tX = _tY = _tW = _tH = undefined; }
          }
        } else if (ocrCrop) {
          _tX = Math.max(0, c.x - 10); _tY = c.y + c.h;
          _tW = Math.min(pc.width - _tX, c.w + 20);
          // Default rect: cap at ~3 lines of text so it wraps tighter
          // (user can extend if text is longer; ocrCrop canvas still scans full area)
          const ocrAvail = Math.min(extMaxY, pageH) - _tY;
          _tH = Math.min(Math.round(c.h * 0.35), 150, ocrAvail);
        }
        allFrames.push({
          src: crop.toDataURL('image/jpeg', 0.93),
          label: c.label || '',
          cropW: cw,
          cropH: ch,
          textContent: txt,
          ocrCrop,
          pageIdx: i,
          pageW, pageH,
          imgX: c.x, imgY: c.y, imgW: c.w, imgH: c.h,
          labelX: c.labelItem?.x, labelY: c.labelItem?.y, labelW: c.labelItem?.w, labelH: c.labelItem?.h,
          textX: _tX, textY: _tY, textW: _tW, textH: _tH,
        });
        if (c.label && c.labelItem) {
          const li = c.labelItem;
          labelAnchors.push({
            lx: li.x,
            ly: li.y,
            lw: li.w,
            lh: li.h,
            fx: c.x,
            fy: c.y,
            fw: c.w,
            fh: c.h,
            pageW,
            pageH,
          });
        }
      }

    }

    // Late label assignment: for pages where some frames have no label and
    // there are unused label-text items on that page, assign by vertical order.
    // This handles layouts where labels sit in a text column far from the
    // frame images (e.g. vertical storyboards with right-side text).
    {
      const usedLabelsSet = new Set<string>();
      for (const f of allFrames) {
        if (!f.label) continue;
        usedLabelsSet.add(f.label);
        const base = f.label.replace(/\s+(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i, '').trim();
        if (base) usedLabelsSet.add(base);
      }
      for (let pi = 0; pi < allCandidates.length; pi++) {
        const pageFrames = allFrames.filter(f => f.pageIdx === pi);
        const unlabeled = pageFrames.filter(f => !f.label);
        if (unlabeled.length === 0) continue;
        const textItems = pageTextItems[pi];
        // Find unused label items on this page, sorted by Y
        const unusedLabels = textItems
          .filter(it => isLabel(it.text) && !usedLabelsSet.has(it.text.trim()))
          .sort((a, b) => a.y - b.y);
        if (unusedLabels.length === 0) continue;
        // Sort unlabeled frames by their Y position (sortY or index order)
        unlabeled.sort((a, b) => {
          const ai = allFrames.indexOf(a), bi = allFrames.indexOf(b);
          return ai - bi;
        });
        // Assign labels to frames in order: first unused label → first unlabeled frame
        // Match by vertical sequence position, not proximity
        let li = 0;
        for (const frame of unlabeled) {
          if (li >= unusedLabels.length) break;
          const lateLbl = unusedLabels[li];
          frame.label = lateLbl.text.trim();
          // Also store label coordinates so Adjust tool can create rects
          frame.labelX = lateLbl.x;
          frame.labelY = lateLbl.y;
          frame.labelW = lateLbl.w;
          frame.labelH = lateLbl.h;
          usedLabelsSet.add(frame.label);
          console.log(`[StripBoard] Late label assign: page ${pi + 1}, "${frame.label}" → frame at position ${allFrames.indexOf(frame)} (${lateLbl.x},${lateLbl.y})`);
          li++;
        }
      }
    }

    if (labelAnchors.length >= 2 && allFrames.some((f) => f.label)) {
      const dxs = labelAnchors.map((a) => (a.fx - a.lx) / a.pageW);
      const dys = labelAnchors.map((a) => (a.fy - a.ly) / a.pageH);
      const fws = labelAnchors.map((a) => a.fw / a.pageW);
      const fhs = labelAnchors.map((a) => a.fh / a.pageH);
      const median = (arr: number[]) => {
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      const medDX = median(dxs),
        medDY = median(dys);
      const medFW = median(fws),
        medFH = median(fhs);
      console.log(
        `[StripBoard] Label-anchor: ${labelAnchors.length} anchors, medDX=${medDX.toFixed(3)}, medDY=${medDY.toFixed(3)}, medFW=${medFW.toFixed(3)}, medFH=${medFH.toFixed(3)}`
      );
      const existingNums = allFrames
        .map((f) => parseInt((f.label || '').match(/^(\d+)/)?.[1] || ''))
        .filter((n) => !isNaN(n));
      const expectedNums = new Set<number>();
      let minN = 0;
      if (existingNums.length >= 2) {
        const sorted = [...new Set(existingNums)].sort((a, b) => a - b);
        minN = sorted[0];
        const maxN = sorted[sorted.length - 1];
        const steps: number[] = [];
        for (let si = 1; si < sorted.length; si++) steps.push(sorted[si] - sorted[si - 1]);
        const stepCounts: Record<number, number> = {};
        for (const st of steps) stepCounts[st] = (stepCounts[st] || 0) + 1;
        const stepEntries = Object.entries(stepCounts).sort((a, b) => b[1] - a[1]);
        const typicalStep = stepEntries.length > 0 ? parseInt(stepEntries[0][0]) || 1 : 1;
        for (let n = minN; n <= maxN + typicalStep; n++) {
          if (!existingNums.includes(n)) expectedNums.add(n);
        }
      }
      console.log(
        `[StripBoard] Label-anchor: existing nums=${JSON.stringify([...new Set(existingNums)].sort((a, b) => a - b))}, expected gaps=${JSON.stringify([...expectedNums])}`
      );
      const zeroFramePages = new Set<number>();
      for (let pi = 0; pi < allCandidates.length; pi++) {
        if (!allFrames.some((f) => f.pageIdx === pi)) zeroFramePages.add(pi);
      }
      console.log(`[StripBoard] Label-anchor: zero-frame pages=${JSON.stringify([...zeroFramePages])}`);
      if (expectedNums.size === 0 && zeroFramePages.size === 0) {
        console.log('[StripBoard] Label-anchor: no gaps to fill and no zero-frame pages, skipping recovery');
      } else {
        const usedLabels = new Set<string>();
        for (const f of allFrames) {
          if (!f.label) continue;
          usedLabels.add(f.label);
          // Also add the base label without annotation suffixes like "OPTIONAL",
          // "alt", etc. — otherwise "1B" looks unused when stored as "1B OPTIONAL".
          const base = f.label.replace(/\s+(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i, '').trim();
          if (base) usedLabels.add(base);
        }
        const recovered: ExtractedFrame[] = [];
        for (let pi = 0; pi < allCandidates.length; pi++) {
          const { page, pageW, pageH } = allCandidates[pi];
          const textItems = pageTextItems[pi];
          const isZeroPage = zeroFramePages.has(pi);
          const pageLabels = textItems.filter((it) => {
            if (!isLabel(it.text)) return false;
            const t = it.text.trim();
            if (usedLabels.has(t)) return false;
            if (isZeroPage) return true;
            // Suffixed labels (e.g. "7a.", "4b") are always distinct frames — recover if unused
            if (/^\d{1,3}[a-zA-Z]\.?$/.test(t)) return true;
            const num = parseInt((t.match(/^(\d+)/) || [])[1]);
            if (isNaN(num)) return false;
            // Recover if in expected sequence, or if below minN (early frames often
            // fall below the sequence minimum when only a few frames were extracted)
            return expectedNums.has(num) || num < minN;
          });
          if (pageLabels.length === 0) continue;
          const pc = await renderPage(page, 2);
          for (const tl of pageLabels) {
            const labelText = tl.text.trim();
            if (usedLabels.has(labelText)) continue;
            const fx = Math.max(0, Math.round(tl.x + medDX * pageW));
            const fy = Math.max(0, Math.round(tl.y + medDY * pageH));
            const estFW = Math.round(medFW * pageW),
              estFH = Math.round(medFH * pageH);
            const fw = Math.min(estFW, pc.width - fx);
            const fh = Math.min(estFH, pc.height - fy);
            if (fw < 30 || fh < 30) continue;
            if (fw < estFW * 0.5 || fh < estFH * 0.5) continue;
            if (fw < fh * 0.7) continue;
            // Pixel-content check: reject recovered frames that land on blank or
            // uniform areas. Page-number text ("24", "38") can pass isLabel() and
            // trigger recovery, but the computed frame position has no image content.
            {
              const imgData = pc.getContext('2d')!.getImageData(fx, fy, fw, fh);
              const d = imgData.data;
              const recStep = 4;
              let recDark = 0, recN = 0, recSG = 0, recSG2 = 0;
              for (let si = 0; si < fw * fh; si += recStep) {
                const ri = si * 4;
                const g = (d[ri] + d[ri + 1] + d[ri + 2]) / 3;
                if (g < 200) recDark++;
                recSG += g; recSG2 += g * g; recN++;
              }
              const recMean = recSG / recN;
              const recVar = recSG2 / recN - recMean * recMean;
              if (recDark / recN < 0.02 || recVar < 800) {
                console.log(`[StripBoard] Recovery: skipped "${labelText}" — blank region (dark=${(recDark/recN).toFixed(3)}, var=${recVar.toFixed(0)})`);
                continue;
              }
            }
            const pad = 3;
            const cx = Math.max(0, fx - pad),
              cy = Math.max(0, fy - pad);
            const cw = Math.min(pc.width - cx, fw + pad * 2),
              ch = Math.min(pc.height - cy, fh + pad * 2);
            const crop = document.createElement('canvas');
            crop.width = cw;
            crop.height = ch;
            crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);
            const txt = matchText(textItems, fx, fy, fw, fh, fy + fh + Math.round(pageH * 0.25));
            let ocrCrop: HTMLCanvasElement | null = null;
            if (!txt) {
              const tRegionY = fy + fh;
              const tRegionH = Math.min(fy + fh + Math.round(pageH * 0.25), pageH) - tRegionY;
              if (tRegionH > 10) {
                ocrCrop = document.createElement('canvas');
                const ocrX = Math.max(0, fx - 10);
                const ocrW = Math.min(pc.width - ocrX, fw + 20);
                ocrCrop.width = ocrW;
                ocrCrop.height = Math.round(tRegionH);
                ocrCrop.getContext('2d')!.drawImage(
                  pc,
                  ocrX,
                  Math.round(tRegionY),
                  ocrW,
                  Math.round(tRegionH),
                  0,
                  0,
                  ocrW,
                  Math.round(tRegionH)
                );
              }
            }
            usedLabels.add(labelText);
            let _rtX: number | undefined, _rtY: number | undefined, _rtW: number | undefined, _rtH: number | undefined;
            if (txt) {
              const maxTY = fy + fh + Math.round(pageH * 0.25);
              const belowItems = textItems.filter(item => !isLabel(item.text) && item.y >= fy + fh - 10 && item.y <= maxTY && item.x + item.w >= fx - 20 && item.x <= fx + fw + 20);
              const rightItems = textItems.filter(item => !isLabel(item.text) && item.x > fx + fw - 10 && item.y >= fy - 20 && item.y <= fy + fh + 20);
              const matched = rightItems.length > belowItems.length ? rightItems : belowItems;
              if (matched.length > 0) {
                _rtX = Math.min(...matched.map(it => it.x)); _rtY = Math.min(...matched.map(it => it.y));
                _rtW = Math.max(...matched.map(it => it.x + it.w)) - _rtX; _rtH = Math.max(...matched.map(it => it.y + it.h)) - _rtY;
                // Text area must never overlap the image area
                if (rightItems.length > belowItems.length) {
                  if (_rtX < fx + fw) { _rtW -= (fx + fw - _rtX); _rtX = fx + fw; }
                } else {
                  if (_rtY < fy + fh) { _rtH -= (fy + fh - _rtY); _rtY = fy + fh; }
                }
                if (_rtW <= 0 || _rtH <= 0) { _rtX = _rtY = _rtW = _rtH = undefined; }
              }
            } else if (ocrCrop) { _rtX = Math.max(0, fx - 10); _rtY = fy + fh; _rtW = Math.min(pc.width - _rtX, fw + 20); const _ocrAvail = Math.min(fy + fh + Math.round(pageH * 0.25), pageH) - _rtY; _rtH = Math.min(Math.round(fh * 0.35), 150, _ocrAvail); }
            recovered.push({
              src: crop.toDataURL('image/jpeg', 0.93),
              label: labelText,
              cropW: cw,
              cropH: ch,
              textContent: txt,
              ocrCrop,
              pageIdx: pi,
              sortX: tl.x,
              sortY: tl.y,
              pageW, pageH,
              imgX: fx, imgY: fy, imgW: fw, imgH: fh,
              labelX: tl.x, labelY: tl.y, labelW: tl.w, labelH: tl.h,
              textX: _rtX, textY: _rtY, textW: _rtW, textH: _rtH,
            });
          }
        }
        if (recovered.length > 0) {
          const rowBucket = Math.round(medFH * (allCandidates[0]?.pageH || 1) * 0.5) || 100;
          recovered.sort((a, b) => {
            if (a.pageIdx !== b.pageIdx) return (a.pageIdx ?? 0) - (b.pageIdx ?? 0);
            const ra = Math.floor((a.sortY ?? 0) / rowBucket),
              rb2 = Math.floor((b.sortY ?? 0) / rowBucket);
            return ra !== rb2 ? ra - rb2 : (a.sortX ?? 0) - (b.sortX ?? 0);
          });
          for (const rf of recovered) {
            const rfNum = parseInt((rf.label || '').match(/^(\d+)/)?.[1] || '');
            const { sortX, sortY, ...frameData } = rf;
            if (!isNaN(rfNum)) {
              let insertAt = allFrames.length;
              for (let fi = 0; fi < allFrames.length; fi++) {
                const existNum = parseInt((allFrames[fi].label || '').match(/^(\d+)/)?.[1] || '');
                if (!isNaN(existNum) && existNum > rfNum) {
                  insertAt = fi;
                  break;
                }
              }
              allFrames.splice(insertAt, 0, frameData);
            } else {
              allFrames.push(frameData);
            }
          }
          console.log(`[StripBoard] Label-anchor recovery: found ${recovered.length} frames filling sequence gaps`);
        }
      }
    }

    if (allFrames.length > 0 && allCandidates.length > 0) {
      const lastIdx = allCandidates.length - 1;
      const { page, candidates: lastCands, pageW, pageH } = allCandidates[lastIdx];
      const bottomCands = lastCands.filter((c: any) => {
        const midY = (c.y + c.h / 2) / pageH;
        return midY > 0.4 && c.w > c.h && c.w > pageW * 0.15 && c.rh < (dominantRH || 0.3) * 0.5;
      });
      if (bottomCands.length > 0) {
        const minX = Math.min(...bottomCands.map((c: any) => c.x));
        const maxX = Math.max(...bottomCands.map((c: any) => c.x + c.w));
        const minY = Math.min(...bottomCands.map((c: any) => c.y));
        const maxY = Math.max(...bottomCands.map((c: any) => c.y + c.h));
        const ecW = maxX - minX,
          ecH = maxY - minY;
        if (ecW > pageW * 0.3 && ecW > ecH) {
          const pc = await renderPage(page, 2);
          const textItems = pageTextItems[lastIdx] || (await getTextItems(page, 2));
          const pad = 3;
          const cx = Math.max(0, minX - pad),
            cy = Math.max(0, minY - pad);
          const cw = Math.min(pc.width - cx, ecW + pad * 2),
            ch = Math.min(pc.height - cy, ecH + pad * 2);
          const crop = document.createElement('canvas');
          crop.width = cw;
          crop.height = ch;
          crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);
          const txt = matchText(textItems, minX, minY, ecW, ecH, maxY + Math.round(pageH * 0.1));
          let _ecTX: number | undefined, _ecTY: number | undefined, _ecTW: number | undefined, _ecTH: number | undefined;
          if (txt) {
            const belowItems = textItems.filter(item => !isLabel(item.text) && item.y >= minY + ecH - 10 && item.y <= maxY + Math.round(pageH * 0.1) && item.x + item.w >= minX - 20 && item.x <= minX + ecW + 20);
            if (belowItems.length > 0) {
              _ecTX = Math.min(...belowItems.map(it => it.x)); _ecTY = Math.min(...belowItems.map(it => it.y));
              _ecTW = Math.max(...belowItems.map(it => it.x + it.w)) - _ecTX; _ecTH = Math.max(...belowItems.map(it => it.y + it.h)) - _ecTY;
              // Text area must never overlap the image area
              const imgBtm = minY + ecH;
              if (_ecTY < imgBtm) { _ecTH -= (imgBtm - _ecTY); _ecTY = imgBtm; }
              if (_ecTW <= 0 || _ecTH <= 0) { _ecTX = _ecTY = _ecTW = _ecTH = undefined; }
            }
          }
          allFrames.push({
            src: crop.toDataURL('image/jpeg', 0.93),
            label: '',
            cropW: cw,
            cropH: ch,
            textContent: txt || '',
            ocrCrop: null,
            pageIdx: lastIdx,
            pageW, pageH,
            imgX: minX, imgY: minY, imgW: ecW, imgH: ecH,
            textX: _ecTX, textY: _ecTY, textW: _ecTW, textH: _ecTH,
          });
          console.log(`[StripBoard] End-card detected on last page: ${cw}x${ch} at (${cx},${cy})`);
        }
      }
    }

    let forceFullPage = false;
    if (allFrames.length > 0 && pdf.numPages > 1) {
      if (dominantRW !== null && dominantRW > 0.8) forceFullPage = true;
    }
    if (!forceFullPage && pdf.numPages > 1 && allCandidates.length > 0) {
      const pg0 = allCandidates[0];
      const pageAR = pg0.pageW / pg0.pageH;
      const invertedCount = allCandidates.filter((pc: any) => pc.inverted).length;
      const invertedRatio = invertedCount / allCandidates.length;
      const maxRWs = allCandidates.map((pc: any) => {
        if (pc.candidates.length === 0) return 0;
        return Math.max(...pc.candidates.map((c: any) => c.rw));
      });
      const widePages = maxRWs.filter((rw: number) => rw > 0.7).length;
      const wideRatio = widePages / allCandidates.length;
      if (pageAR >= 1.5 && invertedRatio > 0.5 && wideRatio > 0.5) {
        forceFullPage = true;
        console.log(
          `[StripBoard] Full-page detected: page AR=${pageAR.toFixed(2)}, dark-bg=${invertedCount}/${allCandidates.length}, wide-cand pages=${widePages}/${allCandidates.length} → forcing full-page mode`
        );
      }
      // Wide cinematic pages with dark backgrounds whose frame-detection produces
      // no convergent dominant size (image content causes false column splits that
      // vary per page, preventing the dominant-size filter from converging).
      // Fall back to full-page mode — each page IS the frame.
      if (!forceFullPage && pageAR >= 1.5 && invertedRatio > 0.5 && dominantRW === null) {
        forceFullPage = true;
        console.log(
          `[StripBoard] Full-page detected: wide+inverted (AR=${pageAR.toFixed(2)}, dark-bg=${invertedCount}/${allCandidates.length}) with no convergent frame size → full-page mode`
        );
      }
    }
    const tooFewFrames = pdf.numPages > 1 && allFrames.length > 0 && allFrames.length < Math.ceil(pdf.numPages * 0.5);
    console.log(
      `[StripBoard] Extraction: ${allFrames.length} frames from ${pdf.numPages} pages (dominantRW=${dominantRW?.toFixed(3)}, force=${forceFullPage}, tooFew=${tooFewFrames})`
    );
    if (allFrames.length === 0 || tooFewFrames || forceFullPage) {
      allFrames.length = 0;
      setProgress(90, 'Full-page mode — extracting pages…');
      for (let i = 0; i < allCandidates.length; i++) {
        setProgress(90 + Math.round((i / allCandidates.length) * 8), `Extracting page ${i + 1}…`);
        const { page, pageW, pageH } = allCandidates[i];
        const pc = await renderPage(page, 2);
        const textItems = await getTextItems(page, 2);
        let label = '';
        let _fpLabelItem: { x: number; y: number; w: number; h: number } | null = null;
        for (const item of textItems) {
          if (isLabel(item.text) && item.x < pageW * 0.25 && item.y < pageH * 0.2) {
            label = item.text.trim();
            _fpLabelItem = { x: item.x, y: item.y, w: item.w, h: item.h };
            break;
          }
        }
        if (label) {
          const ANNOT = /^(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i;
          for (const item of textItems) {
            if (!ANNOT.test(item.text.trim())) continue;
            if (item.x < pageW * 0.25 && item.y < pageH * 0.25) {
              label = label + ' ' + item.text.trim();
              if (_fpLabelItem) _fpLabelItem.w = Math.max(_fpLabelItem.w, item.x + item.w - _fpLabelItem.x);
              break;
            }
          }
        }
        allFrames.push({
          src: pc.toDataURL('image/jpeg', 0.93),
          label: label,
          cropW: pc.width,
          cropH: pc.height,
          textContent: '',
          pageIdx: i,
          pageW, pageH,
          imgX: 0, imgY: 0, imgW: pageW, imgH: pageH,
          labelX: _fpLabelItem?.x, labelY: _fpLabelItem?.y, labelW: _fpLabelItem?.w, labelH: _fpLabelItem?.h,
        });
      }
    }

    const ocrFrames = allFrames.filter((f) => !f.textContent && f.ocrCrop);
    if (ocrFrames.length > 0) {
      setProgress(90, 'Running OCR on text regions…');
      try {
        const worker = await createWorker('eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
        } as any);
        for (let oi = 0; oi < ocrFrames.length; oi++) {
          setProgress(90 + Math.round((oi / ocrFrames.length) * 5), `OCR ${oi + 1}/${ocrFrames.length}…`);
          const f = ocrFrames[oi];
          const dataUrl = f.ocrCrop!.toDataURL('image/png');
          const result = await worker.recognize(dataUrl);
          const txt = (result.data.text || '').trim();
          if (txt.length > 2 && txt !== f.label) {
            f.textContent = txt;
          }
        }
        await worker.terminate();
      } catch (ocrErr) {
        console.warn('OCR fallback failed:', ocrErr);
      }
    }
    setProgress(95, 'Ready for review…');
    allFrames.forEach((f) => { delete f.ocrCrop; });
    setTimeout(() => document.getElementById('progressOverlay')!.classList.add('hidden'), 300);

    // Phone: skip Adjust, load frames directly into store
    const phoneMode = Math.min(window.innerWidth, window.innerHeight) <= 430;
    if (phoneMode) {
      resetStoryboardState();
      useStore.setState({ lastPdfName: file.name });
      const s = state();
      let nextId = s.nextId;
      for (const item of allFrames) {
        const id = nextId++;
        s.frames.push({
          id, src: item.src, label: item.label,
          cropW: item.cropW, cropH: item.cropH,
          strokes: [], drawMode: false,
          textContent: item.textContent || '', tableData: null,
        });
        s.versions[id] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
        s.activeTab[id] = 0;
        s.drawColor[id] = COLORS[0];
        s.drawWidth[id] = 6;
        s.drawEraser[id] = false;
      }
      for (let i = 0; i < s.frames.length; i++) {
        if (!s.frames[i].label) s.frames[i].label = '#' + (i + 1);
      }
      useStore.setState({ nextId });
      updateFrameBadge();
      showToast(`${allFrames.length} frames loaded`);
      requestAnimationFrame(() => { (window as any).__fh_renderAll?.(); });
      // Show the "use iPad or desktop" message after a short delay
      setTimeout(() => {
        import('./pdfAdjust').then(m => m.showPhoneAdjustMessage());
      }, 600);
    } else {
      // iPad/desktop: open the Adjust window with the extraction results
      const { openPdfAdjustWithResults } = await import('./pdfAdjust');
      openPdfAdjustWithResults(file, allFrames);
    }
  } catch (err) {
    console.error('[StripBoard] PDF extraction error:', err);
    document.getElementById('progressOverlay')!.classList.add('hidden');
    showToast('Error extracting PDF — check console (F12)');
  }
}

// ── Test-only export: runs the full extraction pipeline but returns frames
// without touching app state. Used by /app/test page. ──
export interface TestFrame {
  src: string;         // JPEG data URL of cropped frame
  label: string;       // detected label
  textContent: string; // text below/beside frame (PDF text or OCR)
  cropW: number;
  cropH: number;
  pageIdx: number;
  ocrCrop?: HTMLCanvasElement | null;
  // Position data (scale=2 page coords) for Adjust tool
  pageW?: number; pageH?: number;
  imgX?: number; imgY?: number; imgW?: number; imgH?: number;
  labelX?: number; labelY?: number; labelW?: number; labelH?: number;
  textX?: number; textY?: number; textW?: number; textH?: number;
}

export async function testExtractPDF(
  file: File,
  onProgress?: (msg: string) => void
): Promise<{ frames: TestFrame[]; pages: number; dominantRW: number | null; dominantRH: number | null; forceFullPage: boolean }> {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

  onProgress?.('Scanning pages…');
  const allCandidates: any[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`Scanning page ${p}/${pdf.numPages}`);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const pageW = Math.round(vp.width), pageH = Math.round(vp.height);
    const result = await extractCandidates(page);
    const candidates = result.candidates;
    candidates.forEach((c) => { c.rw = c.w / pageW; c.rh = c.h / pageH; });
    allCandidates.push({ page, candidates, pageNum: p, pageW, pageH, inverted: result.inverted });
  }

  // Dominant size
  const allSizes = allCandidates.flatMap((pc) => pc.candidates).map((c: any) => ({ rw: c.rw, rh: c.rh }));
  let dominantRW: number | null = null, dominantRH: number | null = null;
  if (allSizes.length > 0) {
    const rws = allSizes.map((s: any) => s.rw).sort((a: number, b: number) => a - b);
    const rhs = allSizes.map((s: any) => s.rh).sort((a: number, b: number) => a - b);
    const medRW = rws[Math.floor(rws.length / 2)];
    const medRH = rhs[Math.floor(rhs.length / 2)];
    const TOLERANCE = 0.3;
    const matching = allSizes.filter((s: any) =>
      Math.abs(s.rw - medRW) / medRW < TOLERANCE && Math.abs(s.rh - medRH) / medRH < TOLERANCE
    );
    if (matching.length / allSizes.length > 0.35) { dominantRW = medRW; dominantRH = medRH; }
  }

  const allFrames: TestFrame[] = [];
  const labelAnchors: any[] = [];
  const pageTextItems: TextItem[][] = [];

  for (let i = 0; i < allCandidates.length; i++) {
    onProgress?.(`Extracting page ${i + 1}/${allCandidates.length}`);
    const { page, candidates, pageW, pageH } = allCandidates[i];
    const textItems = await getTextItems(page, 2);
    pageTextItems.push(textItems);
    const pc = await renderPage(page, 2);

    const TOLERANCE = 0.3;
    let filtered = dominantRW
      ? candidates.filter((c: any) => {
          const rwOk = Math.abs(c.rw - dominantRW!) / dominantRW! < TOLERANCE;
          const rhOk = Math.abs(c.rh - dominantRH!) / dominantRH! < TOLERANCE;
          return rwOk && rhOk;
        })
      : candidates;

    if (dominantRW && dominantRH) {
      const domAR = dominantRW / dominantRH;
      filtered = filtered.filter((c: any) => {
        const ar = c.rw / c.rh;
        return Math.abs(ar - domAR) / domAR < 0.6;
      });
    }

    // Illustration-over-text swap
    if (dominantRW && filtered.length >= 2 && filtered.length < candidates.length) {
      const removed = candidates.filter((c: any) => !filtered.includes(c));
      if (removed.length === filtered.length && removed.every((c: any) => Math.abs(c.rw - dominantRW!) / dominantRW! < TOLERANCE)) {
        const remMaxBot = Math.max(...removed.map((c: any) => c.y + c.h));
        const filMinTop = Math.min(...filtered.map((c: any) => c.y));
        if (remMaxBot < filMinTop - pageH * 0.02) {
          const remXs = removed.map((c: any) => c.x).sort((a: number, b: number) => a - b);
          const filXs = filtered.map((c: any) => c.x).sort((a: number, b: number) => a - b);
          let aligned = true;
          for (let ai = 0; ai < remXs.length; ai++) {
            if (Math.abs(remXs[ai] - filXs[ai]) > pageW * 0.05) { aligned = false; break; }
          }
          if (aligned) filtered = removed;
        }
      }
    }

    // Bottom trim
    if (dominantRH) {
      const pxRef = pc.getContext('2d')!.getImageData(0, 0, pc.width, pc.height).data;
      for (let ci = 0; ci < filtered.length; ci++) {
        const c = filtered[ci];
        if (c.rh <= dominantRH * 1.15) continue;
        const BORDER_DARK = 120;
        for (let dy = c.h - 1; dy > c.h * 0.35; dy--) {
          let darkRun = 0, maxRun = 0;
          for (let dx = 0; dx < c.w; dx++) {
            const idx = ((c.y + dy) * pageW + (c.x + dx)) * 4;
            const g = (pxRef[idx] + pxRef[idx + 1] + pxRef[idx + 2]) / 3;
            if (g < BORDER_DARK) { darkRun++; if (darkRun > maxRun) maxRun = darkRun; } else darkRun = 0;
          }
          if (maxRun > c.w * 0.5) { c.h = dy + 3; c.rh = c.h / pageH; break; }
        }
      }
    }

    // Labels
    const withLabels: Candidate[] = filtered.map((c: any) => {
      const m = matchLabel(textItems, c.x, c.y, c.w, c.h, true) as { text: string; item: TextItem } | null;
      return { ...c, label: m ? m.text : '', labelItem: m ? m.item : null };
    });

    // Dedup labels
    const labelMap = new Map<string, Candidate[]>();
    for (const c of withLabels) {
      if (!c.label) continue;
      const arr = labelMap.get(c.label) || [];
      arr.push(c);
      labelMap.set(c.label, arr);
    }
    const allAreas = withLabels.map(c => c.w * c.h).sort((a, b) => a - b);
    const medArea = allAreas[Math.floor(allAreas.length / 2)] || 1;
    for (const [, cands] of labelMap) {
      if (cands.length <= 1) continue;
      cands.sort((a, b) => Math.abs(a.w * a.h - medArea) - Math.abs(b.w * b.h - medArea));
      for (let ci = 1; ci < cands.length; ci++) { cands[ci].label = ''; cands[ci].dedupedLabel = true; }
    }

    const labelled = withLabels.filter((c) => c.label);
    let finalCandidates = withLabels;
    if (labelled.length >= 2) {
      const lws = labelled.map((c) => c.w).sort((a, b) => a - b);
      const lhs = labelled.map((c) => c.h).sort((a, b) => a - b);
      const refW = lws[Math.floor(lws.length / 2)];
      const refH = lhs[Math.floor(lhs.length / 2)];
      const T = 0.35;
      const sizeOk = (c: Candidate) => Math.abs(c.w - refW) / refW < T && Math.abs(c.h - refH) / refH < T;
      finalCandidates = withLabels.filter((c) => c.label || (c.dedupedLabel && sizeOk(c)) || sizeOk(c));
    }

    // Label-order correction for vertical stacks
    {
      const sorted = [...finalCandidates].sort((a, b) => a.y - b.y);
      const xs = sorted.map(c => c.x);
      const xRange = Math.max(...xs) - Math.min(...xs);
      const isVertical = sorted.length >= 2 && xRange < (sorted[0].w || 100) * 0.5;
      if (isVertical) {
        const numberedLabels: { idx: number; label: string; num: number; suffix: string }[] = [];
        for (let ci = 0; ci < sorted.length; ci++) {
          const lbl = sorted[ci].label || '';
          const m = lbl.match(/^(\d+)(.*)$/);
          if (m) numberedLabels.push({ idx: ci, label: lbl, num: parseInt(m[1]), suffix: m[2] });
        }
        if (numberedLabels.length >= 2) {
          const labelsSorted = [...numberedLabels].sort((a, b) => a.num !== b.num ? a.num - b.num : a.suffix.localeCompare(b.suffix));
          const needsFix = numberedLabels.some((nl, ni) => nl.label !== labelsSorted[ni]?.label);
          if (needsFix) {
            for (let ci = 0; ci < numberedLabels.length; ci++) sorted[numberedLabels[ci].idx].label = labelsSorted[ci].label;
          }
        }
      }
      finalCandidates = sorted;
    }

    if (finalCandidates.length === 0) continue;

    const rowTops = [...new Set(finalCandidates.map((c) => c.y))].sort((a, b) => a - b);
    const rowClusters: number[] = [];
    for (const yt of rowTops) {
      if (rowClusters.length === 0 || yt - rowClusters[rowClusters.length - 1] > 40) rowClusters.push(yt);
    }

    for (const c of finalCandidates) {
      const pad = 3;
      const cx = Math.max(0, c.x - pad), cy = Math.max(0, c.y - pad);
      const cw = Math.min(pc.width - cx, c.w + pad * 2), ch = Math.min(pc.height - cy, c.h + pad * 2);
      const crop = document.createElement('canvas');
      crop.width = cw; crop.height = ch;
      crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);
      const nextRowY = rowClusters.find((ry) => ry > c.y + c.h * 0.5);
      const maxY = nextRowY !== undefined ? nextRowY : pageH;
      const extMaxY = Math.min(pageH, maxY + Math.round(c.h * 0.25));
      const txt = matchText(textItems, c.x, c.y, c.w, c.h, maxY);
      // Prepare OCR crop for frames with no text (same as handlePDF)
      let ocrCrop: HTMLCanvasElement | null = null;
      if (!txt) {
        const tRegionY = c.y + c.h;
        const tRegionH = Math.min(extMaxY, pageH) - tRegionY;
        if (tRegionH > 10) {
          ocrCrop = document.createElement('canvas');
          const ocrX = Math.max(0, c.x - 10);
          const ocrW = Math.min(pc.width - ocrX, c.w + 20);
          ocrCrop.width = ocrW;
          ocrCrop.height = Math.round(tRegionH);
          ocrCrop.getContext('2d')!.drawImage(pc, ocrX, Math.round(tRegionY), ocrW, Math.round(tRegionH), 0, 0, ocrW, Math.round(tRegionH));
        }
      }
      allFrames.push({
        src: crop.toDataURL('image/jpeg', 0.93),
        label: c.label || '',
        cropW: cw, cropH: ch,
        textContent: txt,
        pageIdx: i,
        ocrCrop,
      });
      if (c.label && c.labelItem) {
        const li = c.labelItem;
        labelAnchors.push({ lx: li.x, ly: li.y, lw: li.w, lh: li.h, fx: c.x, fy: c.y, fw: c.w, fh: c.h, pageW, pageH });
      }
    }

  }

  // Late label assignment
  {
    const usedLabelsSet = new Set<string>();
    for (const f of allFrames) {
      if (!f.label) continue;
      usedLabelsSet.add(f.label);
      const base = f.label.replace(/\s+(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i, '').trim();
      if (base) usedLabelsSet.add(base);
    }
    for (let pi = 0; pi < allCandidates.length; pi++) {
      const pageFrames = allFrames.filter(f => f.pageIdx === pi);
      const unlabeled = pageFrames.filter(f => !f.label);
      if (unlabeled.length === 0) continue;
      const textItems = pageTextItems[pi];
      const unusedLabels = textItems.filter(it => isLabel(it.text) && !usedLabelsSet.has(it.text.trim())).sort((a, b) => a.y - b.y);
      if (unusedLabels.length === 0) continue;
      unlabeled.sort((a, b) => { const ai = allFrames.indexOf(a), bi = allFrames.indexOf(b); return ai - bi; });
      let li = 0;
      for (const frame of unlabeled) {
        if (li >= unusedLabels.length) break;
        const lateLbl = unusedLabels[li];
        frame.label = lateLbl.text.trim();
        frame.labelX = lateLbl.x;
        frame.labelY = lateLbl.y;
        frame.labelW = lateLbl.w;
        frame.labelH = lateLbl.h;
        usedLabelsSet.add(frame.label);
        li++;
      }
    }
  }

  // Label-anchor recovery
  if (labelAnchors.length >= 2 && allFrames.some((f) => f.label)) {
    const dxs = labelAnchors.map((a: any) => (a.fx - a.lx) / a.pageW);
    const dys = labelAnchors.map((a: any) => (a.fy - a.ly) / a.pageH);
    const fws = labelAnchors.map((a: any) => a.fw / a.pageW);
    const fhs = labelAnchors.map((a: any) => a.fh / a.pageH);
    const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const medDX = median(dxs), medDY = median(dys), medFW = median(fws), medFH = median(fhs);

    const existingNums = allFrames.map((f) => parseInt((f.label || '').match(/^(\d+)/)?.[1] || '')).filter((n) => !isNaN(n));
    const expectedNums = new Set<number>();
    let minN = 0;
    if (existingNums.length >= 2) {
      const sorted = [...new Set(existingNums)].sort((a, b) => a - b);
      minN = sorted[0];
      const maxN = sorted[sorted.length - 1];
      const steps: number[] = [];
      for (let si = 1; si < sorted.length; si++) steps.push(sorted[si] - sorted[si - 1]);
      const stepCounts: Record<number, number> = {};
      for (const st of steps) stepCounts[st] = (stepCounts[st] || 0) + 1;
      const stepEntries = Object.entries(stepCounts).sort((a, b) => b[1] - a[1]);
      const typicalStep = stepEntries.length > 0 ? parseInt(stepEntries[0][0]) || 1 : 1;
      for (let n = minN; n <= maxN + typicalStep; n++) { if (!existingNums.includes(n)) expectedNums.add(n); }
    }

    const zeroFramePages = new Set<number>();
    for (let pi = 0; pi < allCandidates.length; pi++) {
      if (!allFrames.some((f) => f.pageIdx === pi)) zeroFramePages.add(pi);
    }

    if (expectedNums.size > 0 || zeroFramePages.size > 0) {
      const usedLabels = new Set<string>();
      for (const f of allFrames) {
        if (!f.label) continue;
        usedLabels.add(f.label);
        const base = f.label.replace(/\s+(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i, '').trim();
        if (base) usedLabels.add(base);
      }
      const recovered: (TestFrame & { sortX?: number; sortY?: number })[] = [];
      for (let pi = 0; pi < allCandidates.length; pi++) {
        const { page, pageW, pageH } = allCandidates[pi];
        const textItems = pageTextItems[pi];
        const isZeroPage = zeroFramePages.has(pi);
        const pageLabels = textItems.filter((it) => {
          if (!isLabel(it.text)) return false;
          const t = it.text.trim();
          if (usedLabels.has(t)) return false;
          if (isZeroPage) return true;
          if (/^\d{1,3}[a-zA-Z]\.?$/.test(t)) return true;
          const num = parseInt((t.match(/^(\d+)/) || [])[1]);
          if (isNaN(num)) return false;
          return expectedNums.has(num) || num < minN;
        });
        if (pageLabels.length === 0) continue;
        const pc = await renderPage(page, 2);
        for (const tl of pageLabels) {
          const labelText = tl.text.trim();
          if (usedLabels.has(labelText)) continue;
          const fx = Math.max(0, Math.round(tl.x + medDX * pageW));
          const fy = Math.max(0, Math.round(tl.y + medDY * pageH));
          const estFW = Math.round(medFW * pageW), estFH = Math.round(medFH * pageH);
          const fw = Math.min(estFW, pc.width - fx), fh = Math.min(estFH, pc.height - fy);
          if (fw < 30 || fh < 30 || fw < estFW * 0.5 || fh < estFH * 0.5 || fw < fh * 0.7) continue;
          {
            const imgData = pc.getContext('2d')!.getImageData(fx, fy, fw, fh);
            const d = imgData.data;
            const recStep = 4;
            let recDark = 0, recN = 0, recSG = 0, recSG2 = 0;
            for (let si = 0; si < fw * fh; si += recStep) {
              const ri = si * 4;
              const g = (d[ri] + d[ri + 1] + d[ri + 2]) / 3;
              if (g < 200) recDark++;
              recSG += g; recSG2 += g * g; recN++;
            }
            const recMean = recSG / recN, recVar = recSG2 / recN - recMean * recMean;
            if (recDark / recN < 0.02 || recVar < 800) continue;
          }
          const pad = 3;
          const cx = Math.max(0, fx - pad), cy = Math.max(0, fy - pad);
          const cw = Math.min(pc.width - cx, fw + pad * 2), ch = Math.min(pc.height - cy, fh + pad * 2);
          const crop = document.createElement('canvas');
          crop.width = cw; crop.height = ch;
          crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);
          const txt = matchText(textItems, fx, fy, fw, fh, fy + fh + Math.round(pageH * 0.25));
          usedLabels.add(labelText);
          recovered.push({ src: crop.toDataURL('image/jpeg', 0.93), label: labelText, cropW: cw, cropH: ch, textContent: txt, pageIdx: pi, sortX: tl.x, sortY: tl.y });
        }
      }
      if (recovered.length > 0) {
        const rowBucket = Math.round(medFH * (allCandidates[0]?.pageH || 1) * 0.5) || 100;
        recovered.sort((a, b) => {
          if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
          const ra = Math.floor((a.sortY ?? 0) / rowBucket), rb2 = Math.floor((b.sortY ?? 0) / rowBucket);
          return ra !== rb2 ? ra - rb2 : (a.sortX ?? 0) - (b.sortX ?? 0);
        });
        for (const rf of recovered) {
          const rfNum = parseInt((rf.label || '').match(/^(\d+)/)?.[1] || '');
          const { sortX, sortY, ...frameData } = rf;
          if (!isNaN(rfNum)) {
            let insertAt = allFrames.length;
            for (let fi = 0; fi < allFrames.length; fi++) {
              const existNum = parseInt((allFrames[fi].label || '').match(/^(\d+)/)?.[1] || '');
              if (!isNaN(existNum) && existNum > rfNum) { insertAt = fi; break; }
            }
            allFrames.splice(insertAt, 0, frameData);
          } else {
            allFrames.push(frameData);
          }
        }
      }
    }
  }

  // Full-page mode detection
  let forceFullPage = false;
  if (allFrames.length > 0 && pdf.numPages > 1) {
    if (dominantRW !== null && dominantRW > 0.8) forceFullPage = true;
  }
  if (!forceFullPage && pdf.numPages > 1 && allCandidates.length > 0) {
    const pg0 = allCandidates[0];
    const pageAR = pg0.pageW / pg0.pageH;
    const invertedCount = allCandidates.filter((pc: any) => pc.inverted).length;
    const invertedRatio = invertedCount / allCandidates.length;
    const maxRWs = allCandidates.map((pc: any) => {
      if (pc.candidates.length === 0) return 0;
      return Math.max(...pc.candidates.map((c: any) => c.rw));
    });
    const widePages = maxRWs.filter((rw: number) => rw > 0.7).length;
    const wideRatio = widePages / allCandidates.length;
    if (pageAR >= 1.5 && invertedRatio > 0.5 && wideRatio > 0.5) forceFullPage = true;
    if (!forceFullPage && pageAR >= 1.5 && invertedRatio > 0.5 && dominantRW === null) forceFullPage = true;
  }
  const tooFewFrames = pdf.numPages > 1 && allFrames.length > 0 && allFrames.length < Math.ceil(pdf.numPages * 0.5);

  if (allFrames.length === 0 || tooFewFrames || forceFullPage) {
    allFrames.length = 0;
    for (let i = 0; i < allCandidates.length; i++) {
      onProgress?.(`Full-page mode: page ${i + 1}/${allCandidates.length}`);
      const { page, pageW, pageH } = allCandidates[i];
      const pc = await renderPage(page, 2);
      const textItems = await getTextItems(page, 2);
      let label = '';
      for (const item of textItems) {
        if (isLabel(item.text) && item.x < pageW * 0.25 && item.y < pageH * 0.2) { label = item.text.trim(); break; }
      }
      allFrames.push({ src: pc.toDataURL('image/jpeg', 0.93), label, cropW: pc.width, cropH: pc.height, textContent: '', pageIdx: i });
    }
  }

  // Number unlabeled frames
  for (let i = 0; i < allFrames.length; i++) {
    if (!allFrames[i].label) allFrames[i].label = '#' + (i + 1);
  }

  // OCR fallback for frames with no text content (same as handlePDF)
  const ocrFrames = allFrames.filter((f) => !f.textContent && f.ocrCrop);
  if (ocrFrames.length > 0) {
    onProgress?.(`Running OCR on ${ocrFrames.length} text regions…`);
    try {
      const worker = await createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
      } as any);
      for (let oi = 0; oi < ocrFrames.length; oi++) {
        onProgress?.(`OCR ${oi + 1}/${ocrFrames.length}…`);
        const f = ocrFrames[oi];
        const dataUrl = f.ocrCrop!.toDataURL('image/png');
        const result = await worker.recognize(dataUrl);
        const txt = (result.data.text || '').trim();
        if (txt.length > 2 && txt !== f.label) {
          f.textContent = txt;
        }
      }
      await worker.terminate();
    } catch (ocrErr) {
      console.warn('OCR fallback failed:', ocrErr);
    }
  }
  // Clean up OCR canvases
  allFrames.forEach((f) => { delete f.ocrCrop; });

  return { frames: allFrames, pages: pdf.numPages, dominantRW, dominantRH, forceFullPage };
}
