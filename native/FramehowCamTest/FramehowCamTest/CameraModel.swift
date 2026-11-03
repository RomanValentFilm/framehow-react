// FRAMEHOW CAMERA TEST (3 Nov 2026). One question: does a third-party app get the
// iPhone's own picture quality (Smart HDR, Deep Fusion) when it asks for it?
// The web camera (getUserMedia) could not — photos came out darker and flatter
// (Roman, 23 Oct). This asks the camera for its best quality, shows a frame line
// over the live picture, has an exposure slider, and saves the photo to Photos.
// Compare the saved photo with one from the iPhone Camera app, same scene.

import AVFoundation
import Combine
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import Photos
import SwiftUI

@MainActor
final class CameraModel: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    @Published private(set) var device: AVCaptureDevice?
    /// Made by the preview once it has its layer (so preview and photo turn with the phone together).
    var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    /// Set by the preview: turns a point on the preview into a point on the chip (0…1).
    var devicePoint: ((CGPoint) -> CGPoint)?

    @Published var status = "starting…"
    @Published var lastSaved = ""
    @Published var exposureBias: Float = 0 { didSet { applyExposure() } }
    @Published var lensName = ""
    /// The chosen frame (width / height when the phone is landscape); the saved photo is cropped to it.
    var frameRatio: CGFloat = 16.0 / 9.0
    // DECIDED 3 Nov (Roman): no tone changes at all — no HDR fold-in, no midtone lift, no
    // contrast. The capture as it comes, with its HDR layer kept, is the Camera app's look.
    /// THE SHUTTER FEEL (Roman, 3 Nov: "the taking photo experience has to be the same"):
    /// a dark flash the moment the shot is taken, the live picture goes on at once, the
    /// processing happens behind, a thumbnail appears when it is done.
    @Published var flash = false
    @Published var thumbnail: UIImage?
    @Published var busy = 0              // photos still being processed
    @Published var hdrNote = ""          // "saved file: HDR layer kept" / "lost"
    @Published var heic = false          // save the cropped file as HEIC instead of JPEG (which does the PHOTOS APP push?)
    @Published var photoSize = ""

    func start() {
        AVCaptureDevice.requestAccess(for: .video) { ok in
            Task { @MainActor in
                if ok { self.configure() } else { self.status = "no camera permission — Settings › FramehowCamTest › Camera" }
            }
        }
    }

    private func configure() {
        // The "Dual Wide" camera = the 1x and the 0.5x lens together (24 MP on the
        // iPhone 15). It switches lenses by itself when the subject is close — Roman's
        // "super wide" picture (3 Nov) — so below it is told to switch ONLY when the
        // zoom changes, and the 1x / 0.5x button is the user's choice. Falls back to the 1x lens.
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
            // THE POINT OF THE TEST: ask for the best quality the phone can do.
            photoOutput.maxPhotoQualityPrioritization = .quality
            if photoOutput.isResponsiveCaptureSupported { photoOutput.isResponsiveCaptureEnabled = true }
            if photoOutput.isFastCapturePrioritizationSupported { photoOutput.isFastCapturePrioritizationEnabled = true }
            // The largest size up to 24 MP — the Camera app's default (the 1x lens also offers 48 MP; not needed).
            let sizes = cam.activeFormat.supportedMaxPhotoDimensions
            let upTo24 = sizes.filter { Int($0.width) * Int($0.height) <= 24_500_000 }
            if let dims = upTo24.max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) ?? sizes.first {
                photoOutput.maxPhotoDimensions = dims
                photoSize = "\(dims.width)×\(dims.height)"
            }
            session.commitConfiguration()
            // lens switching only by the zoom (the button), never by distance
            if cam.isVirtualDevice {
                oneX = cam.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 1
                try cam.lockForConfiguration()
                cam.setPrimaryConstituentDeviceSwitchingBehavior(.restricted, restrictedSwitchingBehaviorConditions: [.videoZoomChanged])
                cam.videoZoomFactor = oneX
                cam.unlockForConfiguration()
            }
            lensName = cam.isVirtualDevice ? "1x" : cam.localizedName
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

    /// Tap to focus and expose there, as the Camera app does (Roman, 3 Nov).
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

    /// 1x or 0.5x — the user's choice (Roman, 3 Nov: "we need the wide angle option").
    private var oneX: CGFloat = 1
    @Published var wide = false
    func setLens(wide w: Bool) {
        guard let cam = device, cam.isVirtualDevice else { return }
        do {
            try cam.lockForConfiguration()
            cam.videoZoomFactor = w ? 1 : oneX
            cam.unlockForConfiguration()
            wide = w
            lensName = w ? "0.5x" : "1x"
        } catch { status = "lens: \(error.localizedDescription)" }
    }

    /// The settings at the moment of the shutter, readable from the camera's own thread.
    nonisolated(unsafe) private var pending: (CGFloat, Bool) = (16.0 / 9.0, false)

    func takePhoto() {
        pending = (frameRatio, heic)
        let settings: AVCapturePhotoSettings
        if photoOutput.availablePhotoCodecTypes.contains(.hevc) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])   // HEIF, as the Camera app
        } else {
            settings = AVCapturePhotoSettings()
        }
        settings.photoQualityPrioritization = .quality       // Smart HDR / Deep Fusion where the phone has them
        settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
        if let cam = device, cam.hasFlash { settings.flashMode = .auto }
        if let c = photoOutput.connection(with: .video), let coord = rotationCoordinator {
            let a = coord.videoRotationAngleForHorizonLevelCapture
            if c.isVideoRotationAngleSupported(a) { c.videoRotationAngle = a }
        }
        busy += 1
        photoOutput.capturePhoto(with: settings, delegate: self)
    }
}

extension CameraModel: AVCapturePhotoCaptureDelegate {
    /// The moment the shot is taken: the dark flash (the system plays the shutter sound itself).
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
        Task { @MainActor in
            self.flash = true
            try? await Task.sleep(for: .milliseconds(90))
            self.flash = false
        }
    }

    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let err = error?.localizedDescription
        let (ratio, heic) = pending      // noted on the main thread when the shutter was pressed
        // THE CROP (Roman, 3 Nov): the frame's long side is the chip's long side, so the
        // frame is a centred band along the chip's short side — the same in any orientation.
        // Done here, on the camera's thread — the live picture never waits for it.
        let result = Self.cropped(photo, ratio: ratio, heic: heic)
        Task { @MainActor in
            self.busy = max(0, self.busy - 1)
            if let err { self.status = "capture failed: \(err)"; return }
            guard let data = result.data else { self.status = "no photo data"; return }
            self.hdrNote = result.note
            if let img = UIImage(data: data) { self.thumbnail = img }
            self.save(data)
        }
    }

    /// The frame, with the HDR layer kept (iOS 18+): picture and layer are cropped the same
    /// and written together into a JPEG — the PHOTOS APP, Safari 26+ and Framehow show the boost.
    /// 4:3 with nothing to do = the camera's own file.
    nonisolated static func cropped(_ photo: AVCapturePhoto, ratio: CGFloat, heic: Bool) -> (data: Data?, note: String) {
        guard let file = photo.fileDataRepresentation() else { return (nil, "") }
        if ratio <= 4.0 / 3.0 + 0.001 { return (file, "camera's own file") }
        // .applyOrientationProperty: the camera writes "turn me so" into the file; applied
        // first, so the crop and the saved picture are upright.
        guard var image = CIImage(data: file, options: [.applyOrientationProperty: true]) else { return (file, "could not read") }
        var gain: CIImage? = nil
        if #available(iOS 18, *) {
            gain = CIImage(data: file, options: [.auxiliaryHDRGainMap: true, .applyOrientationProperty: true])
        }
        let w = image.extent.width, h = image.extent.height
        let long = max(w, h), short = min(w, h)
        var band = min(short, (long / ratio).rounded())
        // the layer is smaller than the picture (usually half): cut both on the layer's grid,
        // so no row is left uncovered (3 Nov: the stripe at the bottom) and nothing is rescaled
        let k = gain.map { $0.extent.width / w } ?? 1
        if k < 1 { band = (band * k).rounded(.down) / k }
        let rect = w >= h ? CGRect(x: 0, y: ((h - band) / 2 * k).rounded(.down) / k, width: w, height: band)
                          : CGRect(x: ((w - band) / 2 * k).rounded(.down) / k, y: 0, width: band, height: h)
        image = image.cropped(to: rect.offsetBy(dx: image.extent.minX, dy: image.extent.minY))
        image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
        if let g = gain {
            let gr = CGRect(x: rect.minX * k, y: rect.minY * k, width: rect.width * k, height: rect.height * k)
            let gc = g.cropped(to: gr.offsetBy(dx: g.extent.minX, dy: g.extent.minY))
            // same origin as the picture, no rescaling (a rescale made it worse, 3 Nov)
            gain = gc.transformed(by: CGAffineTransform(translationX: -gc.extent.minX, y: -gc.extent.minY))
        }
        let ctx = CIContext()
        let space = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()
        var opts: [CIImageRepresentationOption: Any] = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92]
        if #available(iOS 18, *), let g = gain { opts[.hdrGainMapImage] = g }
        let out: Data?
        if heic { out = ctx.heifRepresentation(of: image, format: .RGBA8, colorSpace: space, options: opts) }
        else { out = ctx.jpegRepresentation(of: image, colorSpace: space, options: opts) }
        guard let out else { return (file, "could not write") }
        // did the layer survive? read the saved file back
        var kept = false
        if #available(iOS 18, *) { kept = (CIImage(data: out, options: [.expandToHDR: true])?.contentHeadroom ?? 1) > 1 }
        return (out, (heic ? "HEIC · " : "JPEG · ") + (kept ? "HDR layer kept" : "HDR layer LOST"))
    }

    private func save(_ data: Data) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { auth in
            guard auth == .authorized || auth == .limited else {
                Task { @MainActor in self.status = "no Photos permission — Settings › FramehowCamTest › Photos" }
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, error in
                Task { @MainActor in
                    if ok {
                        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
                        self.lastSaved = f.string(from: Date())
                        self.status = "saved to Photos (\(data.count / 1024) KB)"
                    } else {
                        self.status = "save failed: \(error?.localizedDescription ?? "?")"
                    }
                }
            }
        }
    }
}
