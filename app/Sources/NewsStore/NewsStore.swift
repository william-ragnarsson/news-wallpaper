import Foundation
import WallpaperCore

// M1: the news fetched last (by NewsFeed's Fetcher, its one writer), for
// everything else to read. One JSON document in the environment's data
// folder, news.json, as public/harvest.js makes it:
//   {fetchedAt, ok, errors: [{id, message}], streams: {id: stream}, front, liveblogs: {id: liveblog}}
// and the one before it, news.prev.json. A commit writes a temp file and
// renames it over news.json, so a reader always gets one whole fetch. Only
// this file knows that layout.
public struct NewsStore: Sendable {
  public let folder: URL
  public var file: URL { folder.appending(path: "news.json") }
  var previous: URL { folder.appending(path: "news.prev.json") }

  public init(folder: URL) {
    self.folder = folder
  }

  // The stored document. Throws StoreError.empty before the first fetch.
  public func read() throws -> NewsSnapshot {
    let data: Data
    do {
      data = try Data(contentsOf: file)
    } catch CocoaError.fileReadNoSuchFile {
      throw StoreError.empty(folder)
    }
    return NewsSnapshot(data: data, meta: try StoreMeta(data))
  }

  // The ids of the liveblogs stored: those running at the fetch, and those
  // picked then.
  public func liveblogs() throws -> Set<String> {
    let document = try JSONSerialization.jsonObject(with: read().data) as? [String: Any]
    return Set((document?["liveblogs"] as? [String: Any] ?? [:]).keys)
  }

  // What read() would give, without the news.
  public func meta() throws -> StoreMeta {
    try read().meta
  }

  // Stores `document`, a fetch as harvest.js makes it, and keeps the one it
  // replaces as news.prev.json. For the fetcher only.
  @_spi(Writer)
  public func commit(_ document: Data) throws -> StoreMeta {
    let meta = try StoreMeta(document)
    let files = FileManager.default
    try files.createDirectory(at: folder, withIntermediateDirectories: true)
    let temp = folder.appending(path: ".news-\(UUID().uuidString).json")
    defer { try? files.removeItem(at: temp) }
    try document.write(to: temp)
    // The last fetch becomes news.prev.json by a link renamed into place, so
    // news.json is there all along.
    if files.fileExists(atPath: file.path(percentEncoded: false)) {
      let link = folder.appending(path: ".news-\(UUID().uuidString).prev.json")
      try files.linkItem(at: file, to: link)
      defer { try? files.removeItem(at: link) }
      try move(link, to: previous)
    }
    try move(temp, to: file)
    return meta
  }

  // rename(2): replaces `to` in one step.
  private func move(_ from: URL, to: URL) throws {
    let path = to.path(percentEncoded: false)
    guard rename(from.path(percentEncoded: false), path) == 0 else {
      throw CocoaError(.fileWriteUnknown, userInfo: [
        NSFilePathErrorKey: path,
        NSUnderlyingErrorKey: POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO),
      ])
    }
  }
}

// A stored fetch: the document as it is in the file, and what is in it.
public struct NewsSnapshot: Sendable {
  public let data: Data
  public let meta: StoreMeta
}

// What a fetch got: when, whether all of it loaded, what failed (kept from
// the fetch before, when that had it), how many streams and liveblogs, and
// how many items each stream has.
public struct StoreMeta: Codable, Sendable {
  public struct Failure: Codable, Sendable {
    // "streams.<id>" or "liveblogs.<id>": where it is (or would be) in the document.
    public let id: String
    public let message: String
  }

  public struct Counts: Codable, Sendable {
    public let streams: Int
    public let liveblogs: Int
    // By stream id: "binnenland", "liveblog-123".
    public let items: [String: Int]
  }

  public let fetchedAt: String
  public let ok: Bool
  public let errors: [Failure]
  public let counts: Counts

  // From a whole document; throws StoreError.invalid when it is not one.
  init(_ document: Data) throws {
    guard let object = try? JSONSerialization.jsonObject(with: document) as? [String: Any] else {
      throw StoreError.invalid("not a JSON object")
    }
    guard let fetchedAt = object["fetchedAt"] as? String else { throw StoreError.invalid("no fetchedAt") }
    guard let streams = object["streams"] as? [String: Any], streams["voorpagina"] != nil else {
      throw StoreError.invalid("no streams.voorpagina")
    }
    let errors = (object["errors"] as? [[String: Any]] ?? []).map {
      Failure(id: $0["id"] as? String ?? "?", message: $0["message"] as? String ?? "")
    }
    self.fetchedAt = fetchedAt
    self.ok = object["ok"] as? Bool ?? errors.isEmpty
    self.errors = errors
    counts = Counts(
      streams: streams.count,
      liveblogs: (object["liveblogs"] as? [String: Any])?.count ?? 0,
      items: streams.compactMapValues { (($0 as? [String: Any])?["items"] as? [Any])?.count })
  }
}

public enum StoreError: Error, LocalizedError, CustomStringConvertible {
  // No news stored yet in this folder.
  case empty(URL)
  // A document that is not a fetch.
  case invalid(String)

  public var description: String {
    switch self {
    case .empty(let folder): "No news stored in \(folder.path(percentEncoded: false)) yet: fetch first"
    case .invalid(let reason): "Not a news document: \(reason)"
    }
  }

  public var errorDescription: String? { description }
}

extension Environment {
  // The news, in the data folder.
  public var news: NewsStore { NewsStore(folder: data) }
}
