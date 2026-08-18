# The simulator

Two real browsers, the real app, the real worker, a local database. What used to
take an evening of toggling airplane mode on two devices now takes about two
minutes and nobody has to be in the room.

## Once, to set up

```bash
cd ~/Desktop/Framehow\ Files/framehow-react
npm install                        # picks up @playwright/test
npx playwright install chromium webkit
```

WebKit matters: it is the engine the iPad actually runs, and it is where iOS
behaves differently from the desktop.

## Every time

```bash
npm run e2e            # both engines, headless
npm run e2e:webkit     # only the iPad's engine
npm run e2e:watch      # step through it and watch
```

It starts everything it needs by itself:

- `wrangler dev --local` on port 8787, with its own database under
  `backend/.wrangler-e2e` — the real routes and the real migrations, but nothing
  that can reach the real server or the real D1
- vite on port 5173, with `VITE_API_BASE_URL` pointed at that local worker

If a run fails, the report has the video, the trace and the sync log of both
devices: `npx playwright show-report e2e-report`.

## What is in here

| file | the question it answers |
|---|---|
| `01-reload.spec.ts` | reload both devices, change nothing — no crash, no pull held back, no full replace, and they still agree |
| `02-both-offline.spec.ts` | both offline and working: the later change wins whoever reconnects first; the later arrangement wins whole and a note survives it; a renamed category travels |
| `03-one-device-alone.spec.ts` | one device on its own asks itself no questions; and a push never makes a device stop listening |

## The one rule for anyone adding to this

**Never re-implement what the app does.** The tests reach the app through
`window.__fh_test` (`src/lib/testHooks.ts`), which is a set of pass-throughs to
the same functions the buttons call. The moment a test contains a decision of its
own, it has become a copy that drifts from the app — and a drifted test is worse
than no test, because it gives you confidence you have not earned.

That is exactly the weakness of the fast benches in `backend/test/`: their
"device" is hand-written. They stay, because they answer in one second and they
are the first line of defence. This suite answers a different question: does the
real thing, in a real browser, actually do it.
