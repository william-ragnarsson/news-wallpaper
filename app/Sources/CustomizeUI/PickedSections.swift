import Combine
import SwiftUI

// The sections on the front page, in the order of the row below the lead
// stories. Drag one onto another to put it in that one's place, or onto the
// sections below to take it off; one dragged up from there goes where it is
// dropped.
struct PickedSections: View {
  let digest: SourcesDigest
  @Binding var sections: [String]
  @StateObject private var drop = DropTarget()

  var body: some View {
    Section {
      if digest.picked.isEmpty {
        Text(digest.showsSections ? "None: the row below the lead stories fills with other news." : "None.")
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background { DropHighlight(on: drop.id == "") }
          .dropDestination(for: String.self) { ids, _ in place(ids, at: nil) } isTargeted: { over in
            drop.over(over, "")
          }
      }
      ForEach(Array(digest.picked.enumerated()), id: \.element.id) { index, section in
        SectionRow(section: section, place: index + 1, targeted: drop.id == section.id) {
          Button("Remove \(section.name)", systemImage: "minus.circle") { set(digest.removing(section.id)) }
            .help("Take \(section.name) off the front page")
        }
        .draggable(section.id) { DragLabel(name: section.name) }
        .dropDestination(for: String.self) { ids, _ in place(ids, at: section.id) } isTargeted: { over in
          drop.over(over, section.id)
        }
        .contextMenu {
          Button("Move Up") { set(digest.moving(section.id, by: -1)) }
            .disabled(index == 0)
          Button("Move Down") { set(digest.moving(section.id, by: 1)) }
            .disabled(index == digest.picked.count - 1)
          Divider()
          Button("Remove from Front Page") { set(digest.removing(section.id)) }
        }
      }
    } header: {
      Text("Sections on the front page")
    } footer: {
      Text(digest.showsSections
        ? "Each gets a place in the row below the lead stories, left to right in this order: drag one to move it. The row has room for a few only, so put the ones you care about first; the preview under Appearance shows where it ends."
        : "\(digest.design?.name ?? "This design") does not show sections. \(digest.sectionDesigns.formatted(.list(type: .and))) do.")
    }
  }

  private func place(_ ids: [String], at target: String?) -> Bool {
    drop.id = nil
    guard let id = ids.first, let next = digest.placing(id, at: target) else { return false }
    sections = next
    return true
  }

  private func set(_ next: [String]?) {
    if let next { sections = next }
  }
}
