import AppKit
import NewsStore
import Observation
import WallpaperCore
import WallpaperRender

// Loads the settings into the Customize window and saves every change at
// once, one save at a time; a change made during a save goes out after it,
// or is dropped with it when that save fails. The settings come from
// SettingsService, in this process: no server. What there is to pick from
// comes from the stored news (NewsStore), never the network, and so does the
// preview, which the Renderer draws as it draws the desktop picture.
// `saved` runs each time a change is saved, to render the wallpaper.
@MainActor
@Observable
final class Customization {
  private(set) var settings: WallpaperSettings?  // what the window shows: saved, plus a change on its way
  private(set) var options: Options?
  private(set) var news: StoreMeta?  // the stored news; nil before the first fetch
  private(set) var loadError: String?
  private(set) var saveError: String?
  private(set) var saving = false
  private(set) var rendering = false  // the app is fetching or redrawing the desktop picture
  private(set) var preview: NSImage?
  private(set) var previewError: String?
  // The screen with the menu bar, which the desktop picture is drawn for.
  var screen = CGSize(width: 1512, height: 982)

  let service: SettingsService
  private let saved: () -> Void
  private var unsaved = false
  private var edits = 0  // changes made so far, to tell whether one came during a load
  private var confirmed: WallpaperSettings?  // what was last saved
  private var failures = 0  // saves that failed, to tell whether one failed during a load
  // The preview's own, so it never waits behind the desktop picture; made
  // when the preview is first drawn and let go when the window closes.
  @ObservationIgnored private var renderer: Renderer?
  // The designs' small pictures, for the Appearance pane's cards.
  @ObservationIgnored let thumbnails = Thumbnails()

  init(service: SettingsService, saved: @escaping () -> Void) {
    self.service = service
    self.saved = saved
  }

  // Where the wallpaper's files and settings are.
  var environment: WallpaperCore.Environment { service.environment }

  // The page the desktop picture is drawn from. Read again on each load, as
  // the Updater reads it on each redraw: the `page` default can change while
  // the app runs (see Environment.app).
  private(set) var page = WallpaperCore.Environment.app.page

  // The page keeps its own settings when it comes from a server, so changes
  // here do not reach it.
  var server: URL? { page.scheme == Bridge.scheme ? nil : page }

  func redrawing(_ on: Bool) {
    rendering = on
  }

  // Again each time the window comes forward and after each fetch: the news
  // changes, and settings.json can change by hand. A load also clears the
  // last failed save's message, except the one that follows that save and one
  // begun before it.
  func load(keepingSaveError: Bool = false) async {
    page = WallpaperCore.Environment.app.page
    let start = edits, failed = failures
    do {
      // The news first, read off the main thread, and what there is to pick
      // from in it, even during a save; then the settings, as fresh as they
      // can be.
      let store = environment.news
      let stored = await Task.detached { try? store.read() }.value
      options = try await service.options(news: stored?.data)
      news = stored?.meta
      guard !saving, !unsaved else { return }
      take(try await service.get(), since: start)
      loadError = nil
      if !keepingSaveError, failures == failed { saveError = nil }
    } catch {
      loadError = error.localizedDescription
    }
  }

  // Draws the preview: the page as the desktop picture is drawn, with the
  // settings in the window (saved or not), at the screen's size in points.
  func drawPreview() async {
    guard let settings else { return }
    let renderer = self.renderer ?? Renderer(environment)
    self.renderer = renderer
    // A page from a server reads its own settings.
    let request = RenderRequest(page: previewPage, size: screen, scale: 1, settings: server == nil ? settings : nil)
    do {
      let snapshot = try await renderer.render(request)
      // A newer one is on its way, or the window closed.
      guard !Task.isCancelled, self.renderer === renderer else { return }
      preview = NSImage(data: snapshot.png)
      previewError = nil
    } catch StoreError.empty {
      guard self.renderer === renderer else { return }
      preview = nil
      previewError = "No news fetched yet. Update news fetches it."
    } catch {
      guard !Task.isCancelled, self.renderer === renderer else { return }
      // Not the picture before, which was for other settings.
      preview = nil
      previewError = error.localizedDescription
    }
  }

  // The small picture of `design` with the settings in the window, as the
  // Appearance pane's cards show and drawThumbnails draws it.
  func thumbnailKey(_ design: Options.Design, settings: WallpaperSettings) -> Thumbnails.Key {
    Thumbnails.Key(design, settings: settings, fetchedAt: news?.fetchedAt, screen: screen, page: previewPage)
  }

  // Draws the small pictures of `designs` that are not drawn yet, with the
  // settings in the window. Not for a page from a server, which reads its
  // own settings, so every design would look the same.
  func drawThumbnails(_ designs: [Options.Design]) async {
    guard let settings, server == nil else { return }
    await thumbnails.draw(designs.map { thumbnailKey($0, settings: settings) }, environment: environment)
  }

  // The page with the stand-in menu bar and Dock, which only cover the page,
  // and without the page's own status line.
  private var previewPage: URL {
    var parts = URLComponents(url: page, resolvingAgainstBaseURL: true)!
    parts.queryItems = (parts.queryItems ?? []).filter { !["chrome", "hud"].contains($0.name) } + [URLQueryItem(name: "hud", value: "0")]
    return parts.url!
  }

  // The window closed: its preview goes, with the renderers' web views.
  func closed() {
    renderer = nil
    thumbnails.closed()
    preview = nil
    previewError = nil
  }

  // Settings loaded, unless a change was made since the load began: that
  // change is newer.
  private func take(_ settings: WallpaperSettings, since start: Int) {
    guard edits == start, !saving, !unsaved else { return }
    self.settings = settings
    confirmed = settings
  }

  func change(_ edit: (inout WallpaperSettings) -> Void) {
    guard var next = settings else { return }
    edit(&next)
    guard next != settings else { return }
    settings = next
    unsaved = true
    edits += 1
    Task { await save() }
  }

  private func save() async {
    guard !saving, unsaved, let sent = settings else { return }
    unsaved = false
    let patch = Patch(sent, since: confirmed)
    guard !patch.isEmpty else { return }  // changed and changed back
    saving = true
    do {
      let answer = try await service.update(JSONEncoder().encode(patch))
      confirmed = answer
      // A change made during the save goes on top of what was saved, so the
      // next save sends that change alone and not the rest of what the
      // window had.
      if unsaved, let current = settings {
        settings = Patch(current, since: sent).applied(to: answer)
      } else {
        settings = answer
      }
      saveError = nil
    } catch {
      // Back to what was saved; a change made meanwhile goes too. At
      // once, so a change made during the load below sends that change alone.
      saveError = error.localizedDescription
      failures += 1
      settings = confirmed
      unsaved = false
      saving = false
      await load(keepingSaveError: true)
      return
    }
    saving = false
    // The app waits for a pause before it renders, so a run of saves draws once.
    saved()
    if unsaved { await save() }
  }
}

// What a save sends: only the fields changed here since the last save, so a
// change made to the file meanwhile stays. Fields left nil are left out.
private struct Patch: Encodable {
  var preset: String?
  var provider: String?
  var liveFirst: Bool?
  var sections: [String]?
  var margin: Int?
  var pictures: String?
  var color: Bool?

  init(_ s: WallpaperSettings, since old: WallpaperSettings?) {
    if s.preset != old?.preset { preset = s.preset }
    if s.provider != old?.provider { provider = s.provider }
    if s.liveFirst != old?.liveFirst { liveFirst = s.liveFirst }
    if s.sections != old?.sections { sections = s.sections }
    if s.margin != old?.margin { margin = s.margin }
    if s.pictures != old?.pictures { pictures = s.pictures }
    if s.color != old?.color { color = s.color }
  }

  var isEmpty: Bool {
    preset == nil && provider == nil && liveFirst == nil && sections == nil && margin == nil
      && pictures == nil && color == nil
  }

  // These fields over the others, as SettingsService does with a patch.
  func applied(to s: WallpaperSettings) -> WallpaperSettings {
    var s = s
    s.preset = preset ?? s.preset
    s.provider = provider ?? s.provider
    s.liveFirst = liveFirst ?? s.liveFirst
    s.sections = sections ?? s.sections
    s.margin = margin ?? s.margin
    s.pictures = pictures ?? s.pictures
    s.color = color ?? s.color
    return s
  }
}
