import AppKit
import NewsFeed
import NewsStore
import WallpaperCore
import WallpaperRender

// When the news is fetched and the wallpaper redrawn: every few minutes while
// someone can see it, right away on waking or unlocking, and when asked from
// the menu, it fetches (NewsFeed) and then draws the stored news. A change of
// screens or a saved change only draws again: the store has all there is to
// pick from, but a liveblog that started after the last fetch. Nothing is fetched while the Mac sleeps, its screens sleep or it
// is locked. A failed fetch still draws what is stored, and a failed redraw
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

  // Seconds between fetches, at least 60:
  // `defaults write io.github.william-ragnarsson.news-wallpaper interval 120`
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
  // row, so wait for a pause. A liveblog picked that is not stored yet is
  // fetched first.
  func refreshSoon() {
    soon?.cancel()
    soon = Task {
      try? await Task.sleep(for: .seconds(1))
      if !Task.isCancelled { refresh(fetching: missingLiveblog()) }
    }
  }

  // Whether a liveblog picked in the settings is not in the stored news.
  private func missingLiveblog() -> Bool {
    let settings = try? JSONSerialization.jsonObject(with: Environment.app.settings.load()) as? [String: Any]
    let picked = (settings?["liveblogs"] as? [Any] ?? []).map { "\($0)" }
    guard !picked.isEmpty else { return false }
    let stored = (try? Environment.app.news.liveblogs()) ?? []
    return picked.contains { !stored.contains($0) }
  }

  private func redraw(fetching: Bool) async {
    if fetching {
      do {
        let meta = try await fetcher.run()
        if !meta.ok { NSLog("Fetched, but kept from before: \(meta.errors.map(\.id).joined(separator: ", "))") }
      } catch {
        NSLog("Fetch failed: \(error)")
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
