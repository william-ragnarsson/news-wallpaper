import Foundation
import NewsStore
import WallpaperCore

// What the Sources pane shows, worked out in one place from what there is to
// pick from (Options, with the headlines of the stored news), the settings
// and the stored news: the provider's sections on the front page in their
// order and the others, each with its latest stories, and the running live
// stories in the order they lead the front page. The views only lay it out,
// and change the order through the helpers at the end.
public struct SourcesDigest: Sendable {
  public struct Section: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let group: String
    public let items: Int?  // in the news fetched last
    public let stories: [Story]  // its first few, in its feed's order
  }

  public struct Story: Identifiable, Sendable {
    public let id: String  // its url
    public let title: String
    public let time: Date?
  }

  // The stored news, for the picked provider.
  public enum News: Sendable {
    case current(StoreMeta)
    case otherProvider(String)  // another's, by name: the picture shows it until the picked one's is fetched
    case none  // nothing fetched yet
  }

  public let providers: [Options.Provider]
  public let provider: Options.Provider?
  public let design: Options.Design?
  public let liveFirst: Bool
  // The ids on the front page in order, as the settings have them.
  public let order: [String]
  public let picked: [Section]
  public let others: [Section]
  // nil when the stored news is not the picked provider's, so there is
  // nothing to tell.
  public let live: [Story]?
  public let news: News
  // The names of the designs that show the front page (and so follow
  // liveFirst), and of those that show the sections.
  public let frontDesigns: [String]
  public let sectionDesigns: [String]

  public init(options: Options, settings: WallpaperSettings, news meta: StoreMeta?) {
    let provider = options.providers.first { $0.id == settings.provider }
    // The stored news only when it is the picked provider's: after a switch
    // it is the one before's until the new one's fetch is stored.
    let current = meta.flatMap { $0.provider == settings.provider ? $0 : nil }
    let headlines = options.headlines.flatMap { current != nil && $0.provider == settings.provider ? $0 : nil }
    let section = { (s: Options.Section) in
      Section(id: s.id, name: s.name, group: s.group, items: current?.counts.items[s.id],
        stories: (headlines?.sections[s.id] ?? []).compactMap(Self.story))
    }
    let sections = provider?.sections ?? []
    self.providers = options.providers
    self.provider = provider
    design = options.presets.first { $0.id == settings.preset }
    liveFirst = settings.liveFirst
    order = settings.sections
    picked = settings.sections.compactMap { id in sections.first { $0.id == id } }.map(section)
    others = sections.filter { !settings.sections.contains($0.id) }.map(section)
    live = headlines.map { $0.live.compactMap(Self.story) }
    if let current {
      news = .current(current)
    } else if let meta {
      news = .otherProvider(options.providers.first { $0.id == meta.provider }?.name ?? meta.provider)
    } else {
      news = .none
    }
    frontDesigns = options.presets.filter { $0.data == "front" }.map(\.name)
    sectionDesigns = options.presets.filter { $0.sections == true }.map(\.name)
  }

  public var showsFront: Bool { design?.data == "front" }
  public var showsSections: Bool { design?.sections == true }

  private static func story(_ s: Options.Story) -> Story? {
    guard let title = s.title, !title.isEmpty else { return nil }
    return Story(id: s.url, title: title, time: s.time.map { Date(timeIntervalSince1970: $0 / 1000) })
  }

  // MARK: Order

  // The order with `id` in the place of `target` (the one there moves along),
  // or at the end with no target; nil when `id` is none of the provider's
  // sections (a drop from elsewhere) or nothing changes.
  public func placing(_ id: String, at target: String?) -> [String]? {
    guard id != target, provider?.sections.contains(where: { $0.id == id }) == true else { return nil }
    var next = order
    let place = target.flatMap { order.firstIndex(of: $0) } ?? order.endIndex
    next.removeAll { $0 == id }
    next.insert(id, at: min(place, next.endIndex))
    return next == order ? nil : next
  }

  // The order with `id` `offset` places up (-1) or down (1); nil at the ends.
  public func moving(_ id: String, by offset: Int) -> [String]? {
    guard let index = order.firstIndex(of: id), order.indices.contains(index + offset) else { return nil }
    var next = order
    next.swapAt(index, index + offset)
    return next
  }

  public func removing(_ id: String) -> [String]? {
    order.contains(id) ? order.filter { $0 != id } : nil
  }
}
