import Foundation
import WebKit

// Runs the page's JavaScript for Swift: a web view that is never shown, on an
// empty page at wallpaper://app/ (public/script-host.html), where the modules
// in public/ and sources/ import as they do in the wallpaper: the settings'
// rules (SettingsService) and the fetch (NewsFeed). Plain
// JavaScriptCore can not run them: no modules, fetch or URL.
@MainActor
public final class ScriptHost: NSObject, WKNavigationDelegate {
  private static let page = URL(string: "script-host.html", relativeTo: Bridge.home)!.absoluteURL

  private let webView: WKWebView
  private var loading: Task<Void, Error>?
  private var navigation: WKNavigation?
  private var loaded: CheckedContinuation<Void, Error>?

  public init(_ environment: Environment) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(Bridge(environment), forURLScheme: Bridge.scheme)
    config.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    webView.navigationDelegate = self
    webView.isInspectable = true
  }

  // Runs `body`, the body of an async function, with `arguments` as its
  // variables, and returns what it returns.
  public func run(_ body: String, _ arguments: [String: String] = [:]) async throws -> Any? {
    try await ready()
    return try await webView.callAsyncJavaScript(body, arguments: arguments, contentWorld: .page)
  }

  // The page, loaded once; again after a failed load or a crash.
  public func ready() async throws {
    let task = loading ?? Task {
      try await withCheckedThrowingContinuation { continuation in
        fail()  // a load left over: it would never finish now
        loaded = continuation
        navigation = webView.load(URLRequest(url: Self.page))
      }
    }
    loading = task
    do {
      try await task.value
    } catch {
      // Only this load: a newer one may have begun meanwhile.
      if loading == task { loading = nil }
      throw error
    }
  }

  private func finish(_ navigation: WKNavigation?, _ result: Result<Void, Error>) {
    guard navigation == self.navigation, let loaded else { return }
    self.loaded = nil
    loaded.resume(with: result)
  }

  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finish(navigation, .success(()))
  }

  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(navigation, .failure(error))
  }

  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    finish(navigation, .failure(error))
  }

  // WebKit drops a load that was under way without a didFail, so fail it here.
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loading = nil
    navigation = nil
    fail()
  }

  private func fail() {
    guard let loaded else { return }
    self.loaded = nil
    loaded.resume(throwing: CocoaError(.featureUnsupported, userInfo: [NSLocalizedDescriptionKey: "The script host's web view stopped"]))
  }
}
