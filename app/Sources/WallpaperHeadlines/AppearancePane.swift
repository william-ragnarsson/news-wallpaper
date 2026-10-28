import NewsStore
import SwiftUI
import WallpaperCore

// How the wallpaper looks (M4): a preview of the desktop, drawn by the
// Renderer from the stored news; the designs as cards with a small picture of
// each; pictures and color; and how wide the page is.
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
        designCards
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
      looksSection(design)
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
  private var designCards: some View {
    let liveblogs = options.providers.first { $0.id == settings.provider }?.liveblogs == true
    let front = options.presets.filter { $0.data == "front" }
    let others = liveblogs ? options.presets.filter { $0.data != "front" } : []
    let keys = (front + others).map(thumbnailKey)
    return VStack(alignment: .leading, spacing: 14) {
      cardGrid(front)
      if !others.isEmpty {
        Text("One liveblog").font(.headline)
        cardGrid(others)
      }
    }
    .padding(.vertical, 4)
    .task(id: keys) {
      // A run of changes draws once, after the preview has started.
      try? await Task.sleep(for: .milliseconds(700))
      guard !Task.isCancelled else { return }
      await model.drawThumbnails(front + others)
    }
  }

  private func cardGrid(_ designs: [Options.Design]) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)], spacing: 14) {
      ForEach(designs) { design in
        let key = thumbnailKey(design)
        DesignCard(
          name: design.name,
          image: model.thumbnails.image(for: key),
          // Nothing is drawn for a page from a server or before the first fetch.
          drawing: model.server == nil && model.news != nil && !model.thumbnails.failed.contains(key),
          screen: model.screen,
          selected: design.id == settings.preset
        ) {
          model.change { $0.preset = design.id }
        }
      }
    }
  }

  private func thumbnailKey(_ design: Options.Design) -> Thumbnails.Key {
    model.thumbnailKey(design, settings: settings)
  }

  // How many photos, and in color or not, for the designs that follow these.
  private func looksSection(_ design: Options.Design?) -> some View {
    let follows = options.presets.filter { $0.pictures == true || $0.color == true }.map(\.name)
    return Section {
      Picker("Pictures", selection: model.binding(settings, \.pictures)) {
        Text("None").tag("none")
        Text("One").tag("one")
        Text("Several").tag("several")
      }
      .pickerStyle(.segmented)
      .disabled(design?.pictures != true)
      Picker("Color", selection: model.binding(settings, \.color)) {
        Text("Black and white").tag(false)
        Text("Color").tag(true)
      }
      .pickerStyle(.segmented)
      .disabled(design?.color != true)
    } header: {
      Text("Pictures")
    } footer: {
      if design?.pictures != true && design?.color != true {
        Text("This design has its own pictures. \(follows.formatted(.list(type: .and))) follows these.")
      } else {
        Text("One photo keeps the page calm and text-led; several adds small ones beside the shorter stories.")
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

// A design to pick: its small picture, or a stand-in while it is drawn (or
// when it cannot be), and its name.
private struct DesignCard: View {
  let name: String
  let image: NSImage?
  let drawing: Bool
  let screen: CGSize
  let selected: Bool
  let pick: () -> Void

  var body: some View {
    Button(action: pick) {
      VStack(spacing: 6) {
        ZStack {
          Rectangle().fill(.quaternary)
          if let image {
            Image(nsImage: image).resizable().interpolation(.high)
          } else if drawing {
            ProgressView().controlSize(.small)
          } else {
            Image(systemName: "newspaper").font(.title2).foregroundStyle(.secondary)
          }
        }
        .aspectRatio(screen, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
          RoundedRectangle(cornerRadius: 6)
            .strokeBorder(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.separator), lineWidth: selected ? 3 : 1)
        )
        Text(name)
          .font(.callout.weight(selected ? .semibold : .regular))
          .foregroundStyle(selected ? .primary : .secondary)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

// What the preview is drawn from: when one of these changes, it is drawn again.
private struct PreviewKey: Equatable {
  let settings: WallpaperSettings
  let screen: CGSize
  let page: URL
  let fetchedAt: String?
}
