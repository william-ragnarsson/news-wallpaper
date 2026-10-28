import AppKit
import NewsFeed
import NewsStore
import WallpaperCore
import WallpaperRender

// When the news is fetched and the wallpaper redrawn: every few minutes while
// someone can see it, right away on waking or unlocking, and on Update news
// (the menu, Customize), it fetches (NewsFeed) and then draws the stored news.
// A change of screens or a saved change only draws again: the store has all
// there is to pick from. Nothing is fetched while the Mac sleeps, its screens
// sleep or it is locked. A failed fetch still draws what is stored (the
// provider's before, after a switch whose fetch failed), and a failed redraw
// keeps the picture there is: old news beats none.
@MainActor
final class Updater {
  private let fetcher = Fetcher(.app)
  private let renderer = Renderer(.app)
  private var timer: Timer?
  private var soon: Task<Void, Never>?
  private var running = false {
    didSet { redrawing(running) }
  }
  private var again = false
  // Whether the next redraw fetches first.
  private var fetchFirst = false
  // When waking or unlocking last fetched: they come in a row, and one fetch
  // does for those within a minute of it.
  private var resumed: Date?
  // Told when a redraw starts and when it ends (Customize shows it).
  var redrawing: (Bool) -> Void = { _ in }
  // Told when a fetch stored news (Customize lists it and draws its preview
  // from it).
  var fetched: () -> Void = {}

  // Seconds between fetches, at least 60:
  // `defaults write io.github.william-ragnarsson.wallpaper-headlines interval 120`
  private var interval: TimeInterval {
    let seconds = UserDefaults.standard.double(forKey: "interval")
    return seconds > 0 ? max(60, seconds) : 300
  }

  func start() {
    let workspace = NSWorkspace.shared.notificationCenter
    let distributed = DistributedNotificationCenter.default()
    observe(workspace, NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification) { $0.pause() }
    observe(workspace, NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification) { $0.resume() }
    // Not documented, but what the system sends on locking and unlocking.
    observe(distributed, .init("com.apple.screenIsLocked")) { $0.pause() }
    observe(distributed, .init("com.apple.screenIsUnlocked")) { $0.resume() }
    observe(.default, NSApplication.didChangeScreenParametersNotification) { $0.refresh(fetching: false) }
    resume()
  }

  // Fetches and redraws now (or only redraws), or once more right after the
  // redraw that is running.
  func refresh(fetching: Bool = true) {
    // Now instead of after the pause, when asked for.
    soon?.cancel()
    fetchFirst = fetchFirst || fetching
    guard !running else { again = true; return }
    running = true
    Task {
      repeat {
        again = false
        let fetching = fetchFirst
        fetchFirst = false
        await redraw(fetching: fetching)
      } while again
      running = false
    }
  }

  // After a saved change, which only needs a redraw: a slider sends a few in a
  // row, so wait for a pause. Another provider than the stored news's is
  // fetched first.
  func refreshSoon() {
    soon?.cancel()
    soon = Task {
      try? await Task.sleep(for: .seconds(1))
      if !Task.isCancelled { refresh(fetching: otherProvider()) }
    }
  }

  // Whether the settings name another provider than the stored news's: the
  // store has only the one fetched.
  private func otherProvider() -> Bool {
    guard let stored = try? Environment.app.news.meta().provider else { return true }
    return settingsProvider() != stored
  }

  // The provider in the settings. Settings that name none are VRT NWS's.
  private func settingsProvider() -> String {
    let settings = try? JSONSerialization.jsonObject(with: Environment.app.settings.load()) as? [String: Any]
    return settings?["provider"] as? String ?? "vrt-nws"
  }

  private func redraw(fetching: Bool) async {
    if fetching {
      let provider = settingsProvider()
      do {
        let meta = try await fetcher.run()
        fetched()
        if !meta.ok { NSLog("Fetched, but kept from before: \(meta.errors.map(\.id).joined(separator: ", "))") }
      } catch {
        NSLog("Fetch failed: \(error)")
      }
      // A switch to another provider while it fetched (and back, which
      // otherProvider did not see) fetches that one next.
      if settingsProvider() != provider {
        fetchFirst = true
        again = true
      }
    }
    // The screen with the menu bar.
    guard let screen = NSScreen.screens.first else { return }
    do {
      // The page is read each time: `defaults write … page` takes effect
      // without a restart.
      let snapshot = try await renderer.render(RenderRequest(page: Environment.app.page, for: screen))
      _ = try DesktopOutput(screen: screen).put(snapshot)
    } catch {
      NSLog("Refresh failed: \(error)")
    }
  }

  private func pause() {
    timer?.invalidate()
    timer = nil
  }

  private func resume() {
    pause()
    let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.refresh() }
    }
    timer.tolerance = interval / 10
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
    let fetching = resumed.map { -$0.timeIntervalSinceNow >= 60 } ?? true
    if fetching { resumed = Date() }
    refresh(fetching: fetching)
  }

  private func observe(_ center: NotificationCenter, _ names: Notification.Name..., run action: @escaping @MainActor (Updater) -> Void) {
    for name in names {
      _ = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { if let self { action(self) } }
      }
    }
  }
}
