import SwiftUI
import WallpaperCore

// A menu bar icon and the Customize window: the wallpaper is the app. How it
// is made:
//   Updater   when to fetch and when to redraw
//   Fetcher   fetches the news with the sources (sources/) into the store (NewsFeed, NewsStore)
//   Renderer  draws the page (public/) from the stored news offscreen and takes a picture of it (WallpaperRender)
//   Bridge    serves the page, the sources and their network (WallpaperCore)
//   DesktopOutput  sets the picture
// Customize (CustomizeView and its panes) edits the settings through
// SettingsService (WallpaperCore), in this process (Customization), and
// previews them with a Renderer of its own.
@main
struct WallpaperHeadlinesApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra("Wallpaper Headlines", systemImage: "newspaper") {
      Button("Customize…") { delegate.customize() }
        .keyboardShortcut(",")
      Button("Update news") { delegate.updater.refresh() }
      Divider()
      Button("Quit") { NSApp.terminate(nil) }
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  let updater = Updater()
  private var window: NSWindow?
  private lazy var customization = Customization(service: SettingsService(.app)) { [weak self] in self?.updater.refreshSoon() }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Info.plist's LSUIElement does this for the .app; this covers `swift run`.
    NSApp.setActivationPolicy(.accessory)
    updater.redrawing = { [weak self] in self?.customization.redrawing($0) }
    // New news: an open Customize lists it and draws its preview again.
    updater.fetched = { [weak self] in
      guard let self, window != nil else { return }
      Task { await self.customization.load() }
    }
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

  // A closed window goes, with the preview and the web view that drew it;
  // the next Customize… makes a new one.
  func windowWillClose(_ notification: Notification) {
    window = nil
    customization.closed()
  }
}
