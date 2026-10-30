import CustomizeUI
import SwiftUI
import WallpaperCore

// Where the news comes from (M5): SourcesForm (CustomizeUI) with what the app
// fetched last and the settings in the window, each change saved at once.
struct SourcesPane: View {
  let model: Customization
  let settings: WallpaperSettings
  let options: Options

  var body: some View {
    SourcesForm(
      digest: SourcesDigest(options: options, settings: settings, news: model.news),
      provider: model.binding(settings, \.provider),
      liveFirst: model.binding(settings, \.liveFirst),
      sections: model.binding(settings, \.sections))
  }
}
