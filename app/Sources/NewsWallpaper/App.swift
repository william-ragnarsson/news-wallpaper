import SwiftUI

// A menu bar icon and nothing else: the wallpaper is the app. How it is made:
//   Updater   when to redraw
//   Renderer  draws the page (public/) offscreen and takes a picture of it
//   Bridge    serves the page, the sources (sources/) and their network
//   Desktop   sets the picture
@main
struct NewsWallpaperApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra("News Wallpaper", systemImage: "newspaper") {
      Button("Refresh now") { delegate.updater.refresh() }
      Divider()
      Button("Quit") { NSApp.terminate(nil) }
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let updater = Updater()

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Info.plist's LSUIElement does this for the .app; this covers `swift run`.
    NSApp.setActivationPolicy(.accessory)
    updater.start()
  }
}
