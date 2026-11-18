// THE CAMERA SCREEN (6 Nov 2026) — the test app's screen (native/FramehowCamTest
// ContentView), with Framehow's RATIO button instead of the test's fixed list:
// the same ratios FH CAM offers (CAM_RATIOS / PORTRAIT_RATIOS / FITTING_RATIOS,
// CANVAS included — the web app sends the list and the canvas's own value).
// Everything else as tested on 3 Nov: frame fills the screen, controls float,
// tap to focus with the yellow square, slide for EV with its value shown,
// 1x / 0.5x, shutter bottom-middle in portrait and right-middle in landscape.

import AVFoundation
import SwiftUI

struct CameraPreview: UIViewRepresentable {
    @ObservedObject var cam: CameraModel

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        var coordinator: AVCaptureDevice.RotationCoordinator?
        var observation: NSKeyValueObservation?

        func bind(_ device: AVCaptureDevice, _ cam: CameraModel) {
            let c = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
            coordinator = c
            cam.rotationCoordinator = c
            apply(c.videoRotationAngleForHorizonLevelPreview)
            observation = c.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] c, _ in
                Task { @MainActor in self?.apply(c.videoRotationAngleForHorizonLevelPreview) }
            }
        }
        func apply(_ angle: CGFloat) {
            if let conn = previewLayer.connection, conn.isVideoRotationAngleSupported(angle) { conn.videoRotationAngle = angle }
        }
    }

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = cam.session
        v.previewLayer.videoGravity = .resizeAspect
        return v
    }

    func updateUIView(_ v: PreviewView, context: Context) {
        if v.coordinator == nil, let d = cam.device {
            v.bind(d, cam)
            cam.devicePoint = { [weak v] p in v?.previewLayer.captureDevicePointConverted(fromLayerPoint: p) ?? CGPoint(x: 0.5, y: 0.5) }
        }
    }
}

/// THE RULE (Roman, 3 Nov): the frame's long side IS the chip's long side; the screen
/// only zooms so the whole frame is visible. In the photo the frame is a centred band.
struct FrameGeometry {
    let chip: CGRect
    let frame: CGRect

    /// `screen` and `corner`: the size of the whole screen and the radius of its round
    /// corners. THE FRAME NEVER REACHES INTO A ROUND CORNER (Roman, 11 Nov): a frame as
    /// wide as the screen had its four corners cut off by the glass, and the frame is the
    /// photo. It is made just small enough for all four corners to show.
    init(ratio: CGFloat, landscape: Bool, free: CGRect, screen: CGSize = .zero, corner: CGFloat = 0) {
        let r = landscape ? ratio : 1 / ratio
        let c = CGPoint(x: free.midX, y: free.midY)
        func rect(_ w: CGFloat) -> CGRect { CGRect(x: c.x - w / 2, y: c.y - (w / r) / 2, width: w, height: w / r) }
        var w = min(free.width, free.height * r)
        if corner > 0, screen.width > 0 {
            while w > 80, FrameGeometry.cutByCorner(rect(w), screen: screen, corner: corner) { w -= 2 }
        }
        let h = w / r
        frame = rect(w)
        // THE CHIP'S PICTURE ALWAYS FILLS THE FRAME (Roman, 17 Nov, 1:1: "it's inside a
        // box, but it's cropped somehow"). The chip is 4:3. Its width was always made
        // the frame's width — right for every frame WIDER than 4:3, where the frame is a
        // band across the chip. A frame NARROWER than 4:3 (1:1 is the only one) is
        // higher than that picture: black bars stood above and below, inside the frame
        // lines. Now the chip's picture is as large as the frame needs on BOTH sides —
        // for 1:1 its height is the frame's height and the sides lie outside the lines,
        // dimmed like everything outside a frame. Nothing changes for any other ratio.
        let cw = landscape ? max(w, h * 4 / 3) : max(h, w * 4 / 3) * 3 / 4
        let ch = landscape ? max(w, h * 4 / 3) * 3 / 4 : max(h, w * 4 / 3)
        chip = CGRect(x: c.x - cw / 2, y: c.y - ch / 2, width: cw, height: ch)
    }

    /// Is a corner of this frame inside the part of the screen a round corner cuts away?
    /// The frame's nearest corner sits `dx` in and `dy` down from the screen's own corner;
    /// it shows when it lies inside the quarter circle of the glass.
    static func cutByCorner(_ f: CGRect, screen: CGSize, corner: CGFloat) -> Bool {
        let dx = max(0, min(f.minX, screen.width - f.maxX))
        let dy = max(0, min(f.minY, screen.height - f.maxY))
        if dx >= corner || dy >= corner { return false }
        let a = corner - dx, b = corner - dy
        return a * a + b * b > corner * corner
    }
}

/// One entry of the RATIO list, as the web app knows it.
struct RatioChoice: Identifiable {
    let key: String       // '16:9', 'canvas', 'fit1', …
    let label: String     // what the button says
    let value: CGFloat    // long / short, ≥ 1 (CANVAS and GROUP PHOTO already resolved by the web app)
    var id: String { key }
}

struct CameraScreen: View {
    /// Owned by the plugin: it outlives this screen, so the real photo can still
    /// arrive after the screen has closed on the live frame.
    @ObservedObject var cam: CameraModel
    let ratios: [RatioChoice]
    @State var ratioKey: String
    let maxSide: CGFloat
    /// The RATIO in force changed (the plugin reports it with both answers).
    let onRatio: (String) -> Void
    let onCancel: () -> Void
    /// THE SERIES (17 Nov): the names the shots will land on ("v8", "v9" … — the web app
    /// knows them), and what DONE or a tap on the picture box calls: "done" or "box".
    var names: [String] = []
    var onDone: (String) -> Void = { _ in }

    @State private var showRatios = false
    @State private var focusMark: CGPoint?
    @State private var dragStartEV: Float?
    @State private var sliding = false
    @State private var markGeneration = 0
    @State private var pinchStart: CGFloat?
    /// Counts the device's turns: turned straight from one sideways to the other, the screen's
    /// size does not change and nothing would be laid out again — but the island changes sides.
    @State private var turns = 0

    private var current: RatioChoice { ratios.first { $0.key == ratioKey } ?? ratios.first ?? RatioChoice(key: "16:9", label: "16:9", value: 16.0 / 9.0) }

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            let _ = turns
            // THE DYNAMIC ISLAND (Roman, 10 + 11 Nov). Sideways the island sits on one short
            // side of the screen. THE PICTURE BEGINS WHERE THE ISLAND ENDS — on that side
            // only; the other side goes to the very edge. So nothing of the shot is ever
            // hidden under the island (Framehow is for framing), and the strip beside the
            // island stays black. It is the same whichever way the phone is turned.
            //
            // He compared three ways on the phone: Apple's Camera (black on BOTH sides),
            // the picture at full length under the island, and this one — the web FH CAM
            // already does it. `pictureEndsAtTheIsland` off = full length under the island.
            //
            // What one TAPS keeps clear of the island too: the shutter, Cancel and the note
            // sit on the right and move in beside the island when it is on that side.
            // UPRIGHT TOO (Roman, 11 Nov, first look on the phone: "the island is still
            // visible in vertical"): there the island is at the top, and the picture begins
            // under it.
            let all = Self.islandInsets()
            let island = Self.pictureEndsAtTheIsland ? all : (left: CGFloat(0), right: CGFloat(0), top: CGFloat(0))
            let free = CGRect(x: island.left, y: island.top,
                              width: geo.size.width - island.left - island.right,
                              height: geo.size.height - island.top)
            let fg = FrameGeometry(ratio: current.value, landscape: landscape, free: free,
                                   screen: geo.size, corner: Self.screenCornerRadius())
            // THE PICTURE AS IT IS SEEN: the camera's picture where it is on the screen and
            // not black. The corner buttons are placed from ITS edges (see `cornerGap`).
            // THE BUTTONS SIT IN THE CORNERS OF THE SCREEN, WHATEVER THE RATIO (Roman, 17 Nov:
            // "now we are always moving them with the aspect ratio … I would rather keep them
            // in the corners of the screen"). They used to sit inside the picture and moved
            // with every ratio. `pic` is now the screen the camera may use (it still ends
            // where the island ends); on a side that is the glass's own edge the buttons
            // keep clear of its round corner.
            let whole = free.intersection(CGRect(origin: .zero, size: geo.size))
            let round: CGFloat = Self.screenCornerRadius() > 0 ? 10 : 2      // + cornerGap (12) = 22 / 14 from the glass
            let pic = CGRect(
                x: whole.minX + (whole.minX > 0 ? 0 : round),
                y: whole.minY + (whole.minY > 0 ? 0 : round),
                width: whole.width - (whole.minX > 0 ? 0 : round) - (whole.maxX < geo.size.width ? 0 : round),
                height: whole.height - (whole.minY > 0 ? 0 : round) - round)
            let _ = { cam.frameRatio = current.value; cam.maxSide = maxSide; cam.frameOnScreen = fg.frame }()
            let touch = DragGesture(minimumDistance: 0)
                .onChanged { g in
                    let dy = g.translation.height
                    if dragStartEV == nil { dragStartEV = cam.exposureBias }
                    if sliding || abs(dy) > 12 {
                        sliding = true
                        cam.exposureBias = max(-2, min(2, (dragStartEV ?? 0) - Float(dy) / 80))
                    }
                }
                .onEnded { g in
                    if !sliding {
                        let p = g.startLocation
                        focusMark = p
                        cam.focus(atPreviewPoint: CGPoint(x: p.x - fg.chip.minX, y: p.y - fg.chip.minY))
                    }
                    sliding = false; dragStartEV = nil
                    markGeneration += 1
                    let gen = markGeneration
                    Task { try? await Task.sleep(for: .seconds(1.5)); if gen == markGeneration { focusMark = nil } }
                }
            // Two-finger spread / pinch: zoom, the lens following (0.5x below 1, 1x from 1).
            let pinch = MagnificationGesture()
                .onChanged { m in
                    if pinchStart == nil { pinchStart = cam.zoomShown }
                    cam.setZoom((pinchStart ?? 1) * m)
                }
                .onEnded { _ in pinchStart = nil }
            ZStack {
                Color.black
                CameraPreview(cam: cam)
                    .frame(width: fg.chip.width, height: fg.chip.height)
                    .position(x: fg.chip.midX, y: fg.chip.midY)
                if let fr = cam.frozen {
                    // the whole live picture, frozen where it was; mask and frame line unchanged
                    Image(uiImage: fr).resizable().scaledToFit()
                        .frame(width: fg.chip.width, height: fg.chip.height)
                        .position(x: fg.chip.midX, y: fg.chip.midY)
                }
                // FROM THE SHUTTER ON, ONLY THE PHOTO ON BLACK (Roman, 11 Nov, his recording):
                // the frozen shot stood among the dimmed rest of the live picture and all the
                // buttons, and a moment later on the bare app. Now everything outside the
                // frame is black from the flash on, the frame line and the buttons are gone —
                // and the web's copy starts on the same black (actions.ts), which then fades.
                let shot = cam.flash || cam.frozen != nil || cam.closing
                FrameLine(frame: fg.frame, solid: shot)
                Color.clear.contentShape(Rectangle()).gesture(touch).simultaneousGesture(pinch)
                if let m = focusMark {
                    Rectangle().stroke(.yellow, lineWidth: 1.5).frame(width: 70, height: 70).position(m)
                        .allowsHitTesting(false)
                    Image(systemName: "sun.max.fill").foregroundStyle(.yellow).font(.system(size: 16))
                        .position(x: m.x + 50, y: m.y - CGFloat(cam.exposureBias) * 20)
                        .allowsHitTesting(false)
                }
                if cam.flash { Color.black.allowsHitTesting(false) }
                if !shot {
                    controls(landscape: landscape, right: island.right, pic: pic)
                    if showRatios { ratioMenu(pic: pic) }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        // (The clock and battery are hidden by the app's own screen BEFORE this one comes —
        // see the plugin. Hidden from here, in either of two ways, this screen laid itself
        // out in a circle and stopped redrawing. Roman's iPad, 13 Nov.)
        .background(.black)
        .foregroundStyle(.white)
        .onAppear { cam.start() }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            // a moment later: the window's own orientation follows the device's
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { turns += 1 }
        }
    }

    /// true = the picture ends where the island begins (one black strip beside the island);
    /// false = the picture keeps the whole screen and the island lies over it.
    private static let pictureEndsAtTheIsland = true

    /// The radius of the screen's round corners. There is no public number for it, so it is
    /// read off the safe area: an iPhone with the island (top inset 51 and more) has about
    /// 55 pt, one with the notch about 47, an iPad about 18, a phone with a home button none.
    /// A little is added so the frame line itself is not shaved either.
    private static func screenCornerRadius() -> CGFloat {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else { return 0 }
        if UIDevice.current.userInterfaceIdiom == .pad { return 18 + 3 }
        let i = window.safeAreaInsets
        let deepest = max(i.top, i.left, i.right)
        if deepest >= 51 { return 55 + 3 }
        if deepest >= 40 { return 47 + 3 }
        return 0
    }

    /// How far the Dynamic Island (or the notch) reaches into the screen: from the left or
    /// the right when the phone is sideways, from the top when it is upright.
    /// Sideways the system reports the same inset on both short sides; only the side the
    /// island is really on is kept. `landscapeRight` = the device's top (the island) is on
    /// the LEFT. Upright only a real island or notch counts (40 pt and more) — a plain
    /// status bar, and an iPad's, is not something the picture has to make room for.
    private static func islandInsets() -> (left: CGFloat, right: CGFloat, top: CGFloat) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else { return (0, 0, 0) }
        let i = window.safeAreaInsets
        switch scene.interfaceOrientation {
        case .landscapeRight: return (i.left, 0, 0)
        case .landscapeLeft: return (0, i.right, 0)
        case .portrait: return (0, 0, i.top >= 40 ? i.top : 0)
        default: return (0, 0, 0)
        }
    }

    @ViewBuilder
    private func controls(landscape: Bool, right: CGFloat, pic: CGRect) -> some View {
        let pill = Color.black.opacity(0.45)
        // IN A SERIES THE SHUTTER NEVER WAITS (Roman, 17 Nov: "1, 2, 3, 4 … right away"): the
        // photos are made behind the camera while the next one is taken. A single shot still
        // takes one photo at a time.
        let shutter = Button(action: { if cam.seriesMax > 0 || cam.busy == 0 { cam.takePhoto() } }) {
            Circle().fill(.white).frame(width: 66, height: 66)
                .overlay(Circle().stroke(.gray, lineWidth: 3).padding(4))
        }
        // ONE LOOK FOR ALL THREE (Roman, 11 Nov): the EV's — the smaller one. RATIO and 1x
        // were the system's bordered button, a size larger and another face.
        let ratioButton = Button(action: { showRatios.toggle() }) { Self.pillLabel("RATIO") }
            .tint(.white).background(pill, in: Capsule())
        let lens = Button(action: { cam.setLens(wide: !cam.wide) }) { Self.pillLabel(cam.lensName.isEmpty ? "1x" : cam.lensName) }
            .tint(.white).background(pill, in: Capsule())
        // CANCEL left of the shutter (Roman, 6 Nov: the top right is the EV's place) — the
        // way out without a photo, where the thumb already is.
        // A FINGER-SIZED PLACE TO TAP (13 Nov, measured on Roman's iPad: three taps on
        // "Cancel" landed on the picture beneath, 5 to 10 points under the word). The
        // button was only as big as the word itself — 16 points high; the padding round
        // it was not part of it. Now the word sits in a clear field of 96 × 48 that is
        // all button. Still a plain word, no pill (Roman, 6 Nov).
        // ONCE THERE IS A SHOT, CANCEL IS DONE (Roman, 17 Nov): a series is not thrown away
        // inside the camera; DONE closes it and the shots land.
        let hasShots = cam.seriesMax > 0 && !cam.seriesThumbs.isEmpty
        let cancel = Button(action: { if hasShots { onDone("done") } else { onCancel() } }) {
            Text(hasShots ? "DONE" : "Cancel").font(.footnote).foregroundStyle(Color.white.opacity(hasShots ? 1 : 0.85))
                .frame(width: 96, height: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // (no "processing…" any more — Roman, 17 Nov: "what I do not like". Only what is
        // wrong is said here: no permission, a failed capture.)
        let info = Text(cam.status == "ready" ? "" : cam.status)
            .font(.caption2).padding(6).background(pill, in: RoundedRectangle(cornerRadius: 8))
            .opacity(cam.status != "ready" && !cam.status.isEmpty ? 1 : 0)

        GeometryReader { g in
            let W = g.size.width, H = g.size.height
            ZStack {
                // RATIO, EV AND 1x: EACH THE SAME DISTANCE FROM ITS TWO EDGES OF THE PICTURE
                // (Roman, 11 Nov, three looks on the phone: "the distance to the left and to
                // the bottom should be the same … that's how they are centred in the corner").
                // The edges are those of the picture AS SEEN — where the white frame line or
                // the black begins — not those of the screen: measured from the screen, a
                // button sat 17 from the side and 8 from the line above it.
                let d = Self.cornerGap
                // (For an hour on 13 Nov the row stood 56 points down on the iPad — a wrong
                // guess at why RATIO did not answer. It was the screen not redrawing; see the
                // plugin. The row is back in the corner, as on the iPhone: Roman.)
                // RATIO top left · the lens button top right, where EV was (Roman, 17 Nov). The
                // EV button is gone; sliding up and down for brightness stays. Bottom left is
                // kept free for the picture box of the series.
                VStack { HStack { ratioButton; Spacer(); lens }; Spacer() }
                    .padding(.leading, pic.minX + d).padding(.trailing, W - pic.maxX + d).padding(.top, pic.minY + d)
                // THE PICTURE BOX OF THE SERIES, bottom left (Roman, 17 Nov): the newest shot,
                // fitted into a square with black beside it; above it, in the same grey shape
                // and with no boxes of their own, the names the shots land on. A tap = DONE and
                // the MAX view on the last shot.
                if hasShots {
                    // ROUND 4 (Roman, 17 Nov, after shooting with it): the photo fills the grey
                    // shape edge to edge; the names stand LEFT, so one sees them come one by one
                    // (v8, then v8 v9 …); and the whole thing sits closer to the edge of the
                    // screen than the buttons do.
                    // (the box itself is SeriesBox, below: it has the photo's own shape, no black bars)
                    let box = SeriesBox(photo: cam.seriesThumbs.last,
                                        names: Array(names.prefix(cam.seriesThumbs.count)),
                                        flash: cam.boxFlash, fill: pill, slots: max(1, cam.seriesMax),
                                        onTap: { onDone("box") })
                    // 14 from the glass where the glass is the edge (the buttons stand 22 away);
                    // beside the island it keeps the buttons' distance
                    let near: CGFloat = Self.screenCornerRadius() > 0 ? 8 : 0
                    let islandLeft = Self.islandInsets().left > 0
                    VStack { Spacer(); HStack { box; Spacer() } }
                        .padding(.leading, pic.minX + d - (islandLeft ? 0 : near))
                        .padding(.trailing, W - pic.maxX + d)
                        .padding(.bottom, H - pic.maxY + d - near)
                }
                if landscape {
                    // shutter right-middle (Camera app), Cancel under it, info bottom right
                    shutter.position(x: W - right - 24 - 33, y: H / 2)
                    cancel.position(x: W - right - 24 - 33, y: H / 2 + 72)
                    info.position(x: W - right - 24 - 33, y: H - 40)
                } else {
                    // shutter bottom-middle, Cancel to its left, info under
                    shutter.position(x: W / 2, y: H - 28 - 33 - 24)
                    cancel.position(x: W / 2 + 90, y: H - 28 - 33 - 24)   // RIGHT of the shutter since 17 Nov (Roman): the left is the picture box's   // left of the shutter (Roman), a plain word — short enough to stay clear of 1x
                    info.position(x: W / 2, y: H - 28)
                }
            }
        }
    }

    /// The label every pill button wears: the EV's size and face.
    private static func pillLabel(_ text: String) -> some View {
        Text(text).monospacedDigit().font(.footnote)
            .padding(.horizontal, 10).padding(.vertical, 6)
    }

    /// How far a corner button sits from each of its two edges of the picture.
    private static let cornerGap: CGFloat = 12

    /// The RATIO list, as the web's menu: one tap chooses and closes.
    /// IT OPENS RIGHT UNDER THE BUTTON AND ENDS ABOVE THE BOTTOM OF THE SCREEN (Roman,
    /// 11 Nov: sideways it opened lower down and was cut off). Its rows are as tall as
    /// usual when there is room, and closer together when the screen is short.
    @ViewBuilder
    private func ratioMenu(pic: CGRect) -> some View {
        GeometryReader { g in
            let menuTop = pic.minY + Self.cornerGap + 28 + 4      // the button is about 28 high
            let room = g.size.height - menuTop - 10
            let rowH = max(22, min(38, room / CGFloat(max(1, ratios.count))))
            let h = rowH * CGFloat(ratios.count)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(ratios) { r in
                    Button(action: { ratioKey = r.key; onRatio(r.key); showRatios = false }) {
                        Text(r.label)
                            .font(.system(size: rowH < 30 ? 13 : 15, weight: r.key == ratioKey ? .bold : .regular, design: .monospaced))
                            .foregroundStyle(r.key == ratioKey ? Color(red: 0.84, green: 0.15, blue: 0.20) : .white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .frame(height: rowH)
                    }
                }
            }
            .frame(width: 150)
            .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.25), lineWidth: 1))
            .position(x: pic.minX + Self.cornerGap + 75, y: menuTop + h / 2)
        }
    }
}

/// THE PICTURE BOX OF A SERIES (17 Nov). IT HAS THE PHOTO'S OWN SHAPE (Roman: "that black
/// looks funny … if it could be in the ratio we shoot it, that would be the best"). No
/// black bars: the long side is always 88, the other follows the photo. A photo that lies
/// (or a square one) has the names of its shots ABOVE it, left to right; a photo that
/// stands has them at its RIGHT side, coming from the bottom upwards. The photo fills the
/// grey shape from edge to edge; the names stand on the grey.
struct SeriesBox: View {
    let photo: UIImage?
    let names: [String]
    let flash: Bool
    let fill: Color
    /// How many shots a series takes (4): beside a standing photo there is one place
    /// for each, spread over the photo's height — so one sees that after four it is full.
    var slots: Int = 4
    let onTap: () -> Void

    private static let long: CGFloat = 88
    private static let nameFont = Font.system(size: 11, weight: .semibold, design: .monospaced)

    private var stands: Bool {
        guard let p = photo else { return false }
        return p.size.height > p.size.width * 1.02
    }
    private var boxSize: CGSize {
        let pw = max(1, photo?.size.width ?? 1), ph = max(1, photo?.size.height ?? 1)
        return stands ? CGSize(width: max(36, Self.long * pw / ph), height: Self.long)
                      : CGSize(width: Self.long, height: max(30, Self.long * ph / pw))
    }

    private var picture: some View {
        ZStack {
            if let photo { Image(uiImage: photo).resizable().scaledToFill() }
            if flash { Color.white }
        }
        .frame(width: boxSize.width, height: boxSize.height)
        .clipped()
    }

    var body: some View {
        Button(action: onTap) {
            Group {
                if stands {
                    HStack(alignment: .bottom, spacing: 0) {
                        picture
                        // FOUR PLACES, SPREAD EVENLY OVER THE HEIGHT (Roman, 17 Nov: "so that you
                        // understand that you can't shoot 6 versions"). The first shot's name
                        // takes the bottom place, the next the one above it; a place not yet
                        // taken stays empty.
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array((0..<max(slots, names.count)).reversed()), id: \.self) { i in
                                Text(i < names.count ? names[i] : " ")
                                    .font(Self.nameFont).lineLimit(1)
                                    .frame(maxHeight: .infinity)
                            }
                        }
                        .padding(.horizontal, 6)
                        .frame(height: boxSize.height)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        // FOUR PLACES ACROSS THE WIDTH TOO (Roman, 17 Nov: "so that you expect the
                        // fourth one to fill"): each name stands at the left of its own quarter,
                        // the first at the far left; a place not yet taken stays empty.
                        HStack(spacing: 0) {
                            ForEach(Array(0..<max(slots, names.count)), id: \.self) { i in
                                Text(i < names.count ? names[i] : " ")
                                    .font(Self.nameFont)
                                    .lineLimit(1).minimumScaleFactor(0.5)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .frame(width: boxSize.width - 10)
                        .padding(.horizontal, 5).padding(.top, 5).padding(.bottom, 4)
                        picture
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .background(fill)
        // THE PHOTO KEEPS ITS SQUARE CORNERS (Roman, 17 Nov: "now you're rounding up the photo
        // as well"). Only the grey that carries the names is round: its two top corners above
        // a lying photo, its one free top corner beside a standing one. The bottom is straight.
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: stands ? 0 : 10, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: 10))
    }
}

struct FrameLine: View {
    let frame: CGRect
    /// After the shutter: black all round the frame, and no line.
    var solid = false
    var body: some View {
        GeometryReader { g in
            let W = g.size.width, H = g.size.height
            let x = frame.minX, y = frame.minY, w = frame.width, h = frame.height
            let dim = Color.black.opacity(solid ? 1 : 0.45)
            ZStack {
                dim.frame(width: W, height: max(0, y)).position(x: W / 2, y: y / 2)
                dim.frame(width: W, height: max(0, H - y - h)).position(x: W / 2, y: y + h + (H - y - h) / 2)
                dim.frame(width: max(0, x), height: h).position(x: x / 2, y: frame.midY)
                dim.frame(width: max(0, W - x - w), height: h).position(x: x + w + (W - x - w) / 2, y: frame.midY)
                if !solid {
                    Rectangle().stroke(.white, lineWidth: 1.5).frame(width: w, height: h).position(x: frame.midX, y: frame.midY)
                }
            }
        }
        .allowsHitTesting(false)
    }
}
