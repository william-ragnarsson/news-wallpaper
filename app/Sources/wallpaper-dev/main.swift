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

  render --out <file.png> [--size 1512x982] [--scale 2] [--preset <id>] [--follow <liveblog id>]
         [--settings '{"margin": 80}'] [--page <url>]
      Draws the wallpaper page and writes the PNG, --size points at --scale
      pixels a point (default: the main screen's). Prints {path, width,
      height, fetchedAt, page}. --settings are changes to the saved settings
      for this picture only: checked as settings set checks them, not saved,
      and printed as settings. --preset and --follow pin the page over them.

  settings
      Prints the settings, with the defaults for what settings.json does not have.

  settings set <key>=<value>…
      Saves the changes and prints the settings. A value is JSON, or else a
      string: preset=evening margin=80 otherLiveblogs=false sections='["sport"]'.
      An unknown key or invalid value saves nothing and fails.

  options
      Prints what there is to pick from: presets, providers and their sections,
      the running liveblogs (from VRT), maxLiveblogs, maxMargin.

  Every command takes --data <folder> (default: .dev/ in this worktree), where
  settings.json is read from.
  """

struct Failure: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

// The command, the words after it, and its --name value pairs.
struct Arguments {
  var command: String?
  var words: [String] = []
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
        words.append(next)
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
  case "settings": return try await settings(arguments, environment)
  case "options": return try object(await SettingsService(environment).options())
  case "help", nil: return ["usage": usage]
  case let command?: throw Failure("Unknown command: \(command). Try help.")
  }
}

@MainActor
func settings(_ arguments: Arguments, _ environment: Environment) async throws -> [String: Any] {
  let service = SettingsService(environment)
  switch arguments.words.first {
  case nil:
    return try object(await service.get())
  case "set":
    var patch: [String: Any] = [:]
    for pair in arguments.words.dropFirst() {
      guard let equals = pair.firstIndex(of: "="), equals != pair.startIndex else { throw Failure("Expected <key>=<value>, got \(pair)") }
      let value = String(pair[pair.index(after: equals)...])
      patch[String(pair[..<equals])] = (try? JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed)) ?? value
    }
    guard !patch.isEmpty else { throw Failure("settings set needs <key>=<value>") }
    return try object(await service.update(JSONSerialization.data(withJSONObject: patch)))
  case let word?:
    throw Failure("Unknown: settings \(word). Try help.")
  }
}

@MainActor
func render(_ arguments: Arguments, _ environment: Environment) async throws -> [String: Any] {
  guard let out = arguments["out"] else { throw Failure("render needs --out <file.png>") }
  let sizes = (arguments["size"] ?? "1512x982").split(separator: "x").compactMap { Double($0) }
  guard sizes.count == 2, sizes.allSatisfy({ $0 >= 100 }) else { throw Failure("--size is <width>x<height> in points, e.g. 1512x982") }
  let scale = try arguments["scale"].map { text in
    guard let scale = Double(text), scale >= 0.5, scale <= 4 else { throw Failure("--scale is pixels a point, from 0.5 to 4, e.g. 2") }
    return CGFloat(scale)
  } ?? NSScreen.screens.first?.backingScaleFactor ?? 2

  var page = URLComponents(url: arguments["page"].flatMap(URL.init(string:)) ?? environment.page, resolvingAgainstBaseURL: true)!
  for name in ["preset", "follow"] {
    if let value = arguments[name] {
      page.queryItems = (page.queryItems ?? []).filter { $0.name != name } + [URLQueryItem(name: name, value: value)]
    }
  }

  var settings: WallpaperSettings?
  if let patch = arguments["settings"] { settings = try await SettingsService(environment).preview(Data(patch.utf8)) }
  let request = RenderRequest(page: page.url!, size: CGSize(width: sizes[0], height: sizes[1]), scale: scale, settings: settings)
  let snapshot = try await Renderer(environment).render(request)
  let file = try FileOutput(URL(filePath: out)).put(snapshot)
  var result: [String: Any] = ["path": file.path(), "width": snapshot.width, "height": snapshot.height, "page": page.url!.absoluteString]
  result["fetchedAt"] = snapshot.fetchedAt
  if let settings { result["settings"] = try object(settings) }
  return result
}

// An Encodable as what json() prints.
func object(_ value: some Encodable) throws -> [String: Any] {
  try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any] ?? [:]
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
