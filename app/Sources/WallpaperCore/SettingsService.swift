import Foundation

// The one way to read and change the settings: the Customize window and
// wallpaper-dev both come here. The rules are public/settings.js, run in a
// ScriptHost, so they are the ones the dev server uses; this keeps the file
// (SettingsStore). Changes are saved one at a time, each on top of the last.
// It never fetches: what there is to pick from comes from the stored news.
@MainActor
public final class SettingsService {
  public let environment: Environment
  private let store: SettingsStore
  private let scripts: ScriptHost
  private var saving: Task<Void, Never>?

  public init(_ environment: Environment) {
    self.environment = environment
    store = environment.settings
    scripts = ScriptHost(environment, network: false)
  }

  // The settings, with the defaults for whatever the file does not have.
  public func get() async throws -> WallpaperSettings {
    try await call("rules.normalize(saved)")
  }

  // Saves `patch`, a JSON object with some of the settings, over the saved
  // ones, and returns the result. Throws without saving anything when a field
  // in it is unknown or invalid.
  public func update(_ patch: Data) async throws -> WallpaperSettings {
    let previous = saving
    let save = Task {
      await previous?.value
      let next: WallpaperSettings = try await call(
        "rules.apply(saved, JSON.parse(patch), new Date().toISOString())",
        ["patch": String(decoding: patch, as: UTF8.self)])
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
      try store.save(encoder.encode(next))
      return next
    }
    saving = Task { _ = await save.result }
    return try await save.value
  }

  // What saving `patch` would give, without saving it: settings to render
  // with once. Throws as update does.
  public func preview(_ patch: Data) async throws -> WallpaperSettings {
    try await call(
      "rules.apply(saved, JSON.parse(patch), new Date().toISOString())",
      ["patch": String(decoding: patch, as: UTF8.self)])
  }

  // What there is to pick from. Read with `news`, the stored news
  // (NewsStore's document), as the reader for anything that comes from it.
  public func options(news: Data?) async throws -> Options {
    try await call(
      "(host.useStoredNews(news ? JSON.parse(news) : { streams: {}, liveblogs: {} }), await rules.options(saved))",
      ["news": news.map { String(decoding: $0, as: UTF8.self) } ?? ""])
  }

  // `expression` with `host` (public/host.js), `rules` (public/settings.js),
  // `saved` (what the file holds, {} when it is not JSON) and `values` in
  // scope.
  private func call<T: Decodable>(_ expression: String, _ values: [String: String] = [:]) async throws -> T {
    // The imports inside the try too: WebKit reports an exception that
    // escapes only as "A JavaScript exception occurred".
    let body = """
      try {
        const host = await import('/host.js');
        const rules = await import('/settings.js');
        let saved = {};
        try { saved = JSON.parse(file); } catch {}
        return JSON.stringify({ value: \(expression) });
      } catch (error) {
        return JSON.stringify({ error: error.message ?? String(error) });
      }
      """
    // Read once the page is up (the first load takes a second), as close to
    // a save as can be.
    try await scripts.ready()
    let file = String(decoding: store.load(), as: UTF8.self)
    let answer = try await scripts.run(body, values.merging(["file": file]) { new, _ in new })
    guard let text = answer as? String else { throw SettingsError("The settings script returned nothing") }
    let reply = try JSONDecoder().decode(Reply<T>.self, from: Data(text.utf8))
    if let error = reply.error { throw SettingsError(error) }
    guard let value = reply.value else { throw SettingsError("The settings script returned nothing") }
    return value
  }

  private struct Reply<Value: Decodable>: Decodable {
    let value: Value?
    let error: String?
  }
}

// A change the rules turned down ("Invalid value for preset"), or a script
// that failed.
public struct SettingsError: Error, LocalizedError, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
  public var errorDescription: String? { message }
}
