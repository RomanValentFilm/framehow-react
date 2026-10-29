#!/usr/bin/env python3
"""A simple background bed for the Framehow video: 2:46, 100 BPM, A minor / C major.
Calm but awake; leaves the voice room (soft mids, no lead melody). Sections change
the rhythm so it never sits still:
  0:00  pad only, fading in
  0:10  soft pulse: pluck 8ths, kick on 1 and 3, sub bass
  0:48  lift: off-beat hats, syncopated pluck, moving bass
  1:26  breather: drums out, half-time arpeggio, other chords
  1:46  full: steady kick, hats, shaker, pluck an octave up
  2:29  drums out again, pad + pluck, fading out to 2:46
"""
import numpy as np, wave, sys

SR = 48000
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
DUR = 166.0
N = int(SR * DUR) + SR
rng = np.random.default_rng(7)

L = np.zeros(N); R = np.zeros(N)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

def put(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * np.sqrt((1 - pan) / 2)
    R[i:i + len(sig)] += sig * np.sqrt((1 + pan) / 2)

def env_adsr(n, a, d, s, r):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    e = np.full(n, s)
    e[:a] = np.linspace(0, 1, a, endpoint=False) if a else e[:a]
    e[a:a + d] = np.linspace(1, s, max(d, 1))[: len(e[a:a + d])]
    if r: e[-r:] *= np.linspace(1, 0, r)
    return e

def pad(midis, t, length):
    n = int(length * SR); tt = np.arange(n) / SR
    s = np.zeros(n)
    for m in midis:
        f = hz(m)
        for det in (-0.12, 0.0, 0.13):
            ff = f * 2 ** (det / 12)
            # soft, few harmonics: warm, not buzzy
            s += np.sin(2 * np.pi * ff * tt) + 0.25 * np.sin(4 * np.pi * ff * tt) + 0.08 * np.sin(6 * np.pi * ff * tt)
    s *= env_adsr(n, 0.8, 0.5, 0.85, 0.9) / (len(midis) * 3)
    s *= 1 + 0.08 * np.sin(2 * np.pi * 0.25 * tt)            # slow breathing
    return s

def pluck(m, length=0.9):
    n = int(length * SR); tt = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) * np.exp(-tt * 9) + 0.1 * np.sin(6 * np.pi * f * tt) * np.exp(-tt * 14)
    e = np.exp(-tt * 4.5); e[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return s * e

def kick():
    n = int(0.35 * SR); tt = np.arange(n) / SR
    f = 45 + 70 * np.exp(-tt * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 9)

def hat(length=0.06):
    n = int(length * SR); x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))                      # bright, thin
    return x * np.exp(-np.arange(n) / SR * 60) * 0.5

def shaker():
    n = int(0.12 * SR); x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x])); tt = np.arange(n) / SR
    return x * np.sin(np.pi * tt / tt[-1]) * 0.25

def bass(m, length):
    n = int(length * SR); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * hz(m) * tt) + 0.15 * np.sin(4 * np.pi * hz(m) * tt)) * env_adsr(n, 0.01, 0.1, 0.7, 0.08)

# chords: root (for bass) and voicing
MAIN = [(45, [57, 60, 64, 67]),   # Am7
        (41, [57, 60, 65, 69]),   # Fmaj7
        (48, [55, 60, 64, 67]),   # C
        (43, [55, 59, 62, 67])]   # G
BREAK = [(41, [53, 57, 60, 64]),  # Fmaj7
         (43, [55, 59, 62, 65]),  # G7 (soft)
         (40, [55, 59, 64, 67]),  # Em7
         (45, [57, 60, 64, 69])]  # Am

def section(t):
    if t < 9.6: return 'intro'
    if t < 48: return 'pulse'
    if t < 86.4: return 'lift'
    if t < 105.6: return 'break'
    if t < 148.8: return 'full'
    return 'outro'

nbars = int(DUR / BAR) + 1
for b in range(nbars):
    t0 = b * BAR
    sec = section(t0)
    root, voicing = (BREAK if sec == 'break' else MAIN)[b % 4]
    put(pad(voicing, t0, BAR + 0.9), t0, gain=0.40)
    if sec == 'intro':
        continue
    # PLUCK
    tones = voicing + [voicing[1] + 12]
    if sec == 'pulse':
        for k in range(8):
            put(pluck(tones[[0, 2, 1, 3, 2, 4, 1, 3][k]]), t0 + k * BEAT / 2, pan=-0.25 if k % 2 else 0.25, gain=0.16)
    elif sec == 'lift':
        steps = [0, 3, 6, 8, 10, 12, 14]                          # syncopated 16ths
        for j, k in enumerate(steps):
            put(pluck(tones[[0, 2, 4, 1, 3, 2, 4][j]]), t0 + k * BEAT / 4, pan=-0.3 if j % 2 else 0.3, gain=0.15)
    elif sec == 'break':
        for k in range(4):                                         # half-time arpeggio
            put(pluck(tones[k] + 12, 1.6), t0 + k * BEAT, pan=-0.4 + 0.27 * k, gain=0.13)
    elif sec in ('full', 'outro'):
        for k in range(8):
            put(pluck(tones[[0, 2, 4, 3, 1, 3, 2, 4][k]] + 12), t0 + k * BEAT / 2, pan=-0.3 if k % 2 else 0.3, gain=0.12)
    # BASS
    if sec == 'pulse':
        put(bass(root, BEAT * 1.8), t0, gain=0.32); put(bass(root, BEAT * 1.8), t0 + 2 * BEAT, gain=0.28)
    elif sec in ('lift', 'full'):
        for k, (dt, semi) in enumerate([(0, 0), (1.5, 0), (2, 7), (3, 12 if sec == 'full' else 0)]):
            put(bass(root + semi, BEAT * 0.9), t0 + dt * BEAT, gain=0.28)
    elif sec == 'break':
        put(bass(root, BAR), t0, gain=0.2)
    # DRUMS
    if sec == 'pulse':
        for k in (0, 2): put(kick(), t0 + k * BEAT, gain=0.45)
    elif sec == 'lift':
        for k in (0, 2, 2.5): put(kick(), t0 + k * BEAT, gain=0.42)
        for k in range(4): put(hat(), t0 + (k + 0.5) * BEAT, pan=0.35, gain=0.09)
    elif sec == 'full':
        for k in range(4): put(kick(), t0 + k * BEAT, gain=0.42)
        for k in range(4): put(hat(), t0 + (k + 0.5) * BEAT, pan=0.35, gain=0.09)
        for k in range(8): put(shaker(), t0 + k * BEAT / 2, pan=-0.4, gain=0.06 if k % 2 else 0.035)

# master: gentle fades (the final shaping is done by ffmpeg), soft clip
mix = np.stack([L, R], 1)[: int(SR * DUR)]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.2) * 0.8
pcm = (mix * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('written', sys.argv[1], round(len(mix) / SR, 1), 's')
