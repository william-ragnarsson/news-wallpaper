import AppKit
import WebKit

// Renders the wallpaper page in a web view that is never shown on screen and
// returns it as a PNG at the screen's pixel size.
@MainActor
final class Renderer: NSObject, WKNavigationDelegate {
  private let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
  private let webView = WKWebView()
  private var loading: CheckedContinuation<Void, Error>?

  override init() {
    super.init()
    window.isReleasedWhenClosed = false
    window.contentView = webView
    webView.navigationDelegate = self
  }

  func render(_ url: URL, for screen: NSScreen) async throws -> Data {
    // The window sits on the screen it renders for, so the page gets that
    // screen's size and pixel density, but it is never ordered in.
    window.setFrame(screen.frame, display: false)
    try await load(url)
    // The page fetches the news after it loads; give it time to fill in.
    try await Task.sleep(for: .seconds(4))

    let image = try await webView.takeSnapshot(configuration: nil)
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
      throw RenderError.noImage
    }
    NSLog("Rendered \(cgImage.width)×\(cgImage.height) px for a \(Int(screen.frame.width))×\(Int(screen.frame.height)) pt screen at \(screen.backingScaleFactor)x")
    guard let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
      throw RenderError.noImage
    }
    return png
  }

  private func load(_ url: URL) async throws {
    loading?.resume(throwing: CancellationError())
    try await withCheckedThrowingContinuation { continuation in
      loading = continuation
      webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loading?.resume()
    loading = nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loading?.resume(throwing: error)
    loading = nil
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loading?.resume(throwing: error)
    loading = nil
  }
}

enum RenderError: Error {
  case noImage
}
