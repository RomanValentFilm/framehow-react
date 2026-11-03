import AVFoundation
import SwiftUI

/// The live picture. Fills its box; the box is 3:4 (the sensor's shape), so what is shown is the whole frame.
struct CameraPreview: UIViewRepresentable {
    @ObservedObject var cam: CameraModel

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        var coordinator: AVCaptureDevice.RotationCoordinator?
        var observation: NSKeyValueObservation?

        /// Keeps the live picture upright when the phone is turned (iOS 17+): the
        /// coordinator is tied to THIS layer, so its angles are right for it.
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
        v.previewLayer.videoGravity = .resizeAspect   // never crops: the view is given the chip's exact size
        return v
    }

    func updateUIView(_ v: PreviewView, context: Context) {
        if v.coordinator == nil, let d = cam.device {
            v.bind(d, cam)
            cam.devicePoint = { [weak v] p in v?.previewLayer.captureDevicePointConverted(fromLayerPoint: p) ?? CGPoint(x: 0.5, y: 0.5) }
        }
    }
}

/// THE RULE (Roman, 3 Nov): the frame's long side IS the chip's long side (full
/// resolution, never cropped); the screen only zooms so the whole frame is visible,
/// next to the controls. In the saved photo the frame is a centred band: full width
/// in landscape, full height in portrait.
struct FrameGeometry {
    let chip: CGRect     // where the whole 4:3 chip lies on screen (parts may be off screen)
    let frame: CGRect    // where the chosen frame lies on screen (always fully visible)

    init(ratio: CGFloat, landscape: Bool, free: CGRect) {
        let r = landscape ? ratio : 1 / ratio                     // frame width / height
        let w = min(free.width, free.height * r), h = w / r        // the largest frame in the free area
        let c = CGPoint(x: free.midX, y: free.midY)
        frame = CGRect(x: c.x - w / 2, y: c.y - h / 2, width: w, height: h)
        // the chip shares the frame's long side; its short side follows 4:3
        let cw = landscape ? w : h * 3 / 4
        let ch = landscape ? w * 3 / 4 : h
        chip = CGRect(x: c.x - cw / 2, y: c.y - ch / 2, width: cw, height: ch)
    }
}

struct ContentView: View {
    @StateObject private var cam = CameraModel()
    private let ratios: [(String, CGFloat)] = [("16:9", 16.0 / 9.0), ("2:1", 2.0), ("2.39:1", 2.39), ("4:3", 4.0 / 3.0)]
    @State private var ratioIndex = 0
    @State private var focusMark: CGPoint?          // the yellow square where the finger tapped
    @State private var dragStartEV: Float?          // exposure before a slide began
    @State private var sliding = false
    @State private var markGeneration = 0

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            // The frame uses the WHOLE screen; the controls float over it, as in FH CAM
            // on the web (Roman, 3 Nov: "zoom into it to use the maximum screen").
            let free = CGRect(origin: .zero, size: geo.size)
            let fg = FrameGeometry(ratio: ratios[ratioIndex].1, landscape: landscape, free: free)
            let _ = { cam.frameRatio = ratios[ratioIndex].1 }()
            // Tap: focus + exposure at that point. Slide up/down: exposure, as on the iPhone.
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
            ZStack {
                Color.black
                CameraPreview(cam: cam)
                    .frame(width: fg.chip.width, height: fg.chip.height)
                    .position(x: fg.chip.midX, y: fg.chip.midY)
                FrameLine(frame: fg.frame)
                Color.clear.contentShape(Rectangle()).gesture(touch)
                if let m = focusMark {
                    // the yellow square, and the sun beside it that rides up and down with the exposure
                    Rectangle().stroke(.yellow, lineWidth: 1.5).frame(width: 70, height: 70).position(m)
                        .allowsHitTesting(false)
                    Image(systemName: "sun.max.fill").foregroundStyle(.yellow).font(.system(size: 16))
                        .position(x: m.x + 50, y: m.y - CGFloat(cam.exposureBias) * 20)
                        .allowsHitTesting(false)
                }
                if cam.flash { Color.black.allowsHitTesting(false) }
                controls(landscape: landscape)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .background(.black)
        .foregroundStyle(.white)
        .onAppear { cam.start() }
    }

    /// The controls float over the picture. RATIO: top left, always. Shutter: bottom
    /// middle in portrait, right middle in landscape — as the Camera app (Roman, 3 Nov).
    @ViewBuilder
    private func controls(landscape: Bool) -> some View {
        let pill = Color.black.opacity(0.45)
        let shutter = Button(action: { cam.takePhoto() }) {
            Circle().fill(.white).frame(width: 66, height: 66)
                .overlay(Circle().stroke(.gray, lineWidth: 3).padding(4))
        }
        let ratioButton = Button(ratios[ratioIndex].0) { ratioIndex = (ratioIndex + 1) % ratios.count }
            .buttonStyle(.bordered).tint(.white).background(pill, in: Capsule())
        let ev = Button(action: { cam.exposureBias = 0 }) {
            Text("EV \(cam.exposureBias, specifier: "%+.1f")").monospacedDigit().font(.footnote)
                .padding(.horizontal, 10).padding(.vertical, 6)
        }
        .tint(.white).background(pill, in: Capsule())
        let lens = Button(cam.wide ? "0.5x" : "1x") { cam.setLens(wide: !cam.wide) }
            .buttonStyle(.bordered).tint(.white).background(pill, in: Capsule())
        let thumb = Group {
            if let t = cam.thumbnail {
                Image(uiImage: t).resizable().scaledToFill().frame(width: 54, height: 54).clipped()
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(.white, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
        let info = VStack(spacing: 2) {
            Text(cam.busy > 0 ? "\(cam.status) · processing \(cam.busy)…" : cam.status)
            if !cam.hdrNote.isEmpty { Text(cam.hdrNote) }
            if !cam.lastSaved.isEmpty { Text("last photo \(cam.lastSaved)") }
            Text("\(cam.lensName) · \(cam.photoSize)").foregroundStyle(.secondary)
        }
        .font(.caption2).multilineTextAlignment(.center)
        .padding(6).background(pill, in: RoundedRectangle(cornerRadius: 8))

        ZStack {
            VStack { HStack { ratioButton; Spacer(); ev }; Spacer() }
                .padding(.horizontal, 16).padding(.top, landscape ? 16 : 60)
            VStack { Spacer(); HStack { lens; thumb; Spacer(); } }
                .padding(.horizontal, 16).padding(.bottom, landscape ? 16 : 36)
            if landscape {
                HStack { Spacer(); shutter.padding(.trailing, 24) }
                VStack { Spacer(); HStack { Spacer(); info } }.padding(16)
            } else {
                VStack { Spacer(); shutter; info.padding(.top, 8) }.padding(.bottom, 28)
            }
        }
    }
}

/// The chosen frame, white, and the rest of the screen darkened. Drawn on the
/// screen only — the saved photo is the full chip.
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

#Preview {
    ContentView()
}
