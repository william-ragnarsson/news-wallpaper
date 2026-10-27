import SwiftUI

// A menu bar icon and the Customize window: the wallpaper is the app.
@main
struct NewsWallpaperApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra("News Wallpaper", systemImage: "newspaper") {
      Button("Customize…") { delegate.customize() }
        .keyboardShortcut(",")
      Button("Refresh now") { delegate.refresh() }
      Divider()
      Button("Quit") { NSApp.terminate(nil) }
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  private let renderer = Renderer()
  private var refreshing = false {
    didSet { customization.rendering = refreshing }
  }
  private var refreshAgain = false
  private var refreshSoon: Task<Void, Never>?
  private var window: NSWindow?
  private lazy var customization = Customization(server: page) { [weak self] in self?.scheduleRefresh() }

  // The page to render, read once so the desktop picture and the Customize
  // window use the same server. Override while developing, then relaunch:
  // `defaults write io.github.william-ragnarsson.news-wallpaper page http://localhost:4175/?chrome=0&hud=0`
  private let page = UserDefaults.standard.string(forKey: "page").flatMap(URL.init(string:))
    ?? URL(string: "http://localhost:4174/?chrome=0&hud=0")!

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Info.plist's LSUIElement does this for the .app; this covers `swift run`.
    NSApp.setActivationPolicy(.accessory)
    customization.screen = mainScreen
    // A new resolution or display: draw the picture again at the new size.
    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.screenChanged() }
    }
    refresh()
  }

  private func screenChanged() {
    customization.screen = mainScreen
    scheduleRefresh()
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
    let view = CustomizeView(model: customization) { [weak self] in self?.refresh() }
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

  func refresh() {
    // The screen with the menu bar.
    guard let screen = NSScreen.screens.first else { return }
    // Now instead of after the pause, when asked for.
    refreshSoon?.cancel()
    // A change during a render gets a render of its own after it.
    guard !refreshing else {
      refreshAgain = true
      return
    }
    refreshing = true
    Task {
      do {
        let png = try await renderer.render(page, for: screen)
        try Desktop.set(png, on: screen)
      } catch {
        NSLog("Refresh failed: \(error)")
      }
      refreshing = false
      if refreshAgain {
        refreshAgain = false
        refresh()
      }
    }
  }

  // After a saved change: a slider sends a few in a row, so wait for a pause.
  private func scheduleRefresh() {
    refreshSoon?.cancel()
    refreshSoon = Task {
      try? await Task.sleep(for: .seconds(1))
      if !Task.isCancelled { refresh() }
    }
  }
}
