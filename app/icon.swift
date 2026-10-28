// Draws the app icon, a small front page in Newsprint's paper and ink, and
// makes AppIcon.icns from it with iconutil (part of macOS, no Xcode needed).
// bundle.sh copies the .icns; run this only to change the icon:
//   swift app/icon.swift
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

func color(_ hex: Int, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(
    srgbRed: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255,
    blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

// public/presets/newsprint/preset.css
let paper = color(0xf1ebdd)
let ink = color(0x1c1915)
let ink2 = color(0x3f3a33)
let ink3 = color(0x6e665a)
let accent = color(0x9d2219)

// On a 1024 grid, top down. The page is the tile of Apple's macOS icon
// template: 824 square, 100 in from each side, corners of 185.4.
func draw(_ ctx: CGContext) {
  ctx.translateBy(x: 0, y: 1024)
  ctx.scaleBy(x: 1, y: -1)
  let tile = CGPath(
    roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824),
    cornerWidth: 185.4, cornerHeight: 185.4, transform: nil)
  ctx.addPath(tile)
  ctx.clip()
  let shade = CGGradient(
    colorsSpace: nil, colors: [color(0xf5f0e4), color(0xe9e1cf)] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(shade, start: CGPoint(x: 0, y: 100), end: CGPoint(x: 0, y: 924), options: [])
  ctx.addPath(tile)
  ctx.setStrokeColor(color(0x1c1915, 0.16))
  ctx.setLineWidth(6)
  ctx.strokePath()

  func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ fill: CGColor) {
    ctx.setFillColor(fill)
    ctx.fill(CGRect(x: x, y: y, width: w, height: h))
  }
  // A line of text: rounded ends, like type seen from afar.
  func line(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ fill: CGColor) {
    ctx.setFillColor(fill)
    ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: h / 2, cornerHeight: h / 2, transform: nil))
    ctx.fillPath()
  }

  // The nameplate, in Bodoni 72 as Newsprint's flag falls back to, 600 wide.
  let name = "Headlines" as CFString
  func nameplate(_ size: CGFloat) -> CTLine {
    let font = CTFontCreateWithName("BodoniSvtyTwoITCTT-Bold" as CFString, size, nil)
    let text = CFAttributedStringCreate(
      nil, name,
      [kCTFontAttributeName: font, kCTForegroundColorAttributeName: ink] as CFDictionary)!
    return CTLineCreateWithAttributedString(text)
  }
  let size = 100 * 600 / CTLineGetTypographicBounds(nameplate(100), nil, nil, nil)
  let flag = nameplate(size)
  let cap = CTFontGetCapHeight(CTFontCreateWithName("BodoniSvtyTwoITCTT-Bold" as CFString, size, nil))
  let baseline = 188 + cap
  ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
  ctx.textPosition = CGPoint(x: 212, y: baseline)
  CTLineDraw(flag, ctx)

  // Thin rule over thick, as under Newsprint's flag.
  let rules = baseline + 26
  box(180, rules, 664, 4, ink)
  box(180, rules + 12, 664, 12, ink)

  // The lead story: a live kicker in the accent, then a two-line headline.
  let lead = rules + 60
  line(180, lead, 120, 16, accent)
  line(180, lead + 34, 664, 40, ink)
  line(180, lead + 90, 460, 40, ink)

  // Two columns under it, a hairline between them.
  let top = lead + 170
  let bottom: CGFloat = 852
  box(510, top, 4, bottom - top, color(0x1c1915, 0.3))
  // A photo, in black and white: a sun over hills.
  let photo = CGRect(x: 180, y: top, width: 306, height: 176)
  ctx.saveGState()
  ctx.clip(to: photo)
  box(photo.minX, photo.minY, photo.width, photo.height, color(0xb3aa99))
  ctx.setFillColor(paper)
  ctx.fillEllipse(in: CGRect(x: 380, y: top + 30, width: 56, height: 56))
  ctx.setFillColor(ink2)
  ctx.move(to: CGPoint(x: photo.minX, y: photo.maxY))
  ctx.addLine(to: CGPoint(x: photo.minX, y: top + 120))
  ctx.addCurve(
    to: CGPoint(x: photo.maxX, y: top + 104), control1: CGPoint(x: 260, y: top + 60),
    control2: CGPoint(x: 360, y: top + 150))
  ctx.addLine(to: CGPoint(x: photo.maxX, y: photo.maxY))
  ctx.fillPath()
  ctx.restoreGState()

  let pitch: CGFloat = 32
  func column(_ x: CGFloat, from y: CGFloat, ends: [Int]) {
    var y = y
    var n = 0
    while y + 14 <= bottom {
      line(x, y, ends.contains(n) ? 200 : 306, 14, ink3)
      y += pitch
      n += 1
    }
  }
  column(180, from: photo.maxY + 24, ends: [2])
  column(538, from: top + 2, ends: [3, 8])
}

let sizes: [(Int, String)] = [
  (16, "16x16"), (32, "16x16@2x"), (32, "32x32"), (64, "32x32@2x"), (128, "128x128"),
  (256, "128x128@2x"), (256, "256x256"), (512, "256x256@2x"), (512, "512x512"), (1024, "512x512@2x"),
]
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let iconset = FileManager.default.temporaryDirectory.appendingPathComponent("AppIcon-\(UUID()).iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: iconset) }

for (pixels, name) in sizes {
  let ctx = CGContext(
    data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
  draw(ctx)
  let url = iconset.appendingPathComponent("icon_\(name).png")
  let png = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(png, ctx.makeImage()!, nil)
  guard CGImageDestinationFinalize(png) else { fatalError("could not write \(url.path)") }
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", "-o", here.appendingPathComponent("AppIcon.icns").path, iconset.path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Made \(here.appendingPathComponent("AppIcon.icns").path)")
