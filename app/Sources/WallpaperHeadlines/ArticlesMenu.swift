import AppKit
import SwiftUI
import WallpaperRender

// The stories on the desktop picture: those of the last picture put there
// (Updater.drawn). A redraw that fails leaves the picture before on the
// desktop, and its stories here.
@MainActor @Observable
final class OnScreen {
  var stories: [Snapshot.Story] = []
}

// Articles ›, in the menu bar's menu: the stories on the desktop picture in
// the design's order. One opens its page in the browser.
struct ArticlesMenu: View {
  let onScreen: OnScreen

  var body: some View {
    Menu("Articles") {
      ForEach(onScreen.stories, id: \.url) { story in
        Button(Self.short(story.title)) { NSWorkspace.shared.open(story.url) }
      }
    }
    .disabled(onScreen.stories.isEmpty)
  }

  // A long headline cut at a word, so the menu stays narrow.
  static func short(_ title: String, length: Int = 80) -> String {
    guard title.count > length else { return title }
    let cut = title.prefix(length)
    let words = cut.lastIndex(of: " ").map { cut[..<$0] } ?? cut
    return words.trimmingCharacters(in: .whitespaces.union(CharacterSet(charactersIn: ",;:–—-"))) + "…"
  }
}
