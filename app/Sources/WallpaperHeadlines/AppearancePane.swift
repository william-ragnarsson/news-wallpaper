import NewsStore
import SwiftUI
import WallpaperCore

// How the wallpaper looks (M4): a preview of the desktop, drawn by the
// Renderer from the stored news; how wide the page is; and the design, picked
// from cards that each show the desktop in that design, drawn as the preview is.
struct AppearancePane: View {
  let model: Customization
  let settings: WallpaperSettings
  let options: Options
  @SwiftUI.Environment(\.displayScale) private var displayScale

  var body: some View {
    let screen = model.screen
    let design = options.presets.first { $0.id == settings.preset }
    // A String, so the numbers show without a thousands separator.
    let size = "\(Int(screen.width)) × \(Int(screen.height))"
    Form {
      widthSection(design) {
        VStack(alignment: .leading, spacing: 8) {
          DesktopPreview(model: model, screen: screen)
          Text("Your desktop at \(size), with a stand-in menu bar and Dock, drawn from the news fetched last as the desktop picture is. The desktop picture follows a few seconds after a change.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .padding(.bottom, 12)
      }
      Section("Front page") {
        designCards { $0.data == "front" }
      }
      Section("One liveblog") {
        designCards { $0.data != "front" }
      }
    }
    .formStyle(.grouped)
    .task(id: previewKey) {
      // A slider sends a few changes in a row: draw after a pause.
      try? await Task.sleep(for: .milliseconds(500))
      guard !Task.isCancelled else { return }
      await model.drawPreview()
      // Then the cards, after the picture asked for.
      await model.drawThumbnails(of: options.presets, width: DesignCard.maxWidth * displayScale)
    }
  }

  // The settings as the window has them, saved or not; when they were saved
  // does not change the picture.
  private var previewKey: PreviewKey {
    var drawn = settings
    drawn.updatedAt = nil
    return PreviewKey(settings: drawn, screen: model.screen, page: model.page, fetchedAt: model.news?.fetchedAt)
  }

  // The designs that `include` takes, as cards to pick from. Every design in
  // public/presets/index.js gets one, with a picture drawn from the stored
  // news: a new design needs nothing more.
  private func designCards(_ include: (Options.Design) -> Bool) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: DesignCard.maxWidth), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
      ForEach(options.presets.filter(include)) { design in
        DesignCard(design: design, picture: model.thumbnails[design.id], screen: model.screen, picked: design.id == settings.preset) {
          model.change { $0.preset = design.id }
        }
      }
    }
    .padding(.vertical, 4)
  }

  // The slider shows the page's width; the setting is the margin it leaves.
  // Under `preview`, so the page's width is set where it shows.
  private func widthSection(_ design: Options.Design?, preview: () -> some View) -> some View {
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
      VStack(alignment: .leading, spacing: 0) {
        preview()
        Text("Page width")
      }
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

// A design to pick: a picture of it in the screen's proportions, its name and
// what it is. The picked one has a ring in the accent color.
private struct DesignCard: View {
  // Points across at most; its picture is drawn this wide in pixels.
  static let maxWidth: CGFloat = 200

  let design: Options.Design
  let picture: NSImage?  // nil until drawn
  let screen: CGSize
  let picked: Bool
  let pick: () -> Void

  var body: some View {
    Button(action: pick) {
      VStack(alignment: .leading, spacing: 6) {
        ZStack {
          Rectangle().fill(.quaternary)
          if let picture {
            Image(nsImage: picture).resizable().interpolation(.high)
          } else {
            Image(systemName: "newspaper").font(.title2).foregroundStyle(.tertiary)
          }
        }
        .aspectRatio(screen, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay {
          RoundedRectangle(cornerRadius: 6)
            .strokeBorder(picked ? AnyShapeStyle(.tint) : AnyShapeStyle(.separator), lineWidth: picked ? 3 : 1)
        }
        Text(design.name).fontWeight(.semibold)
        Text(design.description)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2, reservesSpace: true)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(design.description)
    .accessibilityLabel(design.name)
    .accessibilityHint(design.description)
    .accessibilityAddTraits(picked ? .isSelected : [])
  }
}

// What the preview is drawn from: when one of these changes, it is drawn again.
private struct PreviewKey: Equatable {
  let settings: WallpaperSettings
  let screen: CGSize
  let page: URL
  let fetchedAt: String?
}
