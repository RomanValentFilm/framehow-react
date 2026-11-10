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

    init(ratio: CGFloat, landscape: Bool, free: CGRect) {
        let r = landscape ? ratio : 1 / ratio
        let w = min(free.width, free.height * r), h = w / r
        let c = CGPoint(x: free.midX, y: free.midY)
        frame = CGRect(x: c.x - w / 2, y: c.y - h / 2, width: w, height: h)
        let cw = landscape ? w : h * 3 / 4
        let ch = landscape ? w * 3 / 4 : h
        chip = CGRect(x: c.x - cw / 2, y: c.y - ch / 2, width: cw, height: ch)
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
            // THE DYNAMIC ISLAND (Roman, 10 Nov). Sideways, the island sits on one short
            // side of the screen — and the shutter sat half under it. The camera now
            // starts where the island ends: on the island's side the picture, the frame
            // line and every button keep clear of it; the strip beside the island stays
            // black. The other side keeps its full width. Upright nothing changes, and an
            // iPad has no island (its side insets are zero).
            let island = landscape ? Self.islandInsets() : (left: CGFloat(0), right: CGFloat(0))
            let free = CGRect(x: island.left, y: 0, width: geo.size.width - island.left - island.right, height: geo.size.height)
            let fg = FrameGeometry(ratio: current.value, landscape: landscape, free: free)
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
                FrameLine(frame: fg.frame)
                Color.clear.contentShape(Rectangle()).gesture(touch).simultaneousGesture(pinch)
                if let m = focusMark {
                    Rectangle().stroke(.yellow, lineWidth: 1.5).frame(width: 70, height: 70).position(m)
                        .allowsHitTesting(false)
                    Image(systemName: "sun.max.fill").foregroundStyle(.yellow).font(.system(size: 16))
                        .position(x: m.x + 50, y: m.y - CGFloat(cam.exposureBias) * 20)
                        .allowsHitTesting(false)
                }
                if cam.flash { Color.black.allowsHitTesting(false) }
                controls(landscape: landscape, left: island.left, right: island.right)
                if showRatios { ratioMenu(landscape: landscape, left: island.left) }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .background(.black)
        .foregroundStyle(.white)
        .onAppear { cam.start() }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            // a moment later: the window's own orientation follows the device's
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { turns += 1 }
        }
    }

    /// How far the Dynamic Island reaches in from the left and from the right, sideways.
    /// The system reports the same inset on both short sides; only the side the island is
    /// really on is kept. `landscapeRight` = the device's top (the island) is on the LEFT.
    private static func islandInsets() -> (left: CGFloat, right: CGFloat) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else { return (0, 0) }
        let i = window.safeAreaInsets
        switch scene.interfaceOrientation {
        case .landscapeRight: return (i.left, 0)
        case .landscapeLeft: return (0, i.right)
        default: return (0, 0)
        }
    }

    @ViewBuilder
    private func controls(landscape: Bool, left: CGFloat, right: CGFloat) -> some View {
        let pill = Color.black.opacity(0.45)
        let shutter = Button(action: { if cam.busy == 0 { cam.takePhoto() } }) {
            Circle().fill(.white).frame(width: 66, height: 66)
                .overlay(Circle().stroke(.gray, lineWidth: 3).padding(4))
        }
        let ratioButton = Button("RATIO") { showRatios.toggle() }
            .buttonStyle(.bordered).tint(.white).background(pill, in: Capsule())
        let ev = Button(action: { cam.exposureBias = 0 }) {
            Text("EV \(cam.exposureBias, specifier: "%+.1f")").monospacedDigit().font(.footnote)
                .padding(.horizontal, 10).padding(.vertical, 6)
        }
        .tint(.white).background(pill, in: Capsule())
        let lens = Button(cam.lensName.isEmpty ? "1x" : cam.lensName) { cam.setLens(wide: !cam.wide) }
            .buttonStyle(.bordered).tint(.white).background(pill, in: Capsule())
        // CANCEL left of the shutter (Roman, 6 Nov: the top right is the EV's place) — the
        // way out without a photo, where the thumb already is.
        let cancel = Button("Cancel") { onCancel() }
            .font(.system(size: 12)).tint(.white).opacity(0.85)
            .padding(8)   // a plain word, no pill (Roman, 6 Nov); touch area stays finger-sized
        let info = Text(cam.busy > 0 ? "processing…" : (cam.status == "ready" ? "" : cam.status))
            .font(.caption2).padding(6).background(pill, in: RoundedRectangle(cornerRadius: 8))
            .opacity(cam.busy > 0 || cam.status != "ready" ? 1 : 0)

        GeometryReader { g in
            let W = g.size.width, H = g.size.height
            ZStack {
                VStack { HStack { ratioButton; Spacer(); ev }; Spacer() }
                    .padding(.leading, 16 + left).padding(.trailing, 16 + right).padding(.top, landscape ? 16 : 60)
                VStack { Spacer(); HStack { lens; Spacer() } }
                    .padding(.leading, 16 + left).padding(.trailing, 16 + right).padding(.bottom, landscape ? 16 : 24)   // portrait: a row below Cancel
                if landscape {
                    // shutter right-middle (Camera app), Cancel under it, info bottom right
                    shutter.position(x: W - right - 24 - 33, y: H / 2)
                    cancel.position(x: W - right - 24 - 33, y: H / 2 + 72)
                    info.position(x: W - right - 24 - 33, y: H - 40)
                } else {
                    // shutter bottom-middle, Cancel to its left, info under
                    shutter.position(x: W / 2, y: H - 28 - 33 - 24)
                    cancel.position(x: W / 2 - 72, y: H - 28 - 33 - 24)   // left of the shutter (Roman), a plain word — short enough to stay clear of 1x
                    info.position(x: W / 2, y: H - 28)
                }
            }
        }
    }

    /// The RATIO list, as the web's menu: one tap chooses and closes.
    @ViewBuilder
    private func ratioMenu(landscape: Bool, left: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(ratios) { r in
                Button(action: { ratioKey = r.key; onRatio(r.key); showRatios = false }) {
                    Text(r.label)
                        .font(.system(size: 15, weight: r.key == ratioKey ? .bold : .regular, design: .monospaced))
                        .foregroundStyle(r.key == ratioKey ? Color(red: 0.84, green: 0.15, blue: 0.20) : .white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 9).padding(.horizontal, 14)
                }
            }
        }
        .frame(width: 150)
        .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.25), lineWidth: 1))
        .position(x: left + 16 + 75, y: (landscape ? 16 : 60) + 44 + CGFloat(ratios.count) * 19)
    }
}

struct FrameLine: View {
    let frame: CGRect
    var body: some View {
        GeometryReader { g in
            let W = g.size.width, H = g.size.height
            let x = frame.minX, y = frame.minY, w = frame.width, h = frame.height
            ZStack {
                Color.black.opacity(0.45).frame(width: W, height: max(0, y)).position(x: W / 2, y: y / 2)
                Color.black.opacity(0.45).frame(width: W, height: max(0, H - y - h)).position(x: W / 2, y: y + h + (H - y - h) / 2)
                Color.black.opacity(0.45).frame(width: max(0, x), height: h).position(x: x / 2, y: frame.midY)
                Color.black.opacity(0.45).frame(width: max(0, W - x - w), height: h).position(x: x + w + (W - x - w) / 2, y: frame.midY)
                Rectangle().stroke(.white, lineWidth: 1.5).frame(width: w, height: h).position(x: frame.midX, y: frame.midY)
            }
        }
        .allowsHitTesting(false)
    }
}
