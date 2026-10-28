import Combine
import SwiftUI

// The provider's sections that are not on the front page, to add: + puts one
// at the end of the row, or drag it to its place above. One dragged down here
// from above comes off the front page.
struct OtherSections: View {
  let digest: SourcesDigest
  @Binding var sections: [String]
  @StateObject private var drop = DropTarget()

  var body: some View {
    let name = digest.provider?.name ?? "the provider"
    Section {
      if digest.others.isEmpty {
        Text("All of \(name)’s sections are on the front page.").foregroundStyle(.secondary)
      }
      ForEach(digest.others) { section in
        SectionRow(section: section, place: nil, targeted: drop.id == section.id) {
          Button("Add \(section.name)", systemImage: "plus.circle") { add(section.id) }
            .help("Add \(section.name) to the front page")
        }
        .draggable(section.id) { DragLabel(name: section.name) }
        .dropDestination(for: String.self) { ids, _ in remove(ids) } isTargeted: { over in
          drop.over(over, section.id)
        }
        .contextMenu {
          Button("Add to Front Page") { add(section.id) }
        }
      }
    } header: {
      Text("Other sections from \(name)")
    } footer: {
      Text("+ adds one at the end of the row; or drag it to its place above.")
    }
  }

  private func add(_ id: String) {
    if let next = digest.placing(id, at: nil) { sections = next }
  }

  private func remove(_ ids: [String]) -> Bool {
    drop.id = nil
    guard let next = ids.first.flatMap(digest.removing) else { return false }
    sections = next
    return true
  }
}
