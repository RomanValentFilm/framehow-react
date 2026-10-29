#!/usr/bin/env python3
"""Framehow video bed, take 2 (Roman: "has to have some beat"; reference measured:
~109 BPM, kick on every beat, clap on 2 and 4, busy bright hats, steady energy).
2:46, no melody (the voice-over leads), chord stabs + bass + drums, side-chained.

  0:00  pad + hats fading in
  0:04  kick on every beat, bass
  0:22  + clap on 2/4, off-beat chord stabs, 16th hats
  0:57  break: kick out, riser
  1:06  drop: everything, open hats, octave bass
  1:50  half-time breather (kick on 1, clap on 3)
  1:59  full again, stabs pattern changes
  2:34  drums thin out, fade to 2:46
"""
import numpy as np, wave, sys

SR = 48000; BPM = 109; BEAT = 60 / BPM; BAR = 4 * BEAT; DUR = 166.0
N = int(SR * DUR) + 2 * SR
rng = np.random.default_rng(11)
DR = np.zeros((N, 2)); MU = np.zeros((N, 2)); KT = []      # drums, music, kick times

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def put(bus, sig, t, pan=0.0, g=1.0):
    i = int(t * SR)
    if i >= N: return
    s = sig[: N - i] * g
    bus[i:i + len(s), 0] += s * np.sqrt((1 - pan) / 2); bus[i:i + len(s), 1] += s * np.sqrt((1 + pan) / 2)
def tt(sec): return np.arange(int(sec * SR)) / SR
def smooth(x, k):                       # cheap low-pass (moving average)
    return np.convolve(x, np.ones(k) / k, 'same')

def kick():
    t = tt(0.4); f = 48 + 110 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    s[:240] += rng.standard_normal(240) * np.linspace(0.5, 0, 240)          # click
    return np.tanh(s * 1.6)
def clap():
    t = tt(0.25); s = np.zeros(len(t))
    for d in (0, 0.011, 0.022):
        i = int(d * SR); n = rng.standard_normal(len(t) - i)
        s[i:] += n * np.exp(-np.arange(len(n)) / SR * (60 if d < 0.02 else 18))
    s = s - smooth(s, 18); s = smooth(s, 3)                                 # band-ish 1–5 kHz
    return s * 0.5
def hat(open_=False):
    t = tt(0.25 if open_ else 0.05); n = rng.standard_normal(len(t))
    n = n - smooth(n, 4)
    return n * np.exp(-t * (14 if open_ else 70)) * 0.35
def bass(m, sec):
    t = tt(sec); f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    e = np.minimum(1, t / 0.005) * np.exp(-t * 2.5); e[-200:] *= np.linspace(1, 0, 200)
    return s * e
def stab(notes, sec=0.32):
    t = tt(sec); s = np.zeros(len(t))
    for m in notes:
        for det in (-0.08, 0.08):
            f = hz(m) * 2 ** (det / 12)
            s += np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) + 0.2 * np.sin(6 * np.pi * f * t)
    e = np.minimum(1, t / 0.004) * np.exp(-t * 9)
    return s * e / (len(notes) * 2)
def pad(notes, sec):
    t = tt(sec); s = np.zeros(len(t))
    for m in notes:
        for det in (-0.1, 0, 0.1):
            f = hz(m) * 2 ** (det / 12); s += np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)
    e = np.minimum(1, t / 0.6) * np.minimum(1, (sec - t) / 0.5)
    return s * e / (len(notes) * 3)
def riser(sec):
    t = tt(sec); n = rng.standard_normal(len(t)); n = n - smooth(n, 6)
    return n * (t / sec) ** 2 * 0.25

# A minor, upbeat: Am  F  C  G   (breathers: F  G  Am  Am)
PROG = [(45, [57, 60, 64]), (41, [57, 60, 65]), (48, [55, 60, 64]), (43, [55, 59, 62])]
BRK = [(41, [53, 57, 60]), (43, [55, 59, 62]), (45, [57, 60, 64]), (45, [57, 60, 64])]

def sec_at(t):
    for name, end in (('intro', 4.4), ('groove', 22.0), ('build', 57.2), ('break', 66.0),
                      ('drop', 110.1), ('half', 118.9), ('drop2', 154.2), ('outro', 999)):
        if t < end: return name

nb = int(DUR / BAR) + 1
for b in range(nb):
    t0 = b * BAR; s = sec_at(t0 + 0.01)
    root, ch = (BRK if s in ('break', 'half') else PROG)[b % 4]
    put(MU, pad([n + 12 for n in ch], BAR + 0.3), t0, g=0.22 if s in ('break', 'half', 'intro', 'outro') else 0.12)
    for k in range(4):
        tb = t0 + k * BEAT
        # KICK
        if s in ('groove', 'build', 'drop', 'drop2') or (s == 'outro' and t0 < 160) or (s == 'half' and k == 0):
            put(DR, kick(), tb, g=0.9); KT.append(tb)
        # CLAP
        if (s in ('build', 'drop', 'drop2') and k in (1, 3)) or (s == 'half' and k == 2) or (s == 'outro' and k in (1, 3) and t0 < 158):
            put(DR, clap(), tb, pan=0.05, g=0.55)
        # HATS
        if s != 'break':
            subs = 4 if s in ('build', 'drop', 'drop2') else 2
            for j in range(subs):
                if subs == 2 and j == 0 and s not in ('intro',): continue      # groove: off-beat only
                acc = 1.0 if (j * (4 // subs)) == 2 else 0.55
                put(DR, hat(), tb + j * BEAT / subs, pan=0.3, g=0.5 * acc * (0.6 if s == 'intro' else 1))
            if s in ('drop', 'drop2'):
                put(DR, hat(True), tb + BEAT / 2, pan=-0.25, g=0.28)
        # BASS
        if s in ('groove', 'build', 'drop', 'drop2', 'outro'):
            if s in ('drop', 'drop2'):
                for j, o in enumerate((0, 12)): put(MU, bass(root + o, BEAT / 2 * 0.9), tb + j * BEAT / 2, g=0.42)
            else:
                put(MU, bass(root, BEAT * 0.85), tb + BEAT / 2, g=0.45)        # off-beat bass
        # STABS (chords, no melody)
        if s in ('build', 'drop'):
            put(MU, stab(ch), tb + BEAT / 2, pan=-0.2 if k % 2 else 0.2, g=0.30)
        elif s == 'drop2':
            for dt in ((0.75,) if k % 2 == 0 else (0.25, 0.75)):               # changed pattern
                put(MU, stab([n + 12 for n in ch]), tb + dt * BEAT, pan=0.25 if k % 2 else -0.25, g=0.24)
    if s == 'break' and b % 4 == 3:
        put(DR, riser(BAR), t0, g=0.8)

# side-chain: music ducks under every kick, so the groove pumps
duck = np.ones(N)
dk = 1 - 0.55 * np.exp(-np.arange(int(0.3 * SR)) / SR * 12)
for t in KT:
    i = int(t * SR); m = min(len(dk), N - i); duck[i:i + m] = np.minimum(duck[i:i + m], dk[:m])
mix = DR + MU * duck[:, None]
mix = mix[: int(DUR * SR)]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.5) / np.tanh(1.5) * 0.85
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('written', round(len(mix) / SR, 1), 's')
