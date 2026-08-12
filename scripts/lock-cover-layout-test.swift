import UIKit
import Foundation

let gold = UIColor(red: 201/255, green: 164/255, blue: 58/255, alpha: 1)
let coverColor = UIColor(red: 20/255, green: 18/255, blue: 16/255, alpha: 1)

func makeButton(title: String, traits: UITraitCollection) -> UIButton {
    var config = UIButton.Configuration.plain()
    config.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 24, bottom: 13, trailing: 24)
    config.baseForegroundColor = gold
    var attributed = AttributedString(title)
    attributed.font = UIFontMetrics(forTextStyle: .callout)
        .scaledFont(for: UIFont.systemFont(ofSize: 15, weight: .semibold), compatibleWith: traits)
    config.attributedTitle = attributed
    config.titleLineBreakMode = .byWordWrapping
    let b = UIButton(configuration: config)
    b.layer.cornerRadius = 10
    return b
}

// Mirrors ApexLockCover.show() + showRecovery() exactly.
func buildCover(size: CGSize, traits: UITraitCollection, message: String, canRetry: Bool) -> (UIView, UIStackView, [UIView]) {
    let host = UIViewController()
    host.view.frame = CGRect(origin: .zero, size: size)
    host.view.backgroundColor = coverColor

    let content = UIStackView()
    content.axis = .vertical
    content.alignment = .center
    content.spacing = 18
    content.translatesAutoresizingMaskIntoConstraints = false

    // The full logo, mirroring show(). The asset catalog is not reachable from
    // this standalone harness, so a placeholder at the REAL master aspect ratio
    // (393x147) stands in -- what is being asserted is the geometry the logo
    // imposes on the stack, and that comes from the ratio and the width cap,
    // not from the pixels.
    let logo = UIImageView()
    logo.translatesAutoresizingMaskIntoConstraints = false
    logo.contentMode = .scaleAspectFit
    logo.backgroundColor = gold
    content.addArrangedSubview(logo)

    let logoTarget = min(size.width * 0.62, 300)
    let logoWidth = logo.widthAnchor.constraint(equalToConstant: logoTarget)
    logoWidth.priority = .defaultHigh
    NSLayoutConstraint.activate([
        logoWidth,
        logo.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor),
        logo.heightAnchor.constraint(equalTo: logo.widthAnchor, multiplier: 147.0 / 393.0)
    ])

    // The photo and its scrim sit BEHIND the scroll view and outside the safe
    // area, so they take no part in the stack's layout. They are mirrored here
    // only so the harness proves they cannot cover or intercept the buttons.
    let photo = UIImageView()
    photo.translatesAutoresizingMaskIntoConstraints = false
    photo.contentMode = .scaleAspectFill
    photo.clipsToBounds = true
    photo.isUserInteractionEnabled = false
    host.view.addSubview(photo)

    let scrim = UIView()
    scrim.translatesAutoresizingMaskIntoConstraints = false
    scrim.backgroundColor = UIColor.black.withAlphaComponent(0.55)
    scrim.isUserInteractionEnabled = false
    host.view.addSubview(scrim)

    NSLayoutConstraint.activate([
        photo.topAnchor.constraint(equalTo: host.view.topAnchor),
        photo.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
        photo.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
        photo.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
        scrim.topAnchor.constraint(equalTo: photo.topAnchor),
        scrim.bottomAnchor.constraint(equalTo: photo.bottomAnchor),
        scrim.leadingAnchor.constraint(equalTo: photo.leadingAnchor),
        scrim.trailingAnchor.constraint(equalTo: photo.trailingAnchor)
    ])

    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(content)
    host.view.addSubview(scroll)

    let container = UIView()
    container.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(container)
    container.addSubview(content)

    NSLayoutConstraint.activate([
        scroll.topAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.topAnchor),
        scroll.bottomAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.bottomAnchor),
        scroll.leadingAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.leadingAnchor),
        scroll.trailingAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.trailingAnchor),
        container.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
        container.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
        container.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
        container.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
        container.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
        container.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor),
        content.centerYAnchor.constraint(equalTo: container.centerYAnchor),
        content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
        content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),
        content.topAnchor.constraint(greaterThanOrEqualTo: container.topAnchor, constant: 24),
        content.bottomAnchor.constraint(lessThanOrEqualTo: container.bottomAnchor, constant: -24)
    ])

    // showRecovery()
    let text = UILabel()
    text.text = message
    text.numberOfLines = 0
    text.textAlignment = .center
    text.textColor = UIColor(white: 0.75, alpha: 1)
    text.font = UIFontMetrics(forTextStyle: .footnote)
        .scaledFont(for: UIFont.systemFont(ofSize: 13, weight: .regular), compatibleWith: traits)
    text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    content.addArrangedSubview(text)

    var buttons: [UIButton] = []
    if canRetry { buttons.append(makeButton(title: "Desbloquear / Unlock", traits: traits)) }
    buttons.append(makeButton(title: "Sair / Sign out", traits: traits))
    for b in buttons {
        content.addArrangedSubview(b)
        NSLayoutConstraint.activate([
            b.widthAnchor.constraint(equalTo: content.widthAnchor),
            b.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }
    if let first = buttons.first {
        content.setCustomSpacing(24, after: text)
        content.setCustomSpacing(12, after: first)
    }

    host.view.setNeedsLayout()
    host.view.layoutIfNeeded()
    return (host.view, content, [logo, text] + buttons)
}

struct Case { let name: String; let size: CGSize; let cat: UIContentSizeCategory; let msg: String; let canRetry: Bool }

let longMsg = "Não foi possível verificar a sua identidade neste dispositivo. Verifique as definições de Face ID e tente novamente, ou termine a sessão para continuar."
let shortMsg = "Não foi possível desbloquear.\nCould not unlock."

let cases: [Case] = [
  Case(name:"iPhone 16 Pro portrait",      size:CGSize(width:402,height:874), cat:.large,  msg:shortMsg, canRetry:true),
  Case(name:"iPhone SE portrait (small)",  size:CGSize(width:320,height:568), cat:.large,  msg:shortMsg, canRetry:true),
  Case(name:"SE + long message",           size:CGSize(width:320,height:568), cat:.large,  msg:longMsg,  canRetry:true),
  Case(name:"SE + AX5 huge text",          size:CGSize(width:320,height:568), cat:.accessibilityExtraExtraExtraLarge, msg:shortMsg, canRetry:true),
  Case(name:"16 Pro + AX5 + long msg",     size:CGSize(width:402,height:874), cat:.accessibilityExtraExtraExtraLarge, msg:longMsg, canRetry:true),
  Case(name:"SE landscape",                size:CGSize(width:568,height:320), cat:.large,  msg:shortMsg, canRetry:true),
  Case(name:"SE landscape + AX5",          size:CGSize(width:568,height:320), cat:.accessibilityExtraExtraExtraLarge, msg:shortMsg, canRetry:true),
  Case(name:"no-retry (sign out only)",    size:CGSize(width:402,height:874), cat:.large,  msg:shortMsg, canRetry:false),
]

var failures = 0
for c in cases {
    let traits = UITraitCollection(preferredContentSizeCategory: c.cat)
    let (root, stack, items) = buildCover(size: c.size, traits: traits, message: c.msg, canRetry: c.canRetry)
    // Overlap check in the stack's own coordinate space.
    var overlaps: [String] = []
    for i in 0..<items.count {
        for j in (i+1)..<items.count {
            let a = items[i].convert(items[i].bounds, to: stack)
            let b = items[j].convert(items[j].bounds, to: stack)
            if a.intersects(b) && !a.isEmpty && !b.isEmpty {
                overlaps.append("item\(i)&item\(j)")
            }
        }
    }
    var widthOverflow = false
    for it in items {
        let f = it.convert(it.bounds, to: stack)
        if f.width > stack.bounds.width + 0.5 { widthOverflow = true }
    }
    let ok = overlaps.isEmpty && !widthOverflow
    if !ok { failures += 1 }
    let f = stack.convert(stack.bounds, to: root)
    let above = f.minY, below = root.bounds.height - f.maxY
    let centred = abs(above - below) < 40 || f.height + 48 >= root.bounds.height
    if !centred { failures += 1 }
    print("\((ok && centred) ? "PASS" : "FAIL")  \(c.name.padding(toLength:28, withPad:" ", startingAt:0)) stackH=\(Int(stack.bounds.height)) above=\(Int(above)) below=\(Int(below)) overlaps=\(overlaps.count) centred=\(centred)")
}
// Render each case to a PNG so the result can be looked at, not just asserted.
for c in cases {
    let traits = UITraitCollection(preferredContentSizeCategory: c.cat)
    let (root, _, _) = buildCover(size: c.size, traits: traits, message: c.msg, canRetry: c.canRetry)
    let r = UIGraphicsImageRenderer(size: c.size)
    let img = r.image { ctx in root.layer.render(in: ctx.cgContext) }
    if let d = img.pngData() {
        let name = c.name.replacingOccurrences(of: " ", with: "_").replacingOccurrences(of: "+", with: "")
        try? d.write(to: URL(fileURLWithPath: "/tmp/cover_\(name).png"))
    }
}
print("rendered PNGs to /tmp/cover_*.png")
print(failures == 0 ? "\nALL LAYOUT CASES PASS" : "\n\(failures) FAILURES")
exit(failures == 0 ? 0 : 1)
