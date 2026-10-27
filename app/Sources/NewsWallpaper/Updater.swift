import AppKit

// When the wallpaper is redrawn: every few minutes while someone can see it,
// right away on waking, unlocking or a change of screens, and when asked from
// the menu. Nothing is fetched while the Mac sleeps, its screens sleep or it
// is locked. A failed redraw keeps the picture there is: old news beats none.
@MainActor
final class Updater {
  private let renderer = Renderer()
  private var timer: Timer?
  private var running = false
  private var again = false

  // Seconds between redraws, at least 60:
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
    observe(.default, NSApplication.didChangeScreenParametersNotification) { $0.refresh() }
    resume()
  }

  // Redraws now, or once more right after the redraw that is running.
  func refresh() {
    guard !running else { again = true; return }
    running = true
    Task {
      repeat {
        again = false
        await redraw()
      } while again
      running = false
    }
  }

  private func redraw() async {
    // The screen with the menu bar.
    guard let screen = NSScreen.screens.first else { return }
    do {
      let png = try await renderer.render(for: screen)
      try Desktop.set(png, on: screen)
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
    refresh()
  }

  private func observe(_ center: NotificationCenter, _ names: Notification.Name..., run action: @escaping @MainActor (Updater) -> Void) {
    for name in names {
      _ = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { if let self { action(self) } }
      }
    }
  }
}
