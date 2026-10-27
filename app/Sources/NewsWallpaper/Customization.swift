import Foundation
import Observation

// What the wallpaper shows, as the news server keeps it (settings.mjs).
struct WallpaperSettings: Codable, Equatable, Sendable {
  var preset: String
  var provider: String
  var liveblogs: [String]
  var otherLiveblogs: Bool
  var sections: [String]
  var margin: Int
  var updatedAt: String?
}

// What there is to pick from: /api/settings/options.
struct Options: Decodable, Sendable {
  struct Design: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String
    let data: String?
    let sections: Bool?
    let live: Bool?  // lists the other running liveblogs
    let margin: Bool?
  }

  // A news outlet the front page can come from, with its section feeds.
  struct Provider: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let owner: String
    let language: String
    let homepage: URL
    let description: String?
    let sections: [Section]
  }

  struct Section: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let group: String
  }

  struct Liveblog: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let section: String?
    let live: Bool?
    let postCount: Int?
  }

  let presets: [Design]
  let providers: [Provider]
  let liveblogs: [Liveblog]
  let maxLiveblogs: Int
  let maxMargin: Int
}

// Loads the settings into the Customize window and saves every change at
// once, one save at a time; a change made during a save goes out after it,
// or is dropped with it when that save fails.
// `saved` runs each time the server takes a change, to render the wallpaper.
@MainActor
@Observable
final class Customization {
  private(set) var settings: WallpaperSettings?  // what the window shows: saved, plus a change on its way
  private(set) var options: Options?
  private(set) var loadError: String?
  private(set) var saveError: String?
  private(set) var saving = false
  var rendering = false  // the app is redrawing the desktop picture
  // The screen with the menu bar, which the desktop picture is drawn for.
  var screen = CGSize(width: 1512, height: 982)

  let server: URL  // the page the wallpaper renders, on the news server
  private let saved: () -> Void
  private var unsaved = false
  private var edits = 0  // changes made so far, to tell whether one came during a load
  private var confirmed: WallpaperSettings?  // what the server last said it has
  private var failures = 0  // saves that failed, to tell whether one failed during a load

  init(server: URL, saved: @escaping () -> Void) {
    self.server = server
    self.saved = saved
  }

  // Where the settings come from, for the error when nothing answers.
  var address: String {
    [server.host, server.port.map(String.init)].compactMap { $0 }.joined(separator: ":")
  }

  // Again each time the window comes forward: liveblogs start and end, and the
  // web Customize page changes the settings too. A load also clears the last
  // failed save's message, except the one that follows that save and one
  // begun before it.
  func load(keepingSaveError: Bool = false) async {
    guard !saving, !unsaved else { return }
    let start = edits, failed = failures
    do {
      // Options first: it waits on the provider, and the settings should be
      // as fresh as they can be.
      options = try await Self.send(URLRequest(url: url("/api/settings/options")))
      let settings: WallpaperSettings = try await Self.send(URLRequest(url: url("/api/settings")))
      take(settings, since: start)
      loadError = nil
      if !keepingSaveError, failures == failed { saveError = nil }
    } catch {
      loadError = error.localizedDescription
    }
  }

  // Whether the server still answers, and what it has: the settings alone,
  // which come back at once. Until a load has worked, a load: the panes need
  // the options too.
  func check() async {
    guard options != nil else { return await load() }
    let start = edits
    do {
      take(try await Self.send(URLRequest(url: url("/api/settings"))), since: start)
      loadError = nil
    } catch {
      loadError = error.localizedDescription
    }
  }

  // Settings fetched from the server, unless a change was made since the
  // fetch began: that change is newer.
  private func take(_ settings: WallpaperSettings, since start: Int) {
    guard edits == start, !saving, !unsaved else { return }
    self.settings = settings
    confirmed = settings
  }

  func change(_ edit: (inout WallpaperSettings) -> Void) {
    guard var next = settings else { return }
    edit(&next)
    guard next != settings else { return }
    settings = next
    unsaved = true
    edits += 1
    Task { await save() }
  }

  private func save() async {
    guard !saving, unsaved, let sent = settings else { return }
    unsaved = false
    let patch = Patch(sent, since: confirmed)
    guard !patch.isEmpty else { return }  // changed and changed back
    saving = true
    var request = URLRequest(url: url("/api/settings"))
    request.httpMethod = "PATCH"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try? JSONEncoder().encode(patch)
    do {
      let answer: WallpaperSettings = try await Self.send(request)
      confirmed = answer
      // A change made during the save goes on top of what the server has now,
      // so the next save sends that change alone and not the rest of what the
      // window had: the web Customize page may have changed that meanwhile.
      if unsaved, let current = settings {
        settings = Patch(current, since: sent).applied(to: answer)
      } else {
        settings = answer
      }
      saveError = nil
      loadError = nil  // it answered
    } catch {
      // Back to what the server has; a change made meanwhile goes too. At
      // once, so a change made during the load below sends that change alone.
      saveError = error.localizedDescription
      failures += 1
      settings = confirmed
      unsaved = false
      saving = false
      await load(keepingSaveError: true)
      return
    }
    saving = false
    // The app waits for a pause before it renders, so a run of saves draws once.
    saved()
    if unsaved { await save() }
  }

  private func url(_ path: String) -> URL {
    URL(string: path, relativeTo: server)!.absoluteURL
  }

  private nonisolated static func send<T: Decodable>(_ request: URLRequest) async throws -> T {
    let (body, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? JSONDecoder().decode(ServerError.self, from: body))?.error
      throw ServerError(error: message ?? "HTTP \(status)")
    }
    return try JSONDecoder().decode(T.self, from: body)
  }
}

// What a PATCH sends: only the fields changed here since the server last
// answered, so a change made elsewhere meanwhile (the web Customize page)
// stays. Fields left nil are left out.
private struct Patch: Encodable {
  var preset: String?
  var provider: String?
  var liveblogs: [String]?
  var otherLiveblogs: Bool?
  var sections: [String]?
  var margin: Int?

  init(_ s: WallpaperSettings, since old: WallpaperSettings?) {
    if s.preset != old?.preset { preset = s.preset }
    if s.provider != old?.provider { provider = s.provider }
    if s.liveblogs != old?.liveblogs { liveblogs = s.liveblogs }
    if s.otherLiveblogs != old?.otherLiveblogs { otherLiveblogs = s.otherLiveblogs }
    if s.sections != old?.sections { sections = s.sections }
    if s.margin != old?.margin { margin = s.margin }
  }

  var isEmpty: Bool {
    preset == nil && provider == nil && liveblogs == nil && otherLiveblogs == nil && sections == nil && margin == nil
  }

  // These fields over the others, as the server does with a PATCH.
  func applied(to s: WallpaperSettings) -> WallpaperSettings {
    var s = s
    s.preset = preset ?? s.preset
    s.provider = provider ?? s.provider
    s.liveblogs = liveblogs ?? s.liveblogs
    s.otherLiveblogs = otherLiveblogs ?? s.otherLiveblogs
    s.sections = sections ?? s.sections
    s.margin = margin ?? s.margin
    return s
  }
}

private struct ServerError: Decodable, LocalizedError {
  let error: String
  var errorDescription: String? { error }
}
