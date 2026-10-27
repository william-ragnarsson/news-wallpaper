import AppKit
import SwiftUI

// The app itself: its version, how new versions arrive, the news server it
// talks to, and whose work is on the desktop.
struct SettingsPane: View {
  let model: Customization

  private let repository = URL(string: "https://github.com/william-ragnarsson/news-wallpaper")!
  // Homebrew installs into its Cellar; any other copy was built from the repository.
  private let homebrew = Bundle.main.bundlePath.contains("/Cellar/")
  private var upgrade: String { homebrew ? "brew upgrade news-wallpaper" : "git pull && sh app/bundle.sh" }

  var body: some View {
    Form {
      Section {
        HStack(spacing: 14) {
          Image(systemName: "newspaper.fill")
            .font(.system(size: 28))
            .foregroundStyle(.white)
            .frame(width: 56, height: 56)
            .background(.tint, in: RoundedRectangle(cornerRadius: 12))
          VStack(alignment: .leading, spacing: 2) {
            Text("News Wallpaper").font(.title2.weight(.semibold))
            Text("Version \(version)").foregroundStyle(.secondary).textSelection(.enabled)
          }
        }
        .padding(.vertical, 4)
      }

      Section {
        LabeledContent("Installed", value: version)
        LabeledContent("From", value: homebrew ? "Homebrew" : "The repository, built on this Mac")
        LabeledContent("Update with") {
          HStack {
            Text(upgrade).monospaced().textSelection(.enabled)
            Button("Copy", systemImage: "doc.on.doc") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(upgrade, forType: .string)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Copy the command")
          }
        }
        if homebrew {
          LabeledContent("Release notes") {
            Link("GitHub", destination: repository.appending(path: "releases"))
          }
        } else {
          LabeledContent("Changes") {
            Link("GitHub", destination: repository.appending(path: "commits/main"))
          }
        }
      } header: {
        Text("Updates")
      } footer: {
        Text(homebrew
          ? "New versions come out through Homebrew. Run the command in Terminal, then quit and reopen the app."
          : "Run the command in Terminal in the repository’s folder, then quit and reopen the app. Once News Wallpaper is on Homebrew, brew upgrade news-wallpaper will do this.")
      }

      Section("News server") {
        LabeledContent("Address", value: model.address)
        LabeledContent("Status") {
          if model.loadError != nil {
            HStack {
              Label("Can’t reach it", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
              Button("Try Again") { Task { await model.load() } }
            }
          } else if model.settings != nil {
            Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
          } else {
            Text("Connecting…").foregroundStyle(.secondary)
          }
        }
      }

      Section {
        LabeledContent("News Wallpaper", value: "MIT License, © 2026 William Ragnarsson")
        DisclosureGroup("License text") {
          if let license = Self.license {
            Text(license)
              .font(.callout)
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
              .padding(.vertical, 4)
          } else {
            Link("The MIT License on GitHub", destination: repository.appending(path: "blob/main/LICENSE"))
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        LabeledContent("News") {
          Text(credits)
        }
        LabeledContent("Fonts", value: "Google Fonts, SIL Open Font License 1.1")
      } header: {
        Text("License")
      } footer: {
        Text("The MIT License covers News Wallpaper’s own code. Headlines, text and photos belong to their publishers and show as they published them.")
      }
    }
    .formStyle(.grouped)
    // The status stays true while this shows: the server can stop or start.
    .task {
      while !Task.isCancelled {
        await model.check()
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  // From Info.plist; a build run with `swift run` has none.
  private var version: String {
    let info = Bundle.main.infoDictionary
    guard let short = info?["CFBundleShortVersionString"] as? String else { return "development build" }
    return [short, (info?["CFBundleVersion"] as? String).map { "(\($0))" }].compactMap { $0 }.joined(separator: " ")
  }

  // The LICENSE that bundle.sh copies in, its lines joined so it wraps to the
  // pane; a build run with `swift run` has none.
  private static let license: String? = {
    guard let url = Bundle.main.url(forResource: "LICENSE", withExtension: nil),
          let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
      .components(separatedBy: "\n\n")
      .map { $0.replacingOccurrences(of: "\n", with: " ") }
      .joined(separator: "\n\n")
  }()

  // Every provider the news server lists, with its owner.
  private var credits: String {
    let providers = model.options?.providers ?? []
    return providers.isEmpty ? "Its publishers" : providers.map { "\($0.name), © \($0.owner)" }.joined(separator: "\n")
  }
}
