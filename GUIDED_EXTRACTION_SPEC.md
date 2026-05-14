# Guided PDF Extraction — Feature Spec

## The Problem
Every storyboard PDF has a different layout. Our pixel-analysis parser works for ~90% of PDFs, but fails on irregular ones (like ALBERT with yellow section headers, mixed frame sizes, sub-labels). Instead of endlessly tweaking heuristics, let the user teach the app where the frames are.

## Color System
Three overlay colors, each for a different element type:
- **RED** rectangles = frame image areas (the storyboard pictures)
- **GREEN** rectangles = frame number positions (e.g. "1.", "7a.", "13b.")
- **BLUE** rectangles = text description areas (the script/action text below frames)

The user marks these in order: first frames, then numbers, then text areas.

## How It Works

### Flow
1. User loads a PDF → auto-extraction runs as normal (extractCandidates on all pages)
2. Instead of immediately building strips, show a **preview overlay**: render ALL pages as a scrollable vertical stack. The first storyboard page (with ≥2 candidates) is scrolled into view.
3. Auto-detected frames are shown as **red rectangles** overlaid on the pages.
4. User sees: **"Looks good ✓"** and **"Let me fix it"** buttons, plus **"Skip page ▼"** at the bottom to jump past cover/title pages to the next page.
5. If "Looks good" → continue with auto-extracted candidates as today, no change.
6. If "Let me fix it" → enter **guided mode**.

### Guided Mode

#### Step 1 — Mark frames (RED)
1. All auto-detected rectangles disappear. The scrollable page stack stays.
2. Instruction: **"Draw a rectangle over the 1st frame"**
3. User touch-drags a RED rectangle over the first storyboard frame.
4. Instruction: **"Draw a rectangle over the 2nd frame"**
5. User draws a second RED rectangle.
6. Instruction: **"Draw a rectangle over the 1st frame in the 2nd row"**
   — This is the KEY step. Knowing the first frame of the second row tells us:
   - Where the row boundary is (the biggest pain point in auto-detection)
   - Row height/spacing
   - Whether columns align across rows
   - If user taps **"No 2nd row"** → single-row-per-page layout

#### Auto-prediction after 3 frames
7. After the user draws 3 frame rectangles, the system **immediately computes the grid pattern** and shows predicted RED rectangles for ALL remaining frames across ALL pages.
8. Instruction: **"Does this look right?"** with **"Looks good ✓"** / **"Let me adjust"**
9. If the user confirms → skip to Step 2 (numbers).
10. If the user wants to adjust → they can:
    - **Drag edges/corners** of any rectangle to resize it
    - **Drag the center** of any rectangle to reposition it
    - **Tap the × in the corner** of a rectangle to delete it (false positive — system found a frame where there is none)
    - **Draw new rectangles** to add missed frames
    - **Scroll** through all pages to check the predictions
11. User taps **"Next →"** when frames look correct.

#### Step 2 — Mark numbers (GREEN)
12. Instruction: **"Tap the number of Frame 1 — or tap Skip"**
13. User taps the frame number (e.g. "1." or "7a.") → a GREEN dot/rect appears at the tap position.
14. System uses the offset between the GREEN tap and the RED frame to predict GREEN markers for all other frames.
15. User can adjust/delete predicted GREEN markers same as RED ones.
16. **Skip** → no number detection, frames will be auto-numbered #1, #2, #3…
17. User taps **"Next →"**

#### Step 3 — Mark text areas (BLUE)
18. Instruction: **"Draw a rectangle over the text description below Frame 1 — or tap Skip"**
19. User draws a BLUE rectangle over the script/action text area below frame 1.
20. System predicts BLUE rectangles for all other frames based on the offset.
21. User can adjust/delete.
22. **Skip** → no text extraction, OCR fallback only.
23. User taps **"Extract"** → extraction begins using the confirmed rectangles.

### Navigation
- **Scroll**: the overlay is a scrollable vertical stack of all PDF pages, so the user can scroll through the entire document to verify predictions on every page.
- **"Skip page ▼"** button: always visible at the bottom, scrolls to the next page. Useful for quickly jumping past cover pages to find the actual storyboard.
- Pages are rendered at a readable size (fit-width on iPad, reasonable scale on desktop).

### Rectangle Interaction
All rectangles (RED, GREEN, BLUE) — whether user-drawn or system-predicted — are interactive:
- **Resize**: drag any edge or corner handle to make bigger/smaller
- **Reposition**: drag from center to move
- **Delete**: small **×** button in the top-right corner of each rectangle
- **Add**: draw a new rectangle anywhere (in the current color/step)
- Visual distinction: user-drawn rects have a solid border, system-predicted rects have a dashed border (so you can tell which ones the system guessed)

### Template Computation
From the user-drawn rectangles, compute:
- **Frame size**: average width and height of rects 1 & 2 → this is the crop size
- **Column positions**: x-coordinates of rects 1 & 2 give first two columns → infer column spacing → extrapolate remaining columns across page width
- **Row 1 position**: y-coordinate of rects 1 & 2
- **Row 2 position**: y-coordinate of rect 3 (the "1st frame in 2nd row") → this directly gives us the row boundary that auto-detection struggles with
- **Row spacing**: row2.y - row1.y → extrapolate if there are more rows
- **Grid pattern**: columns × rows per page
- **Number offset** (if user tapped a number): vector from GREEN tap to RED frame → find numbers for all frames via getTextItems()
- **Text offset** (if user drew a BLUE rect): vector from BLUE rect to RED frame → locate text areas for all frames

### Apply to All Pages
For each page in the PDF:
1. Render the page at scale 2 (same as current)
2. Use the template grid to locate frames — positions stored as **0-1 ratios** so they work across pages
3. Crop each frame at the confirmed RED rectangle positions
4. Match numbers using GREEN positions (or fall back to matchLabel())
5. Extract text from BLUE positions (or fall back to matchText() / OCR)
6. Skip empty cells (dark-pixel ratio < 2% → no frame there)

## Architecture (3 files)

### 1. `src/lib/guided-extraction.ts` (NEW)
Framework-agnostic module (no React), consistent with how the codebase works.

```typescript
interface UserRect {
  x: number; y: number; w: number; h: number;
  type: 'frame' | 'number' | 'text';
  pageIdx: number;
  userDrawn: boolean;    // true = user drew it, false = system predicted
}

interface ExtractionTemplate {
  cols: number[];        // x positions (0-1 ratio)
  rows: number[];        // y positions (0-1 ratio)
  frameW: number;        // frame width (0-1 ratio)
  frameH: number;        // frame height (0-1 ratio)
  numberDx: number;      // number offset x (0-1 ratio), 0 if not set
  numberDy: number;      // number offset y (0-1 ratio), 0 if not set
  textDx: number;        // text area offset x (0-1 ratio), 0 if not set
  textDy: number;        // text area offset y (0-1 ratio), 0 if not set
  textW: number;         // text area width (0-1 ratio), 0 if not set
  textH: number;         // text area height (0-1 ratio), 0 if not set
}

// Called after user draws 3 RED rects — returns predicted rects for all pages
export function predictFrames(
  userRects: UserRect[],
  pages: { pageW: number; pageH: number }[]
): UserRect[]

// Called after user taps GREEN number — returns predicted number positions
export function predictNumbers(
  numberTap: { x: number; y: number; pageIdx: number },
  frameRects: UserRect[],
  pages: { pageW: number; pageH: number }[]
): UserRect[]

// Called after user draws BLUE text rect — returns predicted text areas
export function predictTextAreas(
  textRect: UserRect,
  frameRects: UserRect[],
  pages: { pageW: number; pageH: number }[]
): UserRect[]

// Final extraction using confirmed rectangles
export async function extractWithRects(
  pdf: any,
  frameRects: UserRect[],
  numberRects: UserRect[],
  textRects: UserRect[]
): Promise<ExtractedFrame[]>
```

### 2. `src/components/Modals.tsx` — add markup
Add a new overlay div (same pattern as progressOverlay, cropOverlay):
```html
<div className="extraction-preview-overlay hidden" id="extractionPreview">
  <!-- Scrollable page stack -->
  <div className="extraction-pages" id="extractionPages">
    <!-- Pages rendered as canvases, stacked vertically -->
  </div>

  <!-- SVG overlay for interactive rectangles (on top of pages) -->
  <svg id="extractionSvg"></svg>

  <!-- Top instruction bar -->
  <div className="extraction-instruction" id="extractionInstruction">
    Checking detected frames…
  </div>

  <!-- Bottom controls -->
  <div className="extraction-controls" id="extractionControls">
    <button id="extractionOk">Looks good ✓</button>
    <button id="extractionFix">Let me fix it</button>
    <button id="extractionSkipPage">Skip page ▼</button>
    <button id="extractionNext" class="hidden">Next →</button>
    <button id="extractionExtract" class="hidden">Extract</button>
    <button id="extractionCancel">Cancel</button>
  </div>
</div>
```

### 3. `src/lib/pdf.ts` — modify handlePDF()
After the scanning loop (where allCandidates is built), insert a preview step:

```typescript
// Show preview overlay with all pages + auto-detected candidates
const userChoice = await showExtractionPreview(allCandidates, pdf);
if (userChoice.action === 'accept') {
  // continue with existing auto-extraction pipeline
} else if (userChoice.action === 'guided') {
  // user adjusted rectangles — extract using confirmed positions
  const frames = await extractWithRects(
    pdf, userChoice.frameRects, userChoice.numberRects, userChoice.textRects
  );
  // skip the rest of auto-extraction, jump to building strips
}
```

## CSS (add to globals.css)
Follow the same pattern as `.fs-overlay` and `.crop-overlay`:
- Fixed position, full screen, dark background (rgba(0,0,0,0.95))
- `.extraction-pages`: scrollable container, vertical stack of page canvases with small gaps
- SVG overlay positioned absolutely on top of pages, same scroll position
- Rectangle colors: RED `rgba(255,0,0,0.3)` fill + `rgb(255,0,0)` stroke, GREEN `rgba(0,200,0,0.3)` + `rgb(0,200,0)`, BLUE `rgba(0,100,255,0.3)` + `rgb(0,100,255)`
- User-drawn rects: solid 2px stroke. System-predicted rects: dashed 2px stroke.
- Resize handles: small circles at corners/edges
- Delete button: small × circle at top-right corner of each rect
- Controls pinned at bottom, instruction bar pinned at top
- z-index: 200 (same as other overlays)
- Pointer events on SVG for drawing/dragging. Use pointer events (not mouse events) for iPad.

## Important Notes
- **Don't break auto mode** — this is an optional step. If the auto extraction works, user taps "Looks good" and never enters guided mode.
- **iPad-first** — all interactions must work with touch. Use pointer events.
- **Scrollable** — the user must be able to scroll through all pages to verify system predictions before extracting.
- **Skip page** — always available so user can jump past cover/title pages.
- **Adjustable rectangles** — every rectangle (user-drawn or predicted) can be resized, moved, or deleted.
- **× to delete** — predicted frames that are wrong can be removed with one tap.
- **Solid vs dashed** — visual distinction between what the user drew and what the system guessed.
- **Live prediction** — after 3 frame rects, the system immediately shows its prediction on all pages. No waiting.
- **Relative coordinates** — store everything as 0-1 ratios so the template works across pages.
- **v1.3 is sacred** — don't touch it. This feature goes into v1.4+.
- **Reuse existing functions** — `extractCandidates()`, `matchLabel()`, `matchText()`, `getTextItems()` can all be reused. Guided mode just replaces the candidate detection step.

## Load-First Flow (Default Behavior)

Since ~90% of storyboard PDFs parse correctly, the app should **not** force the guided tool on every user. Instead:

1. User drops a PDF → auto-extraction runs as normal → storyboard loads
2. **7 seconds after extraction completes**, a dark popup fades in, centered on screen:
   - Text: **"Frames look wrong?"**
   - Red button: **"Adjust extraction"**
   - Small text below button: **"You can always find this in the Menu."**
3. The popup auto-dismisses after 10 seconds if the user doesn't interact, or the user taps anywhere outside it to dismiss
4. Clicking "Adjust extraction" opens the guided extraction overlay (the full flow described above)
5. The same option is always available in the Menu (hamburger → "Adjust extraction") for users who dismiss the popup but later realize they need it

This way:
- 90% of users: PDF loads → they're working in seconds → popup fades away untouched
- 10% who need fixes: popup appears → one tap → guided mode → fixed in 30 seconds


## Learning from User Corrections

Every time a user uses the guided extraction to fix auto-detection errors, the app captures anonymized correction data and sends it to the tracking Worker (`framehow-tracker`). This builds a dataset over time that reveals exactly where the auto-detector fails.

### What to Capture

For each guided extraction session, send:
- **PDF characteristics**: page count, page dimensions (width × height in pts), DPI
- **Auto-detection result**: number of candidates found per page, grid dimensions detected
- **User corrections**: what was changed — with type tags:
  - `added_frame` — user drew a frame the system missed
  - `removed_frame` — user deleted a false positive
  - `resized_frame` — user adjusted frame boundaries
  - `merged_columns` — user corrected column detection
  - `split_row` — user fixed a row that was merged
  - `skipped_page` — user marked a page as non-storyboard (cover, text-only)
- **Final result**: confirmed grid dimensions, number of frames extracted
- **No image data or content** — only structural metadata (rectangles, positions, counts)

### How to Use the Data (Practical Steps)

1. **Admin review page** — build a simple endpoint (like `/admin/corrections`) that lists recent correction sessions. Each entry shows: "PDF with 8 pages, auto found 22 frames, user removed 3 false positives (caused by header rows), added 1 missed frame."

2. **Spot patterns manually** — review the corrections weekly. Common patterns will emerge quickly:
   - "70% of removals are false frames from colored headers" → tighten `isColorNoise()` thresholds
   - "Most added frames are in PDFs with 4+ columns" → improve column detection for wide layouts
   - "Users keep resizing frames on landscape-oriented pages" → auto-detection assumes portrait

3. **Translate patterns into code fixes** — each pattern becomes a targeted heuristic improvement in `pdf.ts`. This is the same process that fixed the yellow headers and red cross-out marks — but now driven by real user data instead of individual bug reports.

4. **Track improvement over time** — as you ship fixes, the correction rate should drop. If 15% of users needed guided extraction in month 1 and only 5% need it in month 3, the heuristics are working.

### Machine Learning (Much Later, Maybe Never)

ML would mean training a model on the correction data to automatically detect frame boundaries instead of using hand-coded rules. This requires:
- Hundreds or thousands of correction examples (dataset)
- A training pipeline (Python, likely offline)
- A way to run inference in the browser (TensorFlow.js or ONNX)
- Ongoing model maintenance

For Framehow's scale, this is likely overkill. The manual review → code fix loop will get you to 95%+ accuracy. ML only makes sense if you have thousands of users generating enough correction data and the long tail of edge cases becomes too varied for hand-coded rules. Keep it as a theoretical option, not a plan.


## Keynote Storyboard Import (Future Feature)

Many film professionals create storyboards in Apple Keynote. Supporting `.key` file import would be valuable.

### How It Works Technically
- Keynote files (`.key`) are ZIP archives internally
- Unzip in the browser using JSZip (already a dependency)
- Parse the internal XML/protobuf structure to find slides
- Extract images and text from each slide
- Map each slide to a Frame in the Framehow store

### Implementation Notes
- This would be a separate import pipeline alongside PDF and Images
- Entry point: a new "Load from Keynote" option in the startup screen / menu
- Keynote's internal format has changed across versions — need to handle at least the current format
- Slide dimensions map to frame aspect ratio
- Text boxes on slides become the frame's text content
- Embedded images become the frame's source image


## Priority & Ordering

These features are not tied to a specific version number. Build order based on user impact:

1. **Load-first flow + "Frames look wrong?" popup** — low effort, improves the experience immediately
2. **Guided extraction overlay** — the core feature, biggest development effort
3. **Correction data capture** — add alongside guided extraction, almost no extra work
4. **Admin review page** — build when there's enough data to review
5. **Keynote import** — independent feature, can be built anytime
6. **ML** — only if the data shows the need and scale justifies it
