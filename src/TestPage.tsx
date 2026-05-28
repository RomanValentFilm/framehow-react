import { useState, useRef, useCallback, useEffect } from 'react';
import { testExtractPDF, type TestFrame } from './lib/pdf';

// Baseline stored in IndexedDB (large — frame images)
const DB_NAME = 'fh_pdf_test';
const DB_VERSION = 2;
const STORE_NAME = 'baselines';
const FLAGS_STORE = 'flags';

interface Baseline {
  name: string;
  frameCount: number;
  labels: string[];
  thumbnails: string[]; // small data URLs for comparison
  textContents: string[];
  cropWidths: number[];
  cropHeights: number[];
}

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'new' | 'running' | 'error';
  frames: TestFrame[];
  pages: number;
  baseline: Baseline | null;
  diffs: string[]; // human-readable diff descriptions
  progress: string;
  error?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(FLAGS_STORE)) {
        db.createObjectStore(FLAGS_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFlags(): Promise<Set<string>> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(FLAGS_STORE, 'readonly');
    const req = tx.objectStore(FLAGS_STORE).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result as string[]));
    req.onerror = () => resolve(new Set());
  });
}

async function setFlag(name: string, flagged: boolean): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FLAGS_STORE, 'readwrite');
    if (flagged) {
      tx.objectStore(FLAGS_STORE).put({ name });
    } else {
      tx.objectStore(FLAGS_STORE).delete(name);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadBaseline(name: string): Promise<Baseline | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function saveBaseline(baseline: Baseline): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(baseline);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteBaseline(name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllBaselineNames(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => resolve([]);
  });
}

// Shrink a frame image to a small thumbnail for comparison
function makeThumbnail(src: string, maxW = 120, maxH = 80): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.src = src;
  });
}

function compareResults(frames: TestFrame[], baseline: Baseline): string[] {
  const diffs: string[] = [];
  if (frames.length !== baseline.frameCount) {
    diffs.push(`Frame count: ${frames.length} (was ${baseline.frameCount})`);
  }
  const maxLen = Math.max(frames.length, baseline.labels.length);
  for (let i = 0; i < maxLen; i++) {
    const newLabel = frames[i]?.label || '';
    const oldLabel = baseline.labels[i] || '';
    if (newLabel !== oldLabel) {
      diffs.push(`Frame ${i + 1} label: "${newLabel}" (was "${oldLabel}")`);
    }
    const newText = frames[i]?.textContent || '';
    const oldText = baseline.textContents[i] || '';
    if (newText !== oldText) {
      diffs.push(`Frame ${i + 1} text changed`);
    }
    // Dimension check (tolerance of 5px)
    if (baseline.cropWidths && baseline.cropHeights) {
      const newW = frames[i]?.cropW || 0;
      const newH = frames[i]?.cropH || 0;
      const oldW = baseline.cropWidths[i] || 0;
      const oldH = baseline.cropHeights[i] || 0;
      if (Math.abs(newW - oldW) > 5 || Math.abs(newH - oldH) > 5) {
        diffs.push(`Frame ${i + 1} size: ${newW}×${newH} (was ${oldW}×${oldH})`);
      }
    }
  }
  return diffs;
}

export default function TestPage() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [summary, setSummary] = useState('');
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  // Load flags on mount
  useEffect(() => { loadFlags().then(setFlagged); }, []);
  const filesRef = useRef<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    files.sort((a, b) => a.name.localeCompare(b.name));
    filesRef.current = files;
    setResults(files.map(f => ({
      name: f.name, status: 'new' as const, frames: [], pages: 0,
      baseline: null, diffs: [], progress: 'Ready',
    })));
    setSummary(`${files.length} PDFs loaded. Click "Run All Tests".`);
  }, []);

  const runSingleTest = useCallback(async (i: number) => {
    const file = filesRef.current[i];
    if (!file) return;
    setRunning(true);
    setResults(prev => {
      const copy = [...prev];
      copy[i] = { ...copy[i], status: 'running', progress: 'Starting…' };
      return copy;
    });

    try {
      const baseline = await loadBaseline(file.name);
      const result = await testExtractPDF(file, (msg) => {
        setResults(prev => {
          const copy = [...prev];
          copy[i] = { ...copy[i], progress: msg };
          return copy;
        });
      });

      let status: 'pass' | 'fail' | 'new' = 'new' as const;
      let diffs: string[] = [];
      if (baseline) {
        diffs = compareResults(result.frames, baseline);
        status = diffs.length === 0 ? 'pass' : 'fail';
      }

      const r: TestResult = {
        name: file.name, status, frames: result.frames, pages: result.pages,
        baseline, diffs, progress: 'Done',
      };
      setResults(prev => { const copy = [...prev]; copy[i] = r; return copy; });
      setExpandedIdx(i);
    } catch (err: any) {
      const r: TestResult = {
        name: file.name, status: 'error', frames: [], pages: 0,
        baseline: null, diffs: [], progress: 'Error', error: err.message,
      };
      setResults(prev => { const copy = [...prev]; copy[i] = r; return copy; });
    }
    setRunning(false);
  }, []);

  const runTests = useCallback(async () => {
    setRunning(true);
    for (let i = 0; i < filesRef.current.length; i++) {
      const file = filesRef.current[i];
      setResults(prev => {
        const copy = [...prev];
        copy[i] = { ...copy[i], status: 'running', progress: 'Starting…' };
        return copy;
      });

      try {
        const baseline = await loadBaseline(file.name);
        const result = await testExtractPDF(file, (msg) => {
          setResults(prev => {
            const copy = [...prev];
            copy[i] = { ...copy[i], progress: msg };
            return copy;
          });
        });

        let status: 'pass' | 'fail' | 'new' = 'new' as const;
        let diffs: string[] = [];
        if (baseline) {
          diffs = compareResults(result.frames, baseline);
          status = diffs.length === 0 ? 'pass' : 'fail';
        }

        setResults(prev => {
          const copy = [...prev];
          copy[i] = { name: file.name, status, frames: result.frames, pages: result.pages, baseline, diffs, progress: 'Done' };
          return copy;
        });
      } catch (err: any) {
        setResults(prev => {
          const copy = [...prev];
          copy[i] = { name: file.name, status: 'error', frames: [], pages: 0, baseline: null, diffs: [], progress: 'Error', error: (err as any).message };
          return copy;
        });
      }
    }

    setResults(prev => {
      const passed = prev.filter(r => r.status === 'pass').length;
      const failed = prev.filter(r => r.status === 'fail').length;
      const newOnes = prev.filter(r => r.status === 'new').length;
      const errors = prev.filter(r => r.status === 'error').length;
      if (failed === 0 && errors === 0) {
        setSummary(`✓ All ${passed} tests passed${newOnes ? `, ${newOnes} new (save baselines)` : ''}.`);
      } else {
        setSummary(`${failed} FAILED, ${errors} errors, ${passed} passed, ${newOnes} new.`);
      }
      return prev;
    });
    setRunning(false);
  }, []);

  const saveBaselineFor = useCallback(async (idx: number) => {
    const r = results[idx];
    if (!r || r.frames.length === 0) return;
    const thumbnails = await Promise.all(r.frames.map(f => makeThumbnail(f.src)));
    const baseline: Baseline = {
      name: r.name,
      frameCount: r.frames.length,
      labels: r.frames.map(f => f.label),
      thumbnails,
      textContents: r.frames.map(f => f.textContent),
      cropWidths: r.frames.map(f => f.cropW),
      cropHeights: r.frames.map(f => f.cropH),
    };
    await saveBaseline(baseline);
    setResults(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], status: 'pass', baseline, diffs: [] };
      return copy;
    });
  }, [results]);

  const saveAllBaselines = useCallback(async () => {
    for (let i = 0; i < results.length; i++) {
      if (results[i].frames.length > 0) await saveBaselineFor(i);
    }
    setSummary(`All ${results.length} baselines saved.`);
  }, [results, saveBaselineFor]);

  const clearAllBaselines = useCallback(async () => {
    if (!confirm('Delete all saved baselines?')) return;
    const names = await getAllBaselineNames();
    for (const n of names) await deleteBaseline(n);
    setResults(prev => prev.map(r => ({ ...r, status: 'new' as const, baseline: null, diffs: [] })));
    setSummary('All baselines cleared.');
  }, []);

  const statusColor = (s: string) => {
    switch (s) {
      case 'pass': return '#22c55e';
      case 'fail': return '#ef4444';
      case 'new': return '#3b82f6';
      case 'running': return '#eab308';
      case 'error': return '#ef4444';
      default: return '#888';
    }
  };

  return (
    <div style={{ background: '#111', color: '#e0e0e0', minHeight: '100vh', padding: 20, fontFamily: '-apple-system, sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4, color: '#fff' }}>PDF Test Harness</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Select a folder of test PDFs. Extraction results are compared against saved baselines.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{
          padding: '8px 16px', background: '#333', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
        }}>
          Select Folder
          <input
            ref={fileInputRef}
            type="file"
            // @ts-ignore — webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            multiple
            style={{ display: 'none' }}
            onChange={handleFolderSelect}
          />
        </label>
        <button onClick={runTests} disabled={running || filesRef.current.length === 0} style={{
          padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
          cursor: running ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, opacity: running ? 0.5 : 1,
        }}>
          {running ? 'Running…' : 'Run All Tests'}
        </button>
        <button onClick={saveAllBaselines} disabled={running || results.length === 0} style={{
          padding: '8px 16px', background: '#22c55e', color: '#111', border: 'none', borderRadius: 6,
          cursor: 'pointer', fontSize: 13, fontWeight: 500,
        }}>
          Save All as Baseline
        </button>
        <button onClick={clearAllBaselines} style={{
          padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6,
          cursor: 'pointer', fontSize: 13, fontWeight: 500,
        }}>
          Clear All Baselines
        </button>
      </div>

      {summary && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14, fontWeight: 500,
          background: summary.includes('FAIL') || summary.includes('error') ? '#3b1111' : '#113b1e',
          color: summary.includes('FAIL') || summary.includes('error') ? '#ef4444' : '#22c55e',
        }}>
          {summary}
        </div>
      )}

      {results.map((r, idx) => (
        <div key={r.name} style={{
          background: '#1a1a2e', borderRadius: 8, marginBottom: 8, overflow: 'hidden',
          border: `1px solid ${r.status === 'fail' ? '#ef4444' : r.status === 'pass' ? '#22c55e33' : '#333'}`,
        }}>
          {/* Header row */}
          <div
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer',
              background: r.status === 'fail' ? 'rgba(239,68,68,0.08)' : 'transparent',
            }}
          >
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 11,
              fontWeight: 600, textTransform: 'uppercase',
              background: statusColor(r.status) + '22', color: statusColor(r.status),
            }}>
              {r.status === 'running' ? r.progress : r.status}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); runSingleTest(idx); }}
              disabled={running}
              style={{
                padding: '3px 10px', background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 4, fontSize: 11, cursor: running ? 'not-allowed' : 'pointer',
                opacity: running ? 0.4 : 1, flexShrink: 0,
              }}
            >
              Run
            </button>
            {flagged.has(r.name) && (
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
                fontWeight: 600, background: '#f59e0b22', color: '#f59e0b',
              }}>⚠ FIX</span>
            )}
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{r.name}</span>
            <span style={{ fontSize: 12, color: '#888' }}>
              {r.frames.length > 0 ? `${r.frames.length} frames · ${r.pages} pages` : ''}
            </span>
            {r.baseline && (
              <span style={{ fontSize: 11, color: '#666' }}>baseline: {r.baseline.frameCount} frames</span>
            )}
            <span style={{ fontSize: 14, color: '#666' }}>{expandedIdx === idx ? '▼' : '▶'}</span>
          </div>

          {/* Diffs summary */}
          {r.diffs.length > 0 && (
            <div style={{ padding: '4px 16px 8px', fontSize: 12, color: '#ef4444' }}>
              {r.diffs.map((d, di) => <div key={di}>• {d}</div>)}
            </div>
          )}

          {/* Expanded: frame thumbnails */}
          {expandedIdx === idx && r.frames.length > 0 && (
            <div style={{ padding: '8px 16px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {r.frames.map((f, fi) => {
                  const baselineThumb = r.baseline?.thumbnails[fi];
                  const labelMatch = r.baseline ? (f.label === r.baseline.labels[fi]) : true;
                  return (
                    <div key={fi} style={{
                      background: '#111', borderRadius: 6, padding: 10,
                      border: `1px solid ${labelMatch ? '#333' : '#ef4444'}`,
                    }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <img src={f.src} alt={f.label} style={{ width: 120, height: 'auto', borderRadius: 4, objectFit: 'contain' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: labelMatch ? '#fff' : '#ef4444', marginBottom: 4 }}>
                            {f.label || '(no label)'}
                            {!labelMatch && r.baseline && (
                              <span style={{ fontWeight: 400, color: '#888' }}> was: {r.baseline.labels[fi]}</span>
                            )}
                          </div>
                          {f.textContent && (
                            <div style={{ fontSize: 11, color: '#aaa', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                              {f.textContent}
                            </div>
                          )}
                        </div>
                      </div>
                      {baselineThumb && (
                        <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
                          <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>BASELINE:</div>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <img src={baselineThumb} alt="baseline" style={{ width: 120, height: 'auto', borderRadius: 3, opacity: 0.7, objectFit: 'contain' }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>
                                {r.baseline?.labels[fi] || '(no label)'}
                              </div>
                              {r.baseline?.textContents[fi] && (
                                <div style={{ fontSize: 11, color: '#555', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                                  {r.baseline.textContents[fi]}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => saveBaselineFor(idx)} style={{
                  padding: '6px 12px', background: '#22c55e', color: '#111', border: 'none',
                  borderRadius: 4, fontSize: 12, cursor: 'pointer',
                }}>
                  ✓ Correct — Save as Baseline
                </button>
                <button onClick={() => {
                  setResults(prev => {
                    const copy = [...prev];
                    copy[idx] = { ...copy[idx], status: 'fail', diffs: ['Manually marked as incorrect'] };
                    return copy;
                  });
                }} style={{
                  padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none',
                  borderRadius: 4, fontSize: 12, cursor: 'pointer',
                }}>
                  ✗ Incorrect
                </button>
                <button onClick={async () => {
                  const isFlagged = flagged.has(r.name);
                  await setFlag(r.name, !isFlagged);
                  setFlagged(prev => {
                    const next = new Set(prev);
                    if (isFlagged) next.delete(r.name); else next.add(r.name);
                    return next;
                  });
                }} style={{
                  padding: '6px 12px', background: flagged.has(r.name) ? '#f59e0b' : '#444',
                  color: flagged.has(r.name) ? '#111' : '#ccc', border: 'none',
                  borderRadius: 4, fontSize: 12, cursor: 'pointer',
                }}>
                  {flagged.has(r.name) ? '⚠ Flagged — click to unflag' : '⚠ Flag for fixing'}
                </button>
                {r.error && <span style={{ fontSize: 12, color: '#ef4444' }}>{r.error}</span>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
