import AppKit
import SwiftUI

// The app itself: its version, how new versions arrive, where it keeps the
// settings, and whose work is on the desktop.
struct SettingsPane: View {
  let model: Customization

  private let repository = URL(string: "https://github.com/william-ragnarsson/wallpaper-headlines")!
  // Homebrew installs into its Cellar; any other copy was built from the repository.
  private let homebrew = AppUpdate.keg != nil
  private let upgrade = "git pull && sh app/bundle.sh"
  // One for the app, so an update keeps going when the pane changes.
  private let update = AppUpdate.shared

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
            Text("Wallpaper Headlines").font(.title2.weight(.semibold))
            Text("Version \(version)").foregroundStyle(.secondary).textSelection(.enabled)
          }
        }
        .padding(.vertical, 4)
      }

      Section {
        LabeledContent("Installed", value: version)
        LabeledContent("From", value: homebrew ? "Homebrew" : "The repository, built on this Mac")
        if homebrew {
          LabeledContent("Update") {
            HStack {
              switch update.state {
              case .idle: EmptyView()
              case .running: ProgressView().controlSize(.small)
              case .upToDate: Text("Up to date").foregroundStyle(.secondary)
              case .failed(let message): Text(message).foregroundStyle(.red).textSelection(.enabled)
              }
              Button(update.state == .running ? "Updating…" : "Update", action: update.run)
                .disabled(update.state == .running)
            }
          }
        } else {
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
          ? "New versions come out through Homebrew. Update runs brew upgrade wallpaper-headlines, which builds the new version on this Mac in a minute or two, then reopens the app."
          : "Run the command in Terminal in the repository’s folder, then quit and reopen the app. Once Wallpaper Headlines is on Homebrew, brew upgrade wallpaper-headlines will do this.")
      }

      Section("Data") {
        LabeledContent("Settings") {
          HStack {
            Text(model.environment.settings.file.path(percentEncoded: false))
              .textSelection(.enabled)
              .truncationMode(.middle)
              .lineLimit(1)
            Button("Show in Finder", systemImage: "folder") {
              // No file until the first change: then its folder, made if need be.
              let file = model.environment.settings.file
              let folder = file.deletingLastPathComponent()
              try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
              NSWorkspace.shared.activateFileViewerSelecting([FileManager.default.fileExists(atPath: file.path) ? file : folder])
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Show in Finder")
          }
        }
      }

      Section {
        LabeledContent("Wallpaper Headlines", value: "MIT License, © 2026 William Ragnarsson")
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
        Text("The MIT License covers Wallpaper Headlines’s own code. Headlines, text and photos belong to their publishers and show as they published them.")
      }
    }
    .formStyle(.grouped)
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

  // Every provider there is, with its owner.
  private var credits: String {
    let providers = model.options?.providers ?? []
    return providers.isEmpty ? "Its publishers" : providers.map { "\($0.name), © \($0.owner)" }.joined(separator: "\n")
  }
}
