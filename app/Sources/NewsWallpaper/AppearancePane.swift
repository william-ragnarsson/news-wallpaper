import SwiftUI
import WebKit

// How the wallpaper looks: a live preview of the desktop, the design and how
// wide the page is.
struct AppearancePane: View {
  let model: Customization
  let settings: WallpaperSettings
  let options: Options

  var body: some View {
    let screen = model.screen
    let design = options.presets.first { $0.id == settings.preset }
    // A String, so the numbers show without a thousands separator.
    let size = "\(Int(screen.width)) × \(Int(screen.height))"
    Form {
      Section {
        designPicker
        if let design {
          Text(design.description).foregroundStyle(.secondary)
        }
      } header: {
        VStack(alignment: .leading, spacing: 8) {
          DesktopPreview(url: previewURL, screen: screen)
          Text("Your desktop at \(size), with a stand-in menu bar and Dock. The desktop picture follows a few seconds after a change.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .padding(.bottom, 12)
      }
      widthSection(design)
    }
    .formStyle(.grouped)
  }

  // The page the wallpaper renders, at this screen's size, with the menu bar
  // and Dock drawn in. It follows the settings by itself.
  private var previewURL: URL {
    let screen = model.screen
    var parts = URLComponents(url: model.server, resolvingAgainstBaseURL: true)!
    parts.queryItems = (parts.queryItems ?? []).filter { !["chrome", "hud", "screen"].contains($0.name) } + [
      URLQueryItem(name: "hud", value: "0"),
      URLQueryItem(name: "screen", value: "\(Int(screen.width))x\(Int(screen.height))"),
    ]
    return parts.url!
  }

  private var designPicker: some View {
    Picker("Design", selection: model.binding(settings, \.preset)) {
      Section("Front page") {
        ForEach(options.presets.filter { $0.data == "front" }) { Text($0.name).tag($0.id) }
      }
      Section("One liveblog") {
        ForEach(options.presets.filter { $0.data != "front" }) { Text($0.name).tag($0.id) }
      }
    }
  }

  // The slider shows the page's width; the setting is the margin it leaves.
  private func widthSection(_ design: Options.Design?) -> some View {
    let max = options.maxMargin
    let keeps = options.presets.filter { $0.margin == true }.map(\.name)
    let width = Binding(
      get: { Double(max - settings.margin) },
      set: { value in model.change { $0.margin = max - Int(value.rounded()) } })
    return Section {
      Slider(value: width, in: 0...Double(max), step: 8) {
        Text("Width")
      } minimumValueLabel: {
        Text("Narrow")
      } maximumValueLabel: {
        Text("Full")
      }
      .disabled(design?.margin != true)
    } header: {
      Text("Page width")
    } footer: {
      if design?.margin != true {
        Text("This design always fills the screen. \(keeps.formatted(.list(type: .and))) can leave room for your desktop files.")
      } else if settings.margin == 0 {
        Text("The page runs to the edges of the screen.")
      } else {
        Text("Leaves \(settings.margin) pt of blank paper at each side, for the files and folders on your desktop.")
      }
    }
  }
}

// The page in the screen's proportions, scaled down.
private struct DesktopPreview: View {
  let url: URL
  let screen: CGSize

  var body: some View {
    PageView(url: url, screen: screen)
      .aspectRatio(screen, contentMode: .fit)
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
      .shadow(color: .black.opacity(0.15), radius: 8, y: 3)
      .frame(maxWidth: .infinity)
  }
}

private struct PageView: NSViewRepresentable {
  let url: URL
  let screen: CGSize  // the page is laid out at this size

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> ScaledPage {
    ScaledPage()
  }

  // The page writes its own address as it goes, so compare with what was
  // asked for, not with the web view's URL.
  func updateNSView(_ view: ScaledPage, context: Context) {
    view.screen = screen
    guard context.coordinator.loaded != url else { return }
    context.coordinator.loaded = url
    view.web.load(URLRequest(url: url))
  }

  final class Coordinator {
    var loaded: URL?
  }
}

// The page laid out at the screen's full size, as the desktop picture is, then
// drawn smaller. Scaled down by a CSS transform or zoomed out instead, it fits
// its text differently: Broadsheet measures its headline after the transform,
// and WebKit keeps zoomed-out text from getting small.
//
// It takes no clicks, scrolls or keys: the page's own shortcuts would change
// what it shows.
private final class ScaledPage: NSView {
  let web = InertWebView()
  var screen = CGSize(width: 1512, height: 982) {
    didSet { if screen != oldValue { fit() } }
  }

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    addSubview(web)
    fit()
  }

  required init?(coder: NSCoder) { fatalError("not from a nib") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    fit()
  }

  // Bounds the size of the screen inside a frame the size of the preview
  // scale everything in them down.
  private func fit() {
    web.frame = CGRect(origin: .zero, size: screen)
    setBoundsSize(screen)
  }
}

private final class InertWebView: WKWebView {
  override var acceptsFirstResponder: Bool { false }
}
