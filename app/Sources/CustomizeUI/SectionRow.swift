import Combine
import SwiftUI

// One of the provider's sections: its place on the front page (when it is
// on it), its name, how many items the news fetched last has from it, and
// its latest few headlines; a handle to show it can be dragged, and a button
// (`accessory`) to take it off or add it.
struct SectionRow<Accessory: View>: View {
  let section: SourcesDigest.Section
  let place: Int?
  let targeted: Bool  // something is dragged over it
  @ViewBuilder let accessory: Accessory

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: "line.3.horizontal")
        .foregroundStyle(.tertiary)
        .help("Drag to move")
      if let place {
        Text("\(place)")
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .frame(minWidth: 14, alignment: .trailing)
      }
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(section.name).fontWeight(.medium)
          Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        ForEach(section.stories) { story in
          HStack(alignment: .firstTextBaseline) {
            Text(story.title).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            if let time = story.time {
              Text(Relative.text(time)).foregroundStyle(.tertiary)
            }
          }
          .font(.callout)
          .foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      accessory
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
    }
    .padding(.vertical, 2)
    .contentShape(Rectangle())
    .background { DropHighlight(on: targeted) }
  }

  private var detail: String {
    [section.group, section.items.map { $0 == 1 ? "1 item" : "\($0) items" }].compactMap { $0 }.joined(separator: " · ")
  }
}

// Where a dragged section goes.
struct DropHighlight: View {
  let on: Bool

  var body: some View {
    if on {
      RoundedRectangle(cornerRadius: 6).fill(Color.accentColor.opacity(0.18)).padding(-4)
    }
  }
}

// What follows the pointer while a section is dragged.
struct DragLabel: View {
  let name: String

  var body: some View {
    Label(name, systemImage: "line.3.horizontal")
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
  }
}

// The row something is being dragged over, to show where it goes: a
// StateObject, as @State's macro plugin does not come with the Command Line
// Tools.
final class DropTarget: ObservableObject {
  @Published var id: String?  // "" for an empty list

  func over(_ over: Bool, _ row: String) {
    if over { id = row } else if id == row { id = nil }
  }
}
