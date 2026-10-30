import SwiftUI
import WallpaperCore

// A menu bar icon and the Customize window: the wallpaper is the app. How it
// is made:
//   Updater   when to fetch and when to redraw
//   Fetcher   fetches the news with the sources (sources/) into the store (NewsFeed, NewsStore)
//   Renderer  draws the page (public/) from the stored news offscreen and takes a picture of it (WallpaperRender)
//   Bridge    serves the page, the sources and their network (WallpaperCore)
//   DesktopOutput  sets the picture
//   ArticlesMenu   the menu's Articles: the stories on the picture, to open
// Customize (CustomizeView and its panes) edits the settings through
// SettingsService (WallpaperCore), in this process (Customization), and
// previews them with a Renderer of its own.
@main
struct WallpaperHeadlinesApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra("Wallpaper Headlines", systemImage: "newspaper") {
      ArticlesMenu(onScreen: delegate.onScreen)
      Divider()
      Button("Customize…") { delegate.customize() }
        .keyboardShortcut(",")
      Button("Update news") { delegate.updater.refresh() }
      Divider()
      Button("Settings…") { delegate.customize(.settings) }
      Button("Quit") { NSApp.terminate(nil) }
    }
    // The menus in the menu bar while Customize is open (the app is a regular
    // one then): a menu bar app's have no Settings… and no Close.
    .commands {
      CommandGroup(replacing: .appSettings) {
        Button("Customize…") { delegate.customize() }
          .keyboardShortcut(",")
        Button("Settings…") { delegate.customize(.settings) }
      }
      CommandGroup(before: .windowSize) {
        Button("Close") { NSApp.keyWindow?.performClose(nil) }
          .keyboardShortcut("w")
      }
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  let updater = Updater()
  let onScreen = OnScreen()
  private var window: NSWindow?
  private lazy var customization = Customization(service: SettingsService(.app)) { [weak self] in self?.updater.refreshSoon() }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Info.plist's LSUIElement does this for the .app; this covers `swift run`.
    NSApp.setActivationPolicy(.accessory)
    updater.redrawing = { [weak self] in self?.customization.redrawing($0) }
    updater.drawn = { [weak self] in self?.onScreen.stories = $0 }
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

  // Closing Customize leaves the app running in the menu bar.
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  // Opens the Customize window, or brings it to the front; on `pane` if one
  // is given, else on the pane it shows.
  func customize(_ pane: Pane? = nil) {
    let window = self.window ?? makeWindow()
    self.window = window
    if let pane, let controller = window.contentViewController as? NSHostingController<CustomizeView> {
      controller.rootView.sidebar.pane = pane
    }
    // While the window is open the app is a regular one, in the Dock and in
    // Cmd+Tab; windowWillClose puts it back in the menu bar only.
    NSApp.setActivationPolicy(.regular)
    // Since macOS 14 NSApp.activate() only asks, and for a menu bar app the
    // answer is no: the window opened behind the app in front. The older
    // call, which Apple means to deprecate, still brings it forward.
    NSApp.activate(ignoringOtherApps: true)
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
  // the next Customize… makes a new one. The app leaves the Dock and Cmd+Tab.
  func windowWillClose(_ notification: Notification) {
    window = nil
    customization.closed()
    NSApp.setActivationPolicy(.accessory)
  }
}
