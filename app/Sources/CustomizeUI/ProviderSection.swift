import SwiftUI

// The provider the news comes from, what it is, and when its news was
// fetched last. Picking another saves it, and the app fetches that one's
// news (Updater).
struct ProviderSection: View {
  let digest: SourcesDigest
  @Binding var provider: String

  var body: some View {
    Section {
      Picker("News from", selection: $provider) {
        ForEach(digest.providers) { Text($0.name).tag($0.id) }
      }
      .pickerStyle(.menu)
      if let p = digest.provider {
        if let description = p.description {
          Text(description).foregroundStyle(.secondary)
        }
        LabeledContent("Publisher", value: p.owner)
        LabeledContent("Language", value: Locale.current.localizedString(forLanguageCode: p.language) ?? p.language)
        LabeledContent("Website") {
          Link(p.homepage.host() ?? p.homepage.absoluteString, destination: p.homepage)
        }
      }
      fetched
    } header: {
      Text("Provider")
    } footer: {
      Text("The app fetches the news of the provider picked only: every few minutes while the screen is on, and when you click Update news. A change here redraws the picture from the news fetched last; picking another provider fetches its news first.")
    }
  }

  // When the news was fetched, and what of it failed (kept from the fetch
  // before, when that had it).
  @ViewBuilder
  private var fetched: some View {
    switch digest.news {
    case .current(let news):
      LabeledContent("Fetched", value: Self.date(news.fetchedAt).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? news.fetchedAt)
      if !news.errors.isEmpty {
        Text(news.errors.count == 1 ? "One feed did not load: it is kept from the fetch before, if that had it." : "\(news.errors.count) feeds did not load: they are kept from the fetch before, if that had them.")
          .foregroundStyle(.secondary)
      }
    case .otherProvider(let name):
      Text("Not fetched from \(digest.provider?.name ?? "this provider") yet: the picture shows the news of \(name) until it is. Update news fetches it.")
        .foregroundStyle(.secondary)
    case .none:
      Text("No news fetched yet. Update news fetches it.").foregroundStyle(.secondary)
    }
  }

  private static func date(_ text: String) -> Date? {
    try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)
  }
}
