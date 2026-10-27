import AppKit
import WallpaperCore
import WallpaperRender

// wallpaper-dev: the app's parts from the command line, for agents (and
// anyone trying a change). It runs in this worktree only: its settings live
// in .dev/, and it never touches the desktop picture, the installed app or
// its settings. Every command prints one JSON object; a failure prints
// {"error": …} and exits 1.
//
//   swift run --package-path app --build-system native wallpaper-dev help

let usage = """
  wallpaper-dev <command> [options]

  render --out <file.png> [--size 1512x982] [--preset <id>] [--follow <liveblog id>] [--page <url>]
      Draws the wallpaper page and writes the PNG. Prints {path, width, height}.
      The pixel size is the size times the main screen's scale.

  Every command takes --data <folder> (default: .dev/ in this worktree), where
  settings.json is read from.
  """

struct Failure: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

// The command and its --name value pairs.
struct Arguments {
  var command: String?
  var values: [String: String] = [:]

  init(_ arguments: [String]) throws {
    var rest = arguments[...]
    while let next = rest.popFirst() {
      if next.hasPrefix("--") {
        guard let value = rest.popFirst() else { throw Failure("\(next) needs a value") }
        values[String(next.dropFirst(2))] = value
      } else if command == nil {
        command = next
      } else {
        throw Failure("Unexpected argument: \(next)")
      }
    }
  }

  subscript(name: String) -> String? { values[name] }
}

@MainActor
func run(_ arguments: Arguments) async throws -> [String: Any] {
  let environment = Environment.dev(data: arguments["data"].map { URL(filePath: $0, directoryHint: .isDirectory) })
  switch arguments.command {
  case "render": return try await render(arguments, environment)
  case "help", nil: return ["usage": usage]
  case let command?: throw Failure("Unknown command: \(command). Try help.")
  }
}

@MainActor
func render(_ arguments: Arguments, _ environment: Environment) async throws -> [String: Any] {
  guard let out = arguments["out"] else { throw Failure("render needs --out <file.png>") }
  let sizes = (arguments["size"] ?? "1512x982").split(separator: "x").compactMap { Double($0) }
  guard sizes.count == 2, sizes.allSatisfy({ $0 >= 100 }) else { throw Failure("--size is <width>x<height> in points, e.g. 1512x982") }

  var page = URLComponents(url: arguments["page"].flatMap(URL.init(string:)) ?? environment.page, resolvingAgainstBaseURL: true)!
  for name in ["preset", "follow"] {
    if let value = arguments[name] {
      page.queryItems = (page.queryItems ?? []).filter { $0.name != name } + [URLQueryItem(name: name, value: value)]
    }
  }

  // At the main screen's corner, so the page gets its pixel density.
  let origin = NSScreen.screens.first?.frame.origin ?? .zero
  let snapshot = try await Renderer(environment).render(page.url!, in: CGRect(origin: origin, size: CGSize(width: sizes[0], height: sizes[1])))
  let file = URL(filePath: out)
  try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
  try snapshot.png.write(to: file, options: .atomic)
  return ["path": file.path(), "width": snapshot.width, "height": snapshot.height, "page": page.url!.absoluteString]
}

func json(_ object: [String: Any]) -> String {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
  return String(decoding: data, as: UTF8.self)
}

// A web view needs an app and its run loop, but this one shows nothing: no
// Dock icon, no menu bar, no windows on screen.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
Task {
  do {
    let result = try await run(Arguments(Array(CommandLine.arguments.dropFirst())))
    if let text = result["usage"] as? String { print(text) } else { print(json(result)) }
    exit(0)
  } catch {
    print(json(["error": "\(error)"]))
    exit(1)
  }
}
app.run()
