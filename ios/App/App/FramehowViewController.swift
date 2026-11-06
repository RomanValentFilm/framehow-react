// THE SHELL'S VIEW CONTROLLER (6 Nov 2026): the stock Capacitor one, plus the
// app's own plugins registered here — the documented place for plugins that
// live inside the app rather than in a package. Main.storyboard points at this
// class. The web app reaches the camera as window.Capacitor.Plugins.FramehowCamera.

import Capacitor
import UIKit

class FramehowViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FramehowCameraPlugin())
    }
}
