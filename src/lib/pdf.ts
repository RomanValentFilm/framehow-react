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

interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ExtractedFrame {
  src: string;
  label: string;
  cropW: number;
  cropH: number;
  textContent: string;
  ocrCrop?: HTMLCanvasElement | null;
  pageIdx?: number;
  sortX?: number;
  sortY?: number;
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
  const rowProf = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) if (gray[y * W + x] < DARK) s++;
    rowProf[y] = s / W;
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
  if (useInverted) {
    const LIGHT = 100;
    const rowProfLight = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = 0; x < W; x++) if (gray[y * W + x] > LIGHT) s++;
      rowProfLight[y] = s / W;
    }
    activeRowBands = findBands(rowProfLight, H, 0.05, 0.02, Math.round(H * 0.04));
  }

  const mergedRowBands: { a: number; b: number }[] = [];
  const MIN_GAP = Math.round(H * 0.02);
  for (const rb of activeRowBands) {
    if (mergedRowBands.length > 0 && rb.a - mergedRowBands[mergedRowBands.length - 1].b < MIN_GAP) {
      mergedRowBands[mergedRowBands.length - 1].b = rb.b;
    } else {
      mergedRowBands.push({ ...rb });
    }
  }

  const splitBands: { a: number; b: number }[] = [];
  for (const rb of mergedRowBands) {
    const bandH = rb.b - rb.a;
    if (bandH > H * 0.45) {
      const searchA = rb.a + Math.round(bandH * 0.15);
      const searchB = rb.a + Math.round(bandH * 0.85);
      const gapThresh = 0.025;
      let bestGapStart = -1,
        bestGapEnd = -1,
        bestGapLen = 0;
      let gapStart = -1;
      for (let y = searchA; y < searchB; y++) {
        const val = useInverted ? 1 - rowProf[y] : rowProf[y];
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
      if (bestGapLen >= Math.round(H * 0.01)) {
        const splitRow = Math.round((bestGapStart + bestGapEnd) / 2);
        splitBands.push({ a: rb.a, b: splitRow });
        splitBands.push({ a: splitRow, b: rb.b });
      } else {
        const WIN = Math.max(3, Math.round(bandH * 0.02));
        let minVal = Infinity,
          minRow = Math.round((searchA + searchB) / 2);
        for (let y = searchA; y < searchB; y++) {
          let avg = 0;
          for (let dy = -WIN; dy <= WIN; dy++) {
            const yy = Math.max(0, Math.min(H - 1, y + dy));
            avg += useInverted ? 1 - rowProf[yy] : rowProf[yy];
          }
          avg /= WIN * 2 + 1;
          if (avg < minVal) {
            minVal = avg;
            minRow = y;
          }
        }
        const bandAvg = useInverted
          ? 1 - rowProf.slice(rb.a, rb.b).reduce((a, b) => a + b, 0) / bandH
          : rowProf.slice(rb.a, rb.b).reduce((a, b) => a + b, 0) / bandH;
        if (minVal < bandAvg * 0.6) {
          splitBands.push({ a: rb.a, b: minRow });
          splitBands.push({ a: minRow, b: rb.b });
        } else {
          splitBands.push(rb);
        }
      }
    } else {
      splitBands.push(rb);
    }
  }
  const finalRowBands = splitBands;

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
          for (let y = rb.a; y < rb.b; y++) if (gray[y * W + x] < DARK) s++;
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
      if (sumGsq / total - mean * mean < 800) continue; // solid color region (title card, colored box)
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

async function getTextItems(page: any, scale: number): Promise<TextItem[]> {
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

function matchLabel(
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
    const condBottomLeft = x - 150 <= lx0 && lx0 <= x + w * 0.25 && y + h * 0.6 <= ly0 && ly0 <= y + h + 15;
    const condBelow = ly0 >= y + h - 20 && ly0 <= y + h + 40 && lx0 >= x - 80 && lx0 <= x + w * 0.5;
    if (condLeft || condAbove || condTopLeft || condBottomLeft || condBelow) {
      let score: number;
      if (condTopLeft || condAbove) {
        score = Math.abs(lx0 - x) + Math.abs(ly0 - y);
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

function matchText(
  items: TextItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  maxY?: number
): string {
  const limit = maxY || y + h + 300;
  const belowItems: TextItem[] = [];
  for (const item of items) {
    if (isLabel(item.text)) continue;
    const iy = item.y,
      ix = item.x;
    if (iy < y + h - 10 || iy > limit) continue;
    if (ix + item.w < x - 20 || ix > x + w + 20) continue;
    belowItems.push(item);
  }
  belowItems.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: TextItem[][] = [];
  for (const item of belowItems) {
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
            (c: any) =>
              Math.abs(c.rw - dominantRW!) / dominantRW! < TOLERANCE &&
              Math.abs(c.rh - dominantRH!) / dominantRH! < TOLERANCE
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
      const usedLabels = new Set<string>();
      for (const c of withLabels) {
        if (c.label) {
          if (usedLabels.has(c.label)) {
            c.label = '';
            c.dedupedLabel = true;
          } else usedLabels.add(c.label);
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
        finalCandidates = withLabels.filter(
          (c) => c.label || c.dedupedLabel || (Math.abs(c.w - refW) / refW < T && Math.abs(c.h - refH) / refH < T)
        );
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
        const txt = matchText(textItems, c.x, c.y, c.w, c.h, maxY);
        let ocrCrop: HTMLCanvasElement | null = null;
        if (!txt) {
          const tRegionY = c.y + c.h;
          const tRegionH = Math.min(maxY, pageH) - tRegionY;
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
        allFrames.push({
          src: crop.toDataURL('image/jpeg', 0.93),
          label: c.label || '',
          cropW: cw,
          cropH: ch,
          textContent: txt,
          ocrCrop,
          pageIdx: i,
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
      if (existingNums.length >= 2) {
        const sorted = [...new Set(existingNums)].sort((a, b) => a - b);
        const minN = sorted[0],
          maxN = sorted[sorted.length - 1];
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
        const usedLabels = new Set(allFrames.filter((f) => f.label).map((f) => f.label));
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
            const num = parseInt((t.match(/^(\d+)/) || [])[1]);
            return !isNaN(num) && expectedNums.has(num);
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
          allFrames.push({
            src: crop.toDataURL('image/jpeg', 0.93),
            label: '',
            cropW: cw,
            cropH: ch,
            textContent: txt || '',
            ocrCrop: null,
            pageIdx: lastIdx,
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
        for (const item of textItems) {
          if (isLabel(item.text) && item.x < pageW * 0.25 && item.y < pageH * 0.2) {
            label = item.text.trim();
            break;
          }
        }
        if (label) {
          const ANNOT = /^(optional|option|opt\.?|alt\.?|alternative|\/optional\/|\/alt\/)$/i;
          for (const item of textItems) {
            if (!ANNOT.test(item.text.trim())) continue;
            if (item.x < pageW * 0.25 && item.y < pageH * 0.25) {
              label = label + ' ' + item.text.trim();
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
    allFrames.forEach((f) => {
      delete f.ocrCrop;
    });

    setProgress(95, 'Building strips…');
    const s = state();
    const frameStartIdx = s.frames.length;
    let nextId = s.nextId;
    allFrames.forEach((item) => {
      const id = nextId++;
      s.frames.push({
        id,
        src: item.src,
        label: item.label,
        cropW: item.cropW,
        cropH: item.cropH,
        strokes: [],
        drawMode: false,
        textContent: item.textContent || '',
        tableData: null,
      });
      s.versions[id] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
      s.activeTab[id] = 0;
      s.drawColor[id] = COLORS[0];
      s.drawWidth[id] = 6;
      s.drawEraser[id] = false;
    });
    for (let i = frameStartIdx; i < s.frames.length; i++) {
      if (!s.frames[i].label) s.frames[i].label = '#' + (i - frameStartIdx + 1);
    }
    useStore.setState({ nextId });
    setProgress(100, 'Done!');
    setTimeout(() => document.getElementById('progressOverlay')!.classList.add('hidden'), 300);
    document.getElementById('frameBadge')!.textContent = `${s.frames.length} frame${s.frames.length !== 1 ? 's' : ''}`;
    showToast(`${s.frames.length} frame${s.frames.length !== 1 ? 's' : ''} extracted`);
  } catch (err) {
    console.error('[StripBoard] PDF extraction error:', err);
    document.getElementById('progressOverlay')!.classList.add('hidden');
    showToast('Error extracting PDF — check console (F12)');
  }
}
