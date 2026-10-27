import SwiftUI
import WallpaperCore

// A menu bar icon and the Customize window: the wallpaper is the app. How it
// is made:
//   Updater   when to redraw
//   Renderer  draws the page (public/) offscreen and takes a picture of it (WallpaperRender)
//   Bridge    serves the page, the sources (sources/) and their network (WallpaperCore)
//   Desktop   sets the picture
// Customize (CustomizeView and its panes) edits the settings through the dev
// server's API for now (Customization).
@main
struct NewsWallpaperApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra("News Wallpaper", systemImage: "newspaper") {
      Button("Customize…") { delegate.customize() }
        .keyboardShortcut(",")
      Button("Refresh now") { delegate.updater.refresh() }
      Divider()
      Button("Quit") { NSApp.terminate(nil) }
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  let updater = Updater()
  private var window: NSWindow?
  private lazy var customization = Customization(server: Self.server) { [weak self] in self?.updater.refreshSoon() }

  // Where Customize reads and saves the settings: the page when it comes from
  // a server, else the dev server.
  private static var server: URL {
    let page = Environment.app.page
    return ["http", "https"].contains(page.scheme) ? page : URL(string: "http://localhost:4174/?chrome=0&hud=0")!
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Info.plist's LSUIElement does this for the .app; this covers `swift run`.
    NSApp.setActivationPolicy(.accessory)
    updater.redrawing = { [weak self] in self?.customization.rendering = $0 }
    customization.screen = mainScreen
    // A new resolution or display: the preview takes the new size (Updater
    // draws the picture again).
    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { if let self { self.customization.screen = self.mainScreen } }
    }
    updater.start()
  }

  // The screen with the menu bar, which the picture is drawn for.
  private var mainScreen: CGSize {
    NSScreen.screens.first?.frame.size ?? CGSize(width: 1512, height: 982)
  }

  // Opening the app again (Finder, Spotlight, `open`) while it runs opens Customize.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    customize()
    return false
  }

  // Opens the Customize window, or brings it to the front.
  func customize() {
    let window = self.window ?? makeWindow()
    self.window = window
    NSApp.activate()
    window.makeKeyAndOrderFront(nil)
  }

  private func makeWindow() -> NSWindow {
    let view = CustomizeView(model: customization) { [weak self] in self?.updater.refresh() }
    let controller = NSHostingController(rootView: view)
    // The panes set the window's title, subtitle and toolbar.
    controller.sceneBridgingOptions = [.title, .toolbars]
    let window = NSWindow(contentViewController: controller)
    window.styleMask.insert(.fullSizeContentView)
    window.toolbarStyle = .unified
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.setContentSize(NSSize(width: 880, height: 760))
    window.center()
    return window
  }

  // Fresh settings and options each time the window comes forward.
  func windowDidBecomeKey(_ notification: Notification) {
    Task { await customization.load() }
  }

  // A closed window goes, with the preview's web page in it; the next
  // Customize… makes a new one.
  func windowWillClose(_ notification: Notification) {
    window = nil
  }
}
