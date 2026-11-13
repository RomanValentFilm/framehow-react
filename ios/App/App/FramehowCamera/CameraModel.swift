// THE FRAMEHOW CAMERA (6 Nov 2026) — the 3 Nov test app (native/FramehowCamTest),
// lifted into the app shell. Same camera, same rules:
//   · the iPhone's own quality: Dual Wide, up to 24 MP, "quality" prioritisation
//     (Smart HDR / Deep Fusion), no tone changes, the HDR layer kept in the JPEG
//   · lens switching only by the 1x / 0.5x button, never by distance
//   · tap to focus and expose, slide up/down for EV
//   · the shutter: a dark flash, the live picture goes on at once, the crop and
//     the resize happen on the camera's thread
// What is new: the photo does not go to Photos; it is cropped to the chosen frame,
// resized to `maxSide` on its long side (2400), and handed to the plugin, which
// hands it to the web app — the one and only picture that lands on the card.

import AVFoundation
import Combine
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import SwiftUI

@MainActor
final class CameraModel: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    /// THE LIVE FRAME (6 Nov, Roman: the two-step landing). The camera hands every
    /// preview frame to `frames`; the newest one is kept. At the shutter it goes to
    /// the card at once, cropped like the photo, while the chip makes the real one.
    private let videoOutput = AVCaptureVideoDataOutput()
    private let frameQueue = DispatchQueue(label: "framehow.camera.frames")
    nonisolated(unsafe) private var latestFrame: CVPixelBuffer?
    @Published private(set) var device: AVCaptureDevice?
    var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    var devicePoint: ((CGPoint) -> CGPoint)?

    @Published var status = ""   // (nothing is said while the camera starts — Roman, 13 Nov)
    /// This device has the wide (0.5x) lens next to the main one. An iPad with one
    /// back camera has not: its button says 1x and stays 1x (Roman, 13 Nov).
    @Published var hasWide = false
    @Published var exposureBias: Float = 0 { didSet { applyExposure() } }
    @Published var lensName = ""
    /// The chosen frame, long side / short side (≥ 1); the photo is cropped to it.
    var frameRatio: CGFloat = 16.0 / 9.0
    /// The long side of the photo handed over (Roman: 2400).
    var maxSide: CGFloat = 2400
    @Published var flash = false
    /// THE SHOT, FROZEN ON SCREEN (6 Nov, Roman): from the shutter until the web app has
    /// drawn its own full-screen copy — then the shrink into the card starts from the same picture.
    @Published var frozen: UIImage?
    private var frozenPending: UIImage?
    /// Where the frame lies on screen (points), set by the screen at every layout —
    /// the web app starts its shrink-into-the-card from exactly there.
    var frameOnScreen: CGRect = .zero
    @Published var busy = 0
    @Published var photoSize = ""
    @Published var wide = false

    /// The finished photo: JPEG data, its size, whether the HDR layer is in it,
    /// and the two times — shutter→photo from the chip (ms), crop+resize+encode (ms).
    var onPhoto: ((Data, Int, Int, Bool, Int, Int) -> Void)?
    /// The live frame at the shutter: a small JPEG (long side 1200), same crop, at once.
    var onPreview: ((Data, Int, Int) -> Void)?
    /// The shutter was pressed (the plugin starts its fixed clock here).
    var onShutter: (() -> Void)?
    /// One drawing context for every photo (making one costs hundreds of ms).
    nonisolated static let ci = CIContext()
    nonisolated(unsafe) private var shutterAt = Date()

    func start() {
        // Nothing is said while the camera starts. If it has NOT started after three
        // seconds, something is wrong, and that is said (and tells us where to look).
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(3))
            if let s = self, s.status.isEmpty { s.status = "starting…" }
        }
        AVCaptureDevice.requestAccess(for: .video) { ok in
            Task { @MainActor in
                if ok { self.configure() } else { self.status = "no camera permission — Settings › Framehow › Camera" }
            }
        }
    }

    func stop() {
        let s = session
        DispatchQueue.global(qos: .userInitiated).async { if s.isRunning { s.stopRunning() } }
    }

    private func configure() {
        guard let cam = AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
                     ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            status = "no back camera found"; return
        }
        device = cam
        session.beginConfiguration()
        session.sessionPreset = .photo
        do {
            let input = try AVCaptureDeviceInput(device: cam)
            if session.canAddInput(input) { session.addInput(input) }
            if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            videoOutput.setSampleBufferDelegate(self, queue: frameQueue)
            if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
            photoOutput.maxPhotoQualityPrioritization = .quality
            if photoOutput.isResponsiveCaptureSupported { photoOutput.isResponsiveCaptureEnabled = true }
            if photoOutput.isFastCapturePrioritizationSupported { photoOutput.isFastCapturePrioritizationEnabled = true }
            let sizes = cam.activeFormat.supportedMaxPhotoDimensions
            let upTo24 = sizes.filter { Int($0.width) * Int($0.height) <= 24_500_000 }
            if let dims = upTo24.max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) ?? sizes.first {
                photoOutput.maxPhotoDimensions = dims
                photoSize = "\(dims.width)×\(dims.height)"
            }
            session.commitConfiguration()
            if cam.isVirtualDevice {
                oneX = cam.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 1
                try cam.lockForConfiguration()
                cam.setPrimaryConstituentDeviceSwitchingBehavior(.restricted, restrictedSwitchingBehaviorConditions: [.videoZoomChanged])
                cam.videoZoomFactor = oneX
                cam.unlockForConfiguration()
            }
            hasWide = cam.isVirtualDevice
            lensName = "1x"
            // FOCUS BY ITSELF (Roman, 6 Nov: "does it focus when pointed at something?"):
            // continuous autofocus and exposure are the camera's default; a tap locks
            // them on a point, and when the scene changes the camera goes back to
            // continuous — the Camera app's behaviour.
            try cam.lockForConfiguration()
            cam.isSubjectAreaChangeMonitoringEnabled = true
            if cam.isFocusModeSupported(.continuousAutoFocus) { cam.focusMode = .continuousAutoFocus }
            if cam.isExposureModeSupported(.continuousAutoExposure) { cam.exposureMode = .continuousAutoExposure }
            cam.unlockForConfiguration()
            NotificationCenter.default.addObserver(forName: .AVCaptureDeviceSubjectAreaDidChange, object: cam, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.backToContinuous() }
            }
        } catch {
            session.commitConfiguration()
            status = "camera setup failed: \(error.localizedDescription)"; return
        }
        let s = session
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
        status = "ready"
    }

    private func applyExposure() {
        guard let cam = device else { return }
        do {
            try cam.lockForConfiguration()
            let v = max(cam.minExposureTargetBias, min(cam.maxExposureTargetBias, exposureBias))
            cam.setExposureTargetBias(v)
            cam.unlockForConfiguration()
        } catch { status = "exposure: \(error.localizedDescription)" }
    }

    private func backToContinuous() {
        guard let cam = device else { return }
        do {
            try cam.lockForConfiguration()
            if cam.isFocusModeSupported(.continuousAutoFocus) { cam.focusMode = .continuousAutoFocus }
            if cam.isExposureModeSupported(.continuousAutoExposure) { cam.exposureMode = .continuousAutoExposure }
            cam.unlockForConfiguration()
        } catch {}
    }

    func focus(atPreviewPoint p: CGPoint) {
        guard let cam = device, let conv = devicePoint else { return }
        let dp = conv(p)
        do {
            try cam.lockForConfiguration()
            if cam.isFocusPointOfInterestSupported { cam.focusPointOfInterest = dp }
            if cam.isFocusModeSupported(.autoFocus) { cam.focusMode = .autoFocus }
            if cam.isExposurePointOfInterestSupported { cam.exposurePointOfInterest = dp }
            if cam.isExposureModeSupported(.autoExpose) { cam.exposureMode = .autoExpose }
            cam.unlockForConfiguration()
        } catch { status = "focus: \(error.localizedDescription)" }
    }

    /// The chip's zoom factor that means "1x" (on a Dual Wide device 1.0 is the 0.5x lens).
    private var oneX: CGFloat = 1
    /// What the user sees: 0.5 … 1 … 3, as the Camera app counts.
    @Published var zoomShown: CGFloat = 1
    func setLens(wide w: Bool) { setZoom(w && hasWide ? 0.5 : 1) }

    /// Zoom as the user counts it (0.5 = the wide lens, 1 = the main lens, up to 3 digital).
    /// THE LENS FOLLOWS THE ZOOM (Roman, 6 Nov: button AND two-finger spread): below 1x
    /// the wide lens, from 1x the main one — the only moments the camera may switch.
    func setZoom(_ shown: CGFloat) {
        guard let cam = device else { return }
        let z = max(hasWide ? 0.5 : 1, min(3, shown))
        do {
            try cam.lockForConfiguration()
            let factor: CGFloat
            if cam.isVirtualDevice { factor = max(1, min(cam.activeFormat.videoMaxZoomFactor, z * oneX)) }   // 0.5 → 1.0 (the wide lens), 1 → oneX
            else { factor = max(1, min(cam.activeFormat.videoMaxZoomFactor, max(1, z))) }
            cam.videoZoomFactor = factor
            cam.unlockForConfiguration()
            zoomShown = z
            wide = z < 1
            lensName = z < 1 ? "0.5x" : (z == 1 ? "1x" : String(format: "%.1fx", z))
        } catch { status = "lens: \(error.localizedDescription)" }
    }

    nonisolated(unsafe) private var pending: (CGFloat, CGFloat) = (16.0 / 9.0, 2400)

    func takePhoto() {
        pending = (frameRatio, maxSide)
        let settings: AVCapturePhotoSettings
        if photoOutput.availablePhotoCodecTypes.contains(.hevc) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
        } else {
            settings = AVCapturePhotoSettings()
        }
        // QUALITY = Deep Fusion kept (Roman, 6 Nov: "we keep deep fusion"): the detail in
        // dim light is worth the ~1.2 s the chip takes per shot (measured 6 Nov).
        settings.photoQualityPrioritization = .quality
        settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
        if let cam = device, cam.hasFlash { settings.flashMode = .auto }
        if let c = photoOutput.connection(with: .video), let coord = rotationCoordinator {
            let a = coord.videoRotationAngleForHorizonLevelCapture
            if c.isVideoRotationAngleSupported(a) { c.videoRotationAngle = a }
        }
        busy += 1
        shutterAt = Date()
        onShutter?()
        // THE FLASH FIRST (Roman, 6 Nov): black at once, 90 ms; the frozen shot appears as
        // the flash lifts, never under it.
        flash = true
        frozenPending = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(90))
            self.flash = false
            if let p = self.frozenPending { self.frozen = p; self.frozenPending = nil }
        }
        photoOutput.capturePhoto(with: settings, delegate: self)
        // THE LIVE FRAME GOES FIRST: rotated upright by the same angle the photo
        // gets, cropped by the same rule, small, no HDR — on the card in ~100 ms.
        let angle = rotationCoordinator?.videoRotationAngleForHorizonLevelCapture ?? 0
        let ratio = frameRatio
        let frame = latestFrame
        frameQueue.async { [weak self] in
            guard let frame else { return }
            var img = CIImage(cvPixelBuffer: frame)
            let exif: Int32 = angle == 90 ? 6 : angle == 180 ? 3 : angle == 270 ? 8 : 1
            img = img.oriented(forExifOrientation: exif)
            // THE SCREEN FREEZES AS IT IS (Roman, 6 Nov): the whole live picture, not the
            // crop — the mask and the frame line stay exactly where they were.
            let whole = Self.cropAndResize(img, gain: nil, ratio: 1, maxSide: 1600).image
            let frozenUI = Self.ci.createCGImage(whole, from: whole.extent).map { UIImage(cgImage: $0) }
            Task { @MainActor in
                guard let self else { return }
                if self.flash { self.frozenPending = frozenUI } else { self.frozen = frozenUI }
            }
            let r = Self.cropAndResize(img, gain: nil, ratio: ratio, maxSide: 1200)
            let opts: [CIImageRepresentationOption: Any] = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8]
            guard let data = Self.ci.jpegRepresentation(of: r.image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: opts) else { return }
            let w = Int(r.image.extent.width.rounded()), h = Int(r.image.extent.height.rounded())
            Task { @MainActor in self?.onPreview?(data, w, h) }
        }
    }
}

extension CameraModel: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
        // (the flash is shown by takePhoto itself, at the shutter — not here, which can come later)
    }

    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let err = error?.localizedDescription
        let (ratio, maxSide) = pending
        let t1 = Date()
        let msCapture = Int(t1.timeIntervalSince(shutterAt) * 1000)
        let result = Self.croppedAndResized(photo, ratio: ratio, maxSide: maxSide)
        let msProcess = Int(Date().timeIntervalSince(t1) * 1000)
        Task { @MainActor in
            self.busy = max(0, self.busy - 1)
            if let err { self.status = "capture failed: \(err)"; return }
            guard let data = result.data else { self.status = "no photo data"; return }
            self.onPhoto?(data, result.w, result.h, result.hdrKept, msCapture, msProcess)
        }
    }

    /// The frame (a centred band along the chip's short side — the frame's long side IS
    /// the chip's long side), the HDR layer cropped and scaled the same way, resized so
    /// the long side is `maxSide`. Used for the photo AND the live frame.
    nonisolated static func cropAndResize(_ input: CIImage, gain gainIn: CIImage?, ratio: CGFloat, maxSide: CGFloat) -> (image: CIImage, gain: CIImage?) {
        var image = input
        var gain = gainIn
        let w = image.extent.width, h = image.extent.height
        let long = max(w, h), short = min(w, h)
        if ratio > 4.0 / 3.0 + 0.001 {
            var band = min(short, (long / ratio).rounded())
            let k = gain.map { $0.extent.width / w } ?? 1
            if k < 1 { band = (band * k).rounded(.down) / k }
            let rect = w >= h ? CGRect(x: 0, y: ((h - band) / 2 * k).rounded(.down) / k, width: w, height: band)
                              : CGRect(x: ((w - band) / 2 * k).rounded(.down) / k, y: 0, width: band, height: h)
            image = image.cropped(to: rect.offsetBy(dx: image.extent.minX, dy: image.extent.minY))
            image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            if let g = gain {
                let gr = CGRect(x: rect.minX * k, y: rect.minY * k, width: rect.width * k, height: rect.height * k)
                let gc = g.cropped(to: gr.offsetBy(dx: g.extent.minX, dy: g.extent.minY))
                gain = gc.transformed(by: CGAffineTransform(translationX: -gc.extent.minX, y: -gc.extent.minY))
            }
        }
        let curLong = max(image.extent.width, image.extent.height)
        if curLong > maxSide {
            let sc = maxSide / curLong
            image = image.transformed(by: CGAffineTransform(scaleX: sc, y: sc))
            image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            if let g = gain {
                let gs = g.transformed(by: CGAffineTransform(scaleX: sc, y: sc))
                gain = gs.transformed(by: CGAffineTransform(translationX: -gs.extent.minX, y: -gs.extent.minY))
            }
        }
        return (image, gain)
    }

    nonisolated static func croppedAndResized(_ photo: AVCapturePhoto, ratio: CGFloat, maxSide: CGFloat) -> (data: Data?, w: Int, h: Int, hdrKept: Bool) {
        guard let file = photo.fileDataRepresentation(),
              let raw = CIImage(data: file, options: [.applyOrientationProperty: true]) else { return (nil, 0, 0, false) }
        var gainIn: CIImage? = nil
        if #available(iOS 18, *) {
            gainIn = CIImage(data: file, options: [.auxiliaryHDRGainMap: true, .applyOrientationProperty: true])
        }
        let r = cropAndResize(raw, gain: gainIn, ratio: ratio, maxSide: maxSide)
        let image = r.image, gain = r.gain
        let ctx = Self.ci
        let space = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()
        var opts: [CIImageRepresentationOption: Any] = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92]
        if #available(iOS 18, *), let g = gain { opts[.hdrGainMapImage] = g }
        guard let out = ctx.jpegRepresentation(of: image, colorSpace: space, options: opts) else { return (nil, 0, 0, false) }
        // (reading the file back to prove the layer survived cost a second decode of a
        // 2400 px picture on every shot — proven once on 3 Nov, not repeated here)
        return (out, Int(image.extent.width.rounded()), Int(image.extent.height.rounded()), gain != nil)
    }
}

extension CameraModel: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        latestFrame = CMSampleBufferGetImageBuffer(sampleBuffer)
    }
}
