import AppKit
import Observation

// Updates a copy Homebrew installed: `brew update`, then `brew upgrade
// wallpaper-headlines`, which builds the new version on this Mac, and then opens
// it in place of this one. Homebrew runs the app from its Cellar
// (<prefix>/Cellar/<formula>/<version>/…/WallpaperHeadlines.app) and removes that
// folder once a newer version is in, so the app quits and the new one opens
// from <prefix>/opt/<formula>/…, which always points at the newest.
@MainActor
@Observable
final class AppUpdate {
  enum State: Equatable {
    case idle
    case running
    case upToDate
    case failed(String)
  }

  private(set) var state = State.idle

  // Where this copy sits in Homebrew; nil for one built from the repository.
  struct Keg: Sendable {
    let prefix: URL  // /opt/homebrew
    let formula: String  // wallpaper-headlines
    let version: String  // 0.1.0
    let app: String  // the bundle's path inside its version's folder

    init?(bundle: String) {
      let parts = bundle.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
      guard let cellar = parts.lastIndex(of: "Cellar"), parts.count > cellar + 3 else { return nil }
      prefix = URL(filePath: parts[..<cellar].joined(separator: "/"), directoryHint: .isDirectory)
      formula = parts[cellar + 1]
      version = parts[cellar + 2]
      app = parts[(cellar + 3)...].joined(separator: "/")
    }

    var brew: URL { prefix.appending(path: "bin/brew") }
    var opt: URL { prefix.appending(path: "opt/\(formula)") }
    // The version opt points at: a new one after an upgrade.
    var installed: String? {
      (try? FileManager.default.destinationOfSymbolicLink(atPath: opt.path(percentEncoded: false)))
        .map { URL(filePath: $0).lastPathComponent }
    }
  }

  // Opened through opt (the formula's command does that) the path is a link:
  // its Cellar folder is where it really is.
  static let keg = Keg(bundle: Bundle.main.bundleURL.resolvingSymlinksInPath().path(percentEncoded: false))
  static let shared = AppUpdate()

  func run() {
    guard let keg = Self.keg, state != .running else { return }
    state = .running
    Task {
      do {
        try await Self.brew(keg, "update", "--quiet")
        try await Self.brew(keg, "upgrade", keg.formula)
        if let installed = keg.installed, installed != keg.version {
          relaunch(keg.opt.appending(path: keg.app))
        } else {
          state = .upToDate
        }
      } catch {
        state = .failed("\(error)")
      }
    }
  }

  // Opens the new version once this one is gone, then quits.
  private func relaunch(_ app: URL) {
    let reopen = Process()
    reopen.executableURL = URL(filePath: "/bin/sh")
    reopen.arguments = [
      "-c", "while /bin/kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done; /usr/bin/open \"$0\"",
      app.path(percentEncoded: false),
    ]
    do {
      try reopen.run()
      NSApp.terminate(nil)
    } catch {
      state = .failed("Updated, but could not reopen: \(error.localizedDescription). Quit and open the app again.")
    }
  }

  struct Failure: Error, CustomStringConvertible {
    let description: String
  }

  // Runs brew and waits for it; a failure carries the last lines it printed.
  // An app opened from Finder has none of the shell's PATH, so brew gets its
  // own and the system's.
  private nonisolated static func brew(_ keg: Keg, _ arguments: String...) async throws {
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
      DispatchQueue.global().async {
        let process = Process()
        process.executableURL = keg.brew
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "\(keg.prefix.path(percentEncoded: false))/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["HOMEBREW_NO_ENV_HINTS"] = "1"
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        do {
          try process.run()
        } catch {
          done.resume(throwing: Failure(description: "Could not run \(keg.brew.path(percentEncoded: false)): \(error.localizedDescription)"))
          return
        }
        let printed = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        if process.terminationStatus == 0 {
          done.resume()
        } else {
          let tail = printed.split(separator: "\n").suffix(3).joined(separator: "\n")
          done.resume(throwing: Failure(description: tail.isEmpty ? "brew \(arguments.joined(separator: " ")) failed." : tail))
        }
      }
    }
  }
}
