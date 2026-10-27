import SwiftUI
import WallpaperCore

// The Customize window: a sidebar with how the wallpaper looks, where its news
// comes from, and the app itself. Every change saves at once; the desktop
// picture follows a few seconds later.
struct CustomizeView: View {
  let model: Customization
  let refresh: () -> Void  // redraws the desktop picture now
  // Not @State: its macro plugin does not come with the Command Line Tools.
  private let sidebar = Sidebar()

  var body: some View {
    let pane = sidebar.pane
    // A row stays picked: clicking below the rows does not clear it.
    let selection = Binding<Pane?>(get: { sidebar.pane }, set: { if let pane = $0 { sidebar.pane = pane } })
    return NavigationSplitView {
      List(selection: selection) {
        Section("Wallpaper") {
          ForEach([Pane.appearance, .sources]) { Label($0.title, systemImage: $0.symbol) }
        }
        Section("App") {
          ForEach([Pane.settings]) { Label($0.title, systemImage: $0.symbol) }
        }
      }
      .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 240)
    } detail: {
      detail(pane)
        .navigationTitle(pane.title)
        .navigationSubtitle(status)
        .toolbar {
          ToolbarItem(placement: .primaryAction) {
            Button("Refresh now", systemImage: "arrow.clockwise", action: refresh)
              .keyboardShortcut("r")
              .disabled(model.rendering)
              .help("Redraw the desktop picture with these settings now")
          }
        }
    }
    .frame(minWidth: 720, minHeight: 540)
  }

  @ViewBuilder
  private func detail(_ pane: Pane) -> some View {
    if pane == .settings {
      SettingsPane(model: model)
    } else if let settings = model.settings, let options = model.options {
      Group {
        if pane == .appearance {
          AppearancePane(model: model, settings: settings, options: options)
        } else {
          SourcesPane(model: model, settings: settings, options: options)
        }
      }
      .safeAreaInset(edge: .top, spacing: 0) {
        if let server = model.server { ServerNotice(server: server) }
      }
    } else if let error = model.loadError {
      ContentUnavailableView {
        Label("Can’t load the settings", systemImage: "exclamationmark.triangle")
      } description: {
        Text(error)
      } actions: {
        Button("Try Again") { Task { await model.load() } }
      }
    } else {
      ProgressView("Loading settings…")
    }
  }

  private var status: String {
    if model.saving { return "Saving…" }
    if let error = model.saveError { return "Not saved: \(error)" }
    if model.rendering { return "Redrawing the desktop picture…" }
    return ""
  }
}

// The page comes from a server (the `page` default), which keeps its own
// settings: what is picked here waits until the app shows its own page again.
private struct ServerNotice: View {
  let server: URL

  var body: some View {
    Label {
      Text("The wallpaper comes from \(server.host() ?? server.absoluteString), which keeps its own settings. Changes here apply once the app shows its own page again: `defaults delete io.github.william-ragnarsson.news-wallpaper page`.")
        .textSelection(.enabled)
    } icon: {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
    }
    .font(.callout)
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.orange.opacity(0.12))
  }
}

@MainActor
@Observable
private final class Sidebar {
  var pane = Pane.appearance
}

enum Pane: Hashable, Identifiable {
  case appearance, sources, settings

  var id: Self { self }

  var title: String {
    switch self {
    case .appearance: "Appearance"
    case .sources: "Sources"
    case .settings: "Settings"
    }
  }

  var symbol: String {
    switch self {
    case .appearance: "paintbrush"
    case .sources: "newspaper"
    case .settings: "gearshape"
    }
  }
}

// MARK: Bindings

extension Customization {
  // A setting as a binding: setting it saves the change.
  func binding<Value>(_ settings: WallpaperSettings, _ key: WritableKeyPath<WallpaperSettings, Value>) -> Binding<Value> {
    Binding(get: { settings[keyPath: key] }, set: { value in self.change { $0[keyPath: key] = value } })
  }

  // Adds an id at the end of a list, or takes it out.
  func toggle(_ key: WritableKeyPath<WallpaperSettings, [String]>, _ id: String, on: Bool) {
    change {
      $0[keyPath: key].removeAll { $0 == id }
      if on { $0[keyPath: key].append(id) }
    }
  }

  func move(_ key: WritableKeyPath<WallpaperSettings, [String]>, _ index: Int, by offset: Int) {
    change { $0[keyPath: key].swapAt(index, index + offset) }
  }
}
