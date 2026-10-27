import SwiftUI
import WallpaperCore

// Where the news comes from: the provider, its feeds on the front page and the
// liveblogs that lead it, each in the order picked.
struct SourcesPane: View {
  let model: Customization
  let settings: WallpaperSettings
  let options: Options

  var body: some View {
    let provider = options.providers.first { $0.id == settings.provider }
    let design = options.presets.first { $0.id == settings.preset }
    Form {
      providerSection(provider)
      if let provider {
        feedSections(provider, design)
      }
      liveblogSections(design)
    }
    .formStyle(.grouped)
  }

  // MARK: Provider

  private func providerSection(_ provider: Options.Provider?) -> some View {
    Section {
      Picker("Provider", selection: model.binding(settings, \.provider)) {
        ForEach(options.providers) { Text("\($0.name), \($0.owner)").tag($0.id) }
      }
      .pickerStyle(.radioGroup)
      .labelsHidden()
      if let provider {
        if let description = provider.description {
          Text(description).foregroundStyle(.secondary)
        }
        LabeledContent("Language", value: Locale.current.localizedString(forLanguageCode: provider.language) ?? provider.language)
        LabeledContent("Website") {
          Link(provider.homepage.host() ?? provider.homepage.absoluteString, destination: provider.homepage)
        }
      }
    } header: {
      Text("Provider")
    } footer: {
      Text("The news server lists the providers it can build a front page from.")
    }
  }

  // MARK: Feeds

  @ViewBuilder
  private func feedSections(_ provider: Options.Provider, _ design: Options.Design?) -> some View {
    let picked = settings.sections
    let feed = { (id: String) in provider.sections.first { $0.id == id } }
    let shows = options.presets.filter { $0.sections == true }.map(\.name)
    Section {
      if picked.isEmpty {
        Text(design?.sections == true ? "None: the row below the lead stories fills with other news." : "None.")
          .foregroundStyle(.secondary)
      }
      ForEach(Array(picked.enumerated()), id: \.element) { index, id in
        PickedRow(index: index, count: picked.count, title: feed(id)?.name ?? id, detail: feed(id)?.group) { offset in
          model.move(\.sections, index, by: offset)
        } remove: {
          model.toggle(\.sections, id, on: false)
        }
      }
    } header: {
      Text("Feeds on the front page")
    } footer: {
      Text(design?.sections == true
        ? "Each feed gets a place in the row below the lead stories, left to right in this order. The row has room for a few only, so put the ones you care about first; the preview under Appearance shows where it ends."
        : "\(design?.name ?? "This design") does not show feeds. \(shows.formatted(.list(type: .and))) do.")
    }

    Section("More from \(provider.name)") {
      ForEach(provider.sections.filter { !picked.contains($0.id) }) { section in
        HStack {
          Text(section.name)
          Spacer()
          Text(section.group).foregroundStyle(.secondary)
          Button("Add", systemImage: "plus.circle") { model.toggle(\.sections, section.id, on: true) }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Add \(section.name) to the front page")
        }
      }
    }
  }

  // MARK: Liveblogs

  @ViewBuilder
  private func liveblogSections(_ design: Options.Design?) -> some View {
    let picked = settings.liveblogs
    let full = picked.count >= options.maxLiveblogs
    let blog = { (id: String) in options.liveblogs.first { $0.id == id } }
    // A front page leads with them; the other designs follow one liveblog.
    let front = design?.data == "front"
    let lists = options.presets.filter { $0.live == true }.map(\.name)
    // By name: one of the designs that follow a liveblog is called Front Page.
    let fronts = options.presets.filter { $0.data == "front" }.map(\.name)
    let name = design?.name ?? "This design"
    Section {
      if picked.isEmpty {
        Text(front
          ? "None: the provider’s own lead story leads."
          : "None: the most active live liveblog is followed, or the last one updated when none is live.")
          .foregroundStyle(.secondary)
      }
      ForEach(Array(picked.enumerated()), id: \.element) { index, id in
        PickedRow(index: index, count: picked.count, title: blog(id)?.title ?? "Liveblog \(id)", detail: blog(id).map(meta)) { offset in
          model.move(\.liveblogs, index, by: offset)
        } remove: {
          model.toggle(\.liveblogs, id, on: false)
        }
      }
      Toggle("Also list the other running liveblogs", isOn: model.binding(settings, \.otherLiveblogs))
        .disabled(design?.live != true)
    } header: {
      Text("Lead liveblogs")
    } footer: {
      VStack(alignment: .leading, spacing: 4) {
        Text(front
          ? "Up to \(options.maxLiveblogs) lead the front page, the first as the main story."
          : "Up to \(options.maxLiveblogs). \(name) follows the first; the rest lead only on \(fronts.formatted(.list(type: .and))).")
        if design?.live != true {
          Text(front
            ? "\(name) does not list the other running liveblogs. \(lists.formatted(.list(type: .and))) do."
            : "The switch is for \(lists.formatted(.list(type: .and))) only.")
        }
      }
    }

    Section {
      let rest = options.liveblogs.filter { !picked.contains($0.id) }
      if rest.isEmpty {
        Text("No other liveblogs right now.").foregroundStyle(.secondary)
      }
      ForEach(rest) { blog in
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(blog.title)
            Text(meta(blog)).font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Button("Add", systemImage: "plus.circle") { model.toggle(\.liveblogs, blog.id, on: true) }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .disabled(full)
            .help(full ? "\(options.maxLiveblogs) liveblogs are picked already"
              : front ? "Lead the front page with this liveblog"
              : picked.isEmpty ? "Follow this liveblog" : "Add this liveblog after the others")
        }
      }
    } header: {
      Text("Liveblogs")
    }
  }

  private func meta(_ blog: Options.Liveblog) -> String {
    [
      blog.section,
      blog.live == true ? "Live" : blog.live == false ? "Ended" : nil,
      blog.postCount.map { "\($0) posts" },
    ].compactMap { $0 }.joined(separator: " · ")
  }
}

// One picked feed or liveblog: its place in the order, and buttons to move it
// up or down or take it out.
private struct PickedRow: View {
  let index: Int
  let count: Int
  let title: String
  let detail: String?
  let move: (Int) -> Void
  let remove: () -> Void

  var body: some View {
    HStack {
      Text("\(index + 1)")
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .frame(width: 16, alignment: .trailing)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        if let detail, !detail.isEmpty {
          Text(detail).font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer()
      Button("Move \(title) up", systemImage: "chevron.up") { move(-1) }
        .disabled(index == 0)
        .help("Move up")
      Button("Move \(title) down", systemImage: "chevron.down") { move(1) }
        .disabled(index == count - 1)
        .help("Move down")
      Button("Remove \(title)", systemImage: "minus.circle") { remove() }
        .help("Remove")
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.borderless)
  }
}
