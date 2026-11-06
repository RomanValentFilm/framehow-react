// THE BRIDGE (6 Nov 2026): one call from the web app, one answer.
//
//   window.Capacitor.Plugins.FramehowCamera.take({
//     ratios: [{ key, label, value }],   // the FH CAM list, values = long/short (CANVAS resolved)
//     ratioKey: '16:9',                  // the one in force
//     maxSide: 2400                      // long side of the photo handed back
//   })
//   → { jpegBase64, width, height, hdrKept, ratioKey }   or   { cancelled: true }
//
// The screen is presented over the web view, full screen; the web app does not
// see it and goes on believing the camera is open (cameraSessionStart), so the
// turn rules for CAM hold exactly as with FH CAM.

import Capacitor
import SwiftUI
import UIKit

@objc(FramehowCameraPlugin)
public class FramehowCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FramehowCameraPlugin"
    public let jsName = "FramehowCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
    ]

    private var host: UIViewController?

    @objc func take(_ call: CAPPluginCall) {
        let list = (call.getArray("ratios") as? [[String: Any]] ?? []).compactMap { d -> RatioChoice? in
            guard let key = d["key"] as? String, let label = d["label"] as? String else { return nil }
            let v = (d["value"] as? NSNumber).map { CGFloat(truncating: $0) } ?? 16.0 / 9.0
            // long / short, never below 1 (a portrait project sends 9/16 → 16/9 held upright)
            let r = v > 0 ? max(v, 1 / v) : 4.0 / 3.0
            return RatioChoice(key: key, label: label, value: r)
        }
        let ratios = list.isEmpty ? [RatioChoice(key: "16:9", label: "16:9", value: 16.0 / 9.0)] : list
        let ratioKey = call.getString("ratioKey") ?? ratios[0].key
        let maxSide = CGFloat(call.getDouble("maxSide") ?? 2400)
        call.keepAlive = true

        DispatchQueue.main.async { [weak self] in
            guard let self, let top = self.bridge?.viewController else { call.reject("no view controller"); return }
            let screen = CameraScreen(
                ratios: ratios, ratioKey: ratioKey, maxSide: maxSide,
                onPhoto: { [weak self] data, w, h, kept, key in
                    self?.dismiss {
                        call.resolve([
                            "jpegBase64": data.base64EncodedString(),
                            "width": w, "height": h, "hdrKept": kept, "ratioKey": key,
                        ])
                        self?.bridge?.releaseCall(call)
                    }
                },
                onCancel: { [weak self] in
                    self?.dismiss {
                        call.resolve(["cancelled": true])
                        self?.bridge?.releaseCall(call)
                    }
                })
            let vc = UIHostingController(rootView: screen)
            vc.modalPresentationStyle = .fullScreen
            vc.view.backgroundColor = .black
            self.host = vc
            top.present(vc, animated: false)
        }
    }

    private func dismiss(_ then: @escaping () -> Void) {
        guard let vc = host else { then(); return }
        host = nil
        vc.dismiss(animated: false, completion: then)
    }
}
