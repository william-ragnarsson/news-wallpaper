import SwiftUI

// A menu bar icon and nothing else: the wallpaper is the app.
@main
struct NewsWallpaperApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra("News Wallpaper", systemImage: "newspaper") {
      Button("Refresh now") { delegate.refresh() }
      Divider()
      Button("Quit") { NSApp.terminate(nil) }
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let renderer = Renderer()
  private var refreshing = false

  // The page to render. Override while developing:
  // `defaults write io.github.william-ragnarsson.news-wallpaper page http://localhost:4175/?chrome=0&hud=0`
  private var page: URL {
    UserDefaults.standard.string(forKey: "page").flatMap(URL.init(string:))
      ?? URL(string: "http://localhost:4174/?chrome=0&hud=0")!
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Info.plist's LSUIElement does this for the .app; this covers `swift run`.
    NSApp.setActivationPolicy(.accessory)
    refresh()
  }

  func refresh() {
    // The screen with the menu bar.
    guard !refreshing, let screen = NSScreen.screens.first else { return }
    refreshing = true
    Task {
      defer { refreshing = false }
      do {
        let png = try await renderer.render(page, for: screen)
        try Desktop.set(png, on: screen)
      } catch {
        NSLog("Refresh failed: \(error)")
      }
    }
  }
}
