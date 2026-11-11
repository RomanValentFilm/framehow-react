// THE BRIDGE (6 Nov 2026): one call from the web app, two answers.
//
//   window.Capacitor.Plugins.FramehowCamera.take({
//     ratios: [{ key, label, value }],   // the FH CAM list, values = long/short (CANVAS resolved)
//     ratioKey: '16:9',                  // the one in force
//     maxSide: 2400                      // long side of the photo handed back
//   })
//   1. event "preview"  { jpegBase64, width, height, ratioKey }   — the live frame, at the
//      shutter, ~100 ms; the camera screen is gone by then and the card shows it
//   2. the promise      { jpegBase64, width, height, hdrKept, ratioKey, msCapture, msProcess }
//      — the real photo, ~1 s later (Deep Fusion, 2400 px, HDR layer in it)
//   or the promise { cancelled: true }
//
// THE TWO-STEP LANDING (Roman, 6 Nov): the live frame fills the card at once, the
// real photo replaces it on the same version a second later. The camera session
// keeps running after the screen is closed until the real photo has arrived.

import Capacitor
import SwiftUI
import UIKit

@objc(FramehowCameraPlugin)
public class FramehowCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FramehowCameraPlugin"
    public let jsName = "FramehowCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private var host: UIViewController?
    private var model: CameraModel?
    /// THE FROZEN MOMENT IS ALWAYS THE SAME (Roman, 6 Nov): 90 ms flash + 300 ms frozen,
    /// counted from the shutter by the camera itself, whatever the page is doing. The
    /// screen goes when that time is up AND the page has its copy ready (close()).
    private var timeUp = false
    private var webReady = false
    private var webReadyCall: CAPPluginCall?

    @objc func take(_ call: CAPPluginCall) {
        let list = (call.getArray("ratios") as? [[String: Any]] ?? []).compactMap { d -> RatioChoice? in
            guard let key = d["key"] as? String, let label = d["label"] as? String else { return nil }
            let v = (d["value"] as? NSNumber).map { CGFloat(truncating: $0) } ?? 16.0 / 9.0
            let r = v > 0 ? max(v, 1 / v) : 4.0 / 3.0   // long / short, never below 1
            return RatioChoice(key: key, label: label, value: r)
        }
        let ratios = list.isEmpty ? [RatioChoice(key: "16:9", label: "16:9", value: 16.0 / 9.0)] : list
        let ratioKey = call.getString("ratioKey") ?? ratios[0].key
        let maxSide = CGFloat(call.getDouble("maxSide") ?? 2400)
        call.keepAlive = true

        DispatchQueue.main.async { [weak self] in
            guard let self, let top = self.bridge?.viewController else { call.reject("no view controller"); return }
            let cam = CameraModel()
            self.model = cam
            var keyInForce = ratioKey
            cam.onShutter = { [weak self] in
                self?.timeUp = false; self?.webReady = false
                // NO FREEZE (Roman, 11 Nov: "A feels better" — like the web camera, where the
                // shot leaves at once and it "feels super fast"). It was 390 ms: 90 of flash and
                // 300 with the shot standing still. Now only the flash; the screen goes the
                // moment the flash is over and the web has its copy in place, and the picture
                // travels from where it stood.
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(100)) { [weak self] in
                    self?.timeUp = true; self?.goIfBothReady()
                }
            }
            cam.onPreview = { [weak self] data, w, h in
                // the live frame: to the web at once; the screen stays, frozen on the shot,
                // until the fixed time is up and the web has drawn its copy (close())
                let f = cam.frameOnScreen
                self?.notifyListeners("preview", data: [
                    "jpegBase64": data.base64EncodedString(), "width": w, "height": h, "ratioKey": keyInForce,
                    "frame": ["x": f.minX, "y": f.minY, "w": f.width, "h": f.height],
                ])
            }
            cam.onPhoto = { [weak self] data, w, h, kept, msCapture, msProcess in
                self?.dismissScreen()
                cam.stop()
                self?.model = nil
                call.resolve([
                    "jpegBase64": data.base64EncodedString(),
                    "width": w, "height": h, "hdrKept": kept, "ratioKey": keyInForce,
                    "msCapture": msCapture, "msProcess": msProcess,
                ])
                self?.bridge?.releaseCall(call)
            }
            let screen = CameraScreen(
                cam: cam, ratios: ratios, ratioKey: ratioKey, maxSide: maxSide,
                onRatio: { key in keyInForce = key },
                onCancel: { [weak self] in
                    self?.dismissScreen()
                    cam.stop()
                    self?.model = nil
                    call.resolve(["cancelled": true])
                    self?.bridge?.releaseCall(call)
                })
            let vc = UIHostingController(rootView: screen)
            // OVER the web view, not instead of it (Roman, 6 Nov: a grey screen after the
            // shutter): with .fullScreen iOS stops drawing the covered page and shows grey
            // for a frame when it comes back; .overFullScreen keeps the page alive beneath.
            vc.modalPresentationStyle = .overFullScreen
            vc.view.backgroundColor = .black
            self.host = vc
            top.present(vc, animated: false)
        }
    }

    /// The web app has its copy in place beneath: the frozen screen can go once the
    /// fixed time is up. The call is answered the moment the screen is gone — the
    /// web starts its shrink on that answer, so both happen in the same instant.
    @objc func close(_ call: CAPPluginCall) {
        call.keepAlive = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            self.webReady = true
            self.webReadyCall = call
            self.goIfBothReady()
        }
    }

    private func goIfBothReady() {
        guard timeUp, webReady, let vc = host else { return }
        // HIDDEN NOW, TAKEN DOWN WHEN THE PHOTO IS DONE (Roman, 11 Nov: "no animation on
        // the first photo"; his log: after every shot the page stood still ~1.2 s, from
        // the instant the screen went until the real photo was ready). Taking the camera
        // screen down while the chip is still making the photo holds the app until the
        // chip is free — the page beneath cannot draw, and when the hold began a few ms
        // before the move, the move was never seen. So the screen only becomes invisible
        // here; it is taken down in onPhoto, when the chip has finished.
        vc.view.isHidden = true
        if let c = webReadyCall { webReadyCall = nil; c.resolve(); bridge?.releaseCall(c) }
        // never left there unseen: if no photo comes (a failed capture), it goes after 4 s
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self, weak vc] in
            guard let self, let vc, self.host === vc, vc.view.isHidden else { return }
            self.dismissScreen()
            self.model?.stop(); self.model = nil
        }
    }

    private func dismissScreen() {
        guard let vc = host else { return }
        host = nil
        vc.dismiss(animated: false)
        if let c = webReadyCall { webReadyCall = nil; c.resolve(); bridge?.releaseCall(c) }
    }
}
