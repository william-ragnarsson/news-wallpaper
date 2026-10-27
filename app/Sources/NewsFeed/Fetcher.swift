import Foundation
@_spi(Writer) import NewsStore
import WallpaperCore

// M2: fetches all the news there is to pick from and stores it (NewsStore),
// the store's one writer. The sources do the fetching, in a ScriptHost
// (public/harvest.js) with the Bridge's /net as their network. What fails is
// kept from the fetch before; when VRT's feed fails (or its front page, with
// none from before), nothing is stored and run() throws. Runs go one at a time.
@MainActor
public final class Fetcher {
  public let environment: Environment
  private var queue: Task<Void, Never>?

  public init(_ environment: Environment) {
    self.environment = environment
  }

  public func run() async throws -> StoreMeta {
    let previous = queue
    let run = Task {
      await previous?.value
      return try await fetch()
    }
    queue = Task { _ = await run.result }
    return try await run.value
  }

  private func fetch() async throws -> StoreMeta {
    let store = environment.news
    // A host per run: the sources keep what they loaded in memory, and serve
    // it again when the site fails, which would hide the failure here.
    let scripts = ScriptHost(environment)
    // The imports inside the try too: WebKit reports an exception that
    // escapes only as "A JavaScript exception occurred".
    let body = """
      try {
        await import('/host.js');  // the sources' network: /net
        const { normalize } = await import('/settings.js');
        const { harvest } = await import('/harvest.js');
        let saved = {}, previous = null;
        try { saved = JSON.parse(settings); } catch {}
        try { previous = JSON.parse(stored); } catch {}
        const news = await harvest({ liveblogs: normalize(saved).liveblogs, previous });
        return { news: JSON.stringify(news) };
      } catch (error) {
        return { error: error.message ?? String(error) };
      }
      """
    let stored = (try? store.read()).map { String(decoding: $0.data, as: UTF8.self) } ?? ""
    let settings = String(decoding: environment.settings.load(), as: UTF8.self)
    let answer = try await scripts.run(body, ["settings": settings, "stored": stored]) as? [String: Any]
    if let error = answer?["error"] as? String { throw FetchError(error) }
    guard let news = answer?["news"] as? String else { throw FetchError("The fetch script returned nothing") }
    return try store.commit(Data(news.utf8))
  }
}

// A fetch that stored nothing: VRT's feed or front page failed, or the script did.
public struct FetchError: Error, LocalizedError, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
  public var errorDescription: String? { message }
}
