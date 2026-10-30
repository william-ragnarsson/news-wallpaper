import SwiftUI

// The running live stories (liveblogs, live pages), in the order liveFirst
// leads the front page with them, and the toggle.
struct LiveSection: View {
  let digest: SourcesDigest
  @Binding var liveFirst: Bool

  var body: some View {
    Section {
      Toggle("Running live stories first", isOn: $liveFirst)
        .disabled(!digest.showsFront)
      if let live = digest.live {
        if live.isEmpty {
          Text("None running now.").foregroundStyle(.secondary)
        }
        ForEach(Array(live.enumerated()), id: \.element.id) { index, story in
          LiveRow(story: story, place: liveFirst && digest.showsFront ? Self.place(index) : nil)
        }
      } else if case .current = digest.news {
        Text("None in the news fetched last.").foregroundStyle(.secondary)
      } else {
        Text("The running live stories show here once \(digest.provider?.name ?? "the provider")’s news is fetched.").foregroundStyle(.secondary)
      }
    } header: {
      Text("Live now")
    } footer: {
      Text(footer)
    }
  }

  private var footer: String {
    guard digest.showsFront else { return "For \(digest.frontDesigns.formatted(.list(type: .and))) only." }
    let name = digest.provider?.name ?? "the provider"
    return "On: they lead the front page, newest first. The first is the lead story and the others take the places after it. "
      + "Off: the front page keeps the order \(name) gives it. A story counts as running while it is marked live and was updated in the last 12 hours."
  }

  private static func place(_ index: Int) -> String {
    guard index > 0 else { return "Lead story" }
    let ordinal = NumberFormatter()
    ordinal.numberStyle = .ordinal
    return "\(ordinal.string(from: index + 1 as NSNumber) ?? "\(index + 1)") story"
  }
}

private struct LiveRow: View {
  let story: SourcesDigest.Story
  let place: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      LiveBadge()
      VStack(alignment: .leading, spacing: 2) {
        Text(story.title).lineLimit(2)
        let detail = [place, story.time.map(Relative.text)].compactMap { $0 }
        if !detail.isEmpty {
          Text(detail.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
        }
      }
    }
  }
}

// LIVE, as the front page marks a running story.
struct LiveBadge: View {
  var body: some View {
    Text("LIVE")
      .font(.caption2.weight(.bold))
      .foregroundStyle(.white)
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(.red, in: RoundedRectangle(cornerRadius: 3))
      .accessibilityLabel("Live")
  }
}

// "12 min. ago": when a story was published or last updated.
enum Relative {
  static func text(_ date: Date) -> String {
    date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
  }
}
