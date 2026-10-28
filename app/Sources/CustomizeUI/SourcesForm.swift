import SwiftUI
import WallpaperCore

// Customize → Sources (M5): what news the front page has, top to bottom as it
// is on the desktop. The running live stories that lead it, the provider's
// sections in the row below them, dragged into their order, the sections
// there are to add, and last the provider they all come from. All of it is
// the digest's, from the stored news; nothing here goes to the network. Each
// binding saves the setting it is for.
public struct SourcesForm: View {
  let digest: SourcesDigest
  @Binding var provider: String
  @Binding var liveFirst: Bool
  @Binding var sections: [String]

  public init(digest: SourcesDigest, provider: Binding<String>, liveFirst: Binding<Bool>, sections: Binding<[String]>) {
    self.digest = digest
    _provider = provider
    _liveFirst = liveFirst
    _sections = sections
  }

  public var body: some View {
    Form {
      LiveSection(digest: digest, liveFirst: $liveFirst)
      if digest.provider != nil {
        PickedSections(digest: digest, sections: $sections)
        OtherSections(digest: digest, sections: $sections)
      }
      ProviderSection(digest: digest, provider: $provider)
    }
    .formStyle(.grouped)
  }
}
