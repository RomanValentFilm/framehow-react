// Folder-image loader and "start from scratch" — port of original handlers.

import { COLORS, state, useStore, resetStoryboardState } from '../store/state';
import { setProgress, showToast } from './modals';
import { fhTrack } from './tracking';
import { renderAll } from './render';
import { autoPhoneMainView } from './view';
import { updateFrameBadge } from './helpers';

export function handleFolderImages(e: Event): void {
  fhTrack('images_loaded');
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    showToast('No images selected');
    input.value = '';
    return;
  }
  resetStoryboardState();

  const baseNames = files.map((f) => f.name.replace(/\.[^.]+$/, ''));
  const wordSets = baseNames.map(
    (n) =>
      new Set(
        n
          .replace(/[_\-]/g, ' ')
          .split(/\s+/)
          .map((w) => w.toLowerCase())
          .filter((w) => !/\d/.test(w) && w.length > 1)
      )
  );
  let commonWords = new Set<string>();
  if (wordSets.length > 1) {
    commonWords = new Set([...wordSets[0]].filter((w) => wordSets.every((ws) => ws.has(w))));
  }

  const labels = baseNames.map((n) => {
    const parts = n.replace(/[_\-]/g, ' ').split(/\s+/);
    const kept = parts.filter((p) => !commonWords.has(p.toLowerCase()));
    const label = kept.join(' ').trim();
    return label || n;
  });

  const withNum = files.map((f, i) => {
    const m = f.name.match(/(\d+)/);
    return { file: f, num: m ? parseInt(m[1], 10) : Infinity, name: f.name, label: labels[i] };
  });
  withNum.sort((a, b) => (a.num !== b.num ? a.num - b.num : a.name.localeCompare(b.name)));

  let loaded = 0;
  const total = withNum.length;
  document.getElementById('progressOverlay')!.classList.remove('hidden');
  setProgress(5, 'Loading images…');

  const firstReader = new FileReader();
  firstReader.onload = (fe) => {
    const probe = new Image();
    probe.onload = () => {
      const arW = probe.naturalWidth,
        arH = probe.naturalHeight;
      withNum.forEach((item) => {
        const reader = new FileReader();
        reader.onload = (re) => {
          const img = new Image();
          img.onload = () => {
            const s = state();
            const id = s.nextId;
            useStore.setState({ nextId: id + 1 });
            s.frames.push({
              id,
              src: img.src,
              label: item.label,
              cropW: arW,
              cropH: arH,
              strokes: [],
              drawMode: false,
              textContent: '',
              tableData: null,
            });
            s.versions[id] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
            s.activeTab[id] = 0;
            s.drawColor[id] = COLORS[0];
            s.drawWidth[id] = 6;
            s.drawEraser[id] = false;
            loaded++;
            setProgress(5 + Math.round((loaded / total) * 90), 'Loading ' + loaded + '/' + total + '…');
            if (loaded === total) {
              s.frames.sort((a, b) => {
                const na = parseInt(a.label.match(/\d+/)?.[0] || '', 10) || 0;
                const nb = parseInt(b.label.match(/\d+/)?.[0] || '', 10) || 0;
                return na !== nb ? na - nb : a.label.localeCompare(b.label);
              });
              setProgress(100, 'Done!');
              setTimeout(() => document.getElementById('progressOverlay')!.classList.add('hidden'), 300);
              renderAll();
              autoPhoneMainView();
              // toast removed
            }
          };
          img.src = (re.target as FileReader).result as string;
        };
        reader.readAsDataURL(item.file);
      });
    };
    probe.src = (fe.target as FileReader).result as string;
  };
  firstReader.readAsDataURL(withNum[0].file);
  input.value = '';
}

export function startFromScratch(): void {
  fhTrack('start_scratch');
  resetStoryboardState();
  useStore.setState({ portraitMode: false });
  const s = state();
  const id = s.nextId;
  useStore.setState({ nextId: id + 1 });
  s.frames.push({
    id,
    src: '',
    label: '1',
    cropW: 900,
    cropH: 506,
    strokes: [],
    drawMode: false,
    textContent: '',
    tableData: null,
  });
  s.versions[id] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
  s.activeTab[id] = 0;
  s.drawColor[id] = COLORS[0];
  s.drawWidth[id] = 6;
  s.drawEraser[id] = false;
  updateFrameBadge();
}

export function startPortrait(): void {
  fhTrack('start_portrait');
  resetStoryboardState();
  useStore.setState({ portraitMode: true });
  const s = state();
  const id = s.nextId;
  useStore.setState({ nextId: id + 1 });
  s.frames.push({
    id,
    src: '',
    label: 'name',
    cropW: 540,
    cropH: 960,
    strokes: [],
    drawMode: false,
    textContent: '',
    tableData: null,
  });
  s.versions[id] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
  s.activeTab[id] = 0;
  s.drawColor[id] = COLORS[0];
  s.drawWidth[id] = 6;
  s.drawEraser[id] = false;
  updateFrameBadge();
}
