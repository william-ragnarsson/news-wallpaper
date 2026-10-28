import Foundation
import WebKit

// The app's host for the wallpaper page: answers wallpaper://app/ the way the
// dev server (server.mjs) answers http://localhost:4174/, so the page runs the
// same in both (public/host.js is the page's side):
//   /                public/
//   /sources/        sources/, which the page runs itself
//   /net?url=<url>   a GET to an outlet on the page's behalf: CORS keeps the
//                    page from fetching the outlets itself. Only in a Bridge with the
//                    network: the one that renders has none, so a picture
//                    can only show the stored news
//   /api/news        the stored news (NewsStore's document), from `news`
//   /api/settings    the settings (SettingsStore; read only, SettingsService
//                    writes), or settingsOverride while it is set
// Nothing here knows what is in the news: the page and its sources do.
@MainActor
public final class Bridge: NSObject, WKURLSchemeHandler {
  public nonisolated static let scheme = "wallpaper"
  public nonisolated static let home = URL(string: "wallpaper://app/")!
  // The wallpaper without the stand-in menu bar and Dock or the dev hint.
  // The news is the stored news (?data=store, see public/host.js).
  public nonisolated static let page = URL(string: "?chrome=0&hud=0&data=store", relativeTo: home)!.absoluteURL

  // The page's files (Environment.web) and its settings.
  private let root: URL
  private let settings: SettingsStore
  // Settings (JSON) served instead of the saved ones while set: the Renderer
  // sets them for one picture.
  public var settingsOverride: Data?
  // The stored news (JSON) for /api/news, set by whoever has a store to read
  // (WallpaperCore does not know it). nil, or a throw, is a 503 with
  // {error}, the reason, which the page shows as its error.
  public var news: (() throws -> Data)?
  // Whether /net reaches the outlets.
  private let network: Bool

  public init(_ environment: Environment, network: Bool = true) {
    root = environment.web
    settings = environment.settings
    self.network = network
  }

  // URL prefix → folder under root, the first match wins.
  private static let mounts = [("/sources/", "sources"), ("/", "public")]

  private static let types = [
    "html": "text/html; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "mjs": "text/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "woff2": "font/woff2",
  ]

  private let net = Net()
  // Requests the web view gave up on: answering one of those raises.
  private var stopped = Set<ObjectIdentifier>()

  public func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    switch url.path() {
    case "/net" where !network:
      NSLog("Refused /net in a Bridge without the network: \(url.query() ?? "")")
      respond(task, Reply(status: 403, type: "text/plain; charset=utf-8", body: Data("No network here: draw from the stored news".utf8)))
    case "/net":
      Task {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        let target = query?.first { $0.name == "url" }?.value.flatMap(URL.init(string:))
        let reply = await net.get(target, headers: task.request.allHTTPHeaderFields ?? [:])
        respond(task, reply)
      }
    case "/api/news":
      do {
        guard let news else { throw NoNews() }
        respond(task, Reply(status: 200, type: Self.types["json"]!, body: try news()))
      } catch {
        // {error}, as the dev server answers.
        let body = try? JSONSerialization.data(withJSONObject: ["error": "\(error)"])
        respond(task, Reply(status: 503, type: Self.types["json"]!, body: body ?? Data()))
      }
    case "/api/settings":
      respond(task, Reply(status: 200, type: Self.types["json"]!, body: settingsOverride ?? settings.load()))
    default:
      respond(task, file(at: url.path()))
    }
  }

  public func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
    stopped.insert(ObjectIdentifier(task))
  }

  private func respond(_ task: any WKURLSchemeTask, _ reply: Reply) {
    guard stopped.remove(ObjectIdentifier(task)) == nil, let url = task.request.url else { return }
    var headers = reply.headers
    headers["Content-Type"] = reply.type
    headers["Cache-Control"] = "no-store"
    let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!
    task.didReceive(response)
    task.didReceive(reply.body)
    task.didFinish()
  }

  private func file(at path: String) -> Reply {
    let decoded = path.removingPercentEncoding ?? path
    guard let (prefix, folder) = Self.mounts.first(where: { decoded.hasPrefix($0.0) }) else { return .notFound }
    let dir = root.appending(path: folder, directoryHint: .isDirectory).standardizedFileURL
    var file = dir.appending(path: String(decoded.dropFirst(prefix.count))).standardizedFileURL
    // Nothing outside the folder (`..`).
    guard file.path().hasPrefix(dir.path()) else { return .notFound }
    if file.hasDirectoryPath || file == dir { file.append(path: "index.html") }
    guard let body = try? Data(contentsOf: file) else { return .notFound }
    return Reply(status: 200, type: Self.types[file.pathExtension] ?? "application/octet-stream", body: body)
  }
}

struct NoNews: Error, CustomStringConvertible {
  var description: String { "No news here" }
}

struct Reply: Sendable {
  var status: Int
  var type: String
  var headers: [String: String] = [:]
  var body = Data()

  static let notFound = Reply(status: 404, type: "text/plain; charset=utf-8", body: Data("Not found".utf8))
}

// /net: GETs on https URLs of the outlets (Net.hosts) only, redirects included, since that is all the
// sources read (server.mjs allows the same). Sends back the site's status,
// type and body, the URL it ended at in x-final-url, and, when the site did
// not answer, a 504 with the reason in x-net-error. The user agent comes from
// x-user-agent, which the page can set.
final class Net: NSObject, URLSessionTaskDelegate, Sendable {
  static let userAgent = "wallpaper-headlines/0.1 (personal prototype)"

  // No cookies, no disk cache: the sources cache what they need.
  private let session = URLSession(configuration: .ephemeral)

  // The outlets' domains (sources/outlets), as server.mjs's NET_HOSTS.
  static let hosts = ["vrt.be", "nytimes.com", "washingtonpost.com", "foxnews.com"]

  static func allowed(_ url: URL?) -> Bool {
    guard let url, url.scheme == "https", let host = url.host() else { return false }
    return hosts.contains { host == $0 || host.hasSuffix("." + $0) }
  }

  func get(_ url: URL?, headers: [String: String]) async -> Reply {
    guard let url, Self.allowed(url) else {
      return Reply(status: 403, type: "text/plain; charset=utf-8", body: Data("Not a news source".utf8))
    }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
    request.setValue(header("accept", in: headers) ?? "*/*", forHTTPHeaderField: "Accept")
    request.setValue(header("x-user-agent", in: headers) ?? Self.userAgent, forHTTPHeaderField: "User-Agent")
    do {
      let (body, response) = try await session.data(for: request, delegate: self)
      let http = response as? HTTPURLResponse
      return Reply(
        status: http?.statusCode ?? 502,
        type: http?.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream",
        headers: ["X-Final-Url": response.url?.absoluteString ?? url.absoluteString],
        body: body)
    } catch {
      let reason = error.localizedDescription.unicodeScalars.filter { $0.isASCII && $0.value >= 0x20 }
      return Reply(status: 504, type: "text/plain; charset=utf-8", headers: ["X-Net-Error": String(String.UnicodeScalarView(reason))])
    }
  }

  // Each redirect must stay on the outlets too; one that does not ends the request
  // with the redirect itself, which the page treats as an error.
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest) async -> URLRequest? {
    Self.allowed(request.url) ? request : nil
  }

  private func header(_ name: String, in headers: [String: String]) -> String? {
    headers.first { $0.key.lowercased() == name }?.value
  }
}
