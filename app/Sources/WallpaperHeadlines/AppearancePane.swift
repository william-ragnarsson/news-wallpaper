import NewsStore
import SwiftUI
import WallpaperCore

// How the wallpaper looks (M4): a preview of the desktop, drawn by the
// Renderer from the stored news, the design and how wide the page is.
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
          DesktopPreview(model: model, screen: screen)
            .task(id: previewKey) {
              // A slider sends a few changes in a row: draw after a pause.
              try? await Task.sleep(for: .milliseconds(500))
              guard !Task.isCancelled else { return }
              await model.drawPreview()
            }
          Text("Your desktop at \(size), with a stand-in menu bar and Dock, drawn from the news fetched last as the desktop picture is. The desktop picture follows a few seconds after a change.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .padding(.bottom, 12)
      }
      widthSection(design)
    }
    .formStyle(.grouped)
  }

  // The settings as the window has them, saved or not; when they were saved
  // does not change the picture.
  private var previewKey: PreviewKey {
    var drawn = settings
    drawn.updatedAt = nil
    return PreviewKey(settings: drawn, screen: model.screen, page: model.page, fetchedAt: model.news?.fetchedAt)
  }

  // The designs that follow one liveblog only for a provider that has them.
  private var designPicker: some View {
    let liveblogs = options.providers.first { $0.id == settings.provider }?.liveblogs == true
    return Picker("Design", selection: model.binding(settings, \.preset)) {
      Section("Front page") {
        ForEach(options.presets.filter { $0.data == "front" }) { Text($0.name).tag($0.id) }
      }
      if liveblogs {
        Section("One liveblog") {
          ForEach(options.presets.filter { $0.data != "front" }) { Text($0.name).tag($0.id) }
        }
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

// The preview in the screen's proportions, scaled down: the PNG the Renderer
// drew last, while the next is drawn.
private struct DesktopPreview: View {
  let model: Customization
  let screen: CGSize

  var body: some View {
    ZStack {
      Rectangle().fill(.background)
      if let image = model.preview {
        Image(nsImage: image).resizable().interpolation(.high)
      } else if let error = model.previewError {
        Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center).padding()
      } else {
        ProgressView()
      }
    }
    .aspectRatio(screen, contentMode: .fit)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
    .shadow(color: .black.opacity(0.15), radius: 8, y: 3)
    .frame(maxWidth: .infinity)
  }
}

// What the preview is drawn from: when one of these changes, it is drawn again.
private struct PreviewKey: Equatable {
  let settings: WallpaperSettings
  let screen: CGSize
  let page: URL
  let fetchedAt: String?
}
