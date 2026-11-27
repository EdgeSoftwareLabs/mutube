import Combine
import Foundation

struct YouTubePlusSettings: Codable, Equatable {
    var adBlock: Bool = true
    var sponsorBlock: Bool = true
    var sponsor: Bool = true
    var intro: Bool = true
    var outro: Bool = true
    var selfpromo: Bool = true
    var interaction: Bool = true
    var backgroundPlay: Bool = true
    var pictureInPicture: Bool = true
    var deArrow: Bool = false
    var returnYouTubeDislike: Bool = false
    var hideShorts: Bool = false
    var debugLogging: Bool = false
    var welcomed: Bool = false

    /// JSON object passed to `window.YouTubePlus.applySettings` and the document-start prelude.
    func scriptJSON() -> String {
        let object: [String: Any] = [
            "adBlock": adBlock,
            "sponsorBlock": sponsorBlock,
            "categories": [
                "sponsor": sponsor,
                "intro": intro,
                "outro": outro,
                "selfpromo": selfpromo,
                "interaction": interaction
            ],
            "backgroundPlay": backgroundPlay,
            "pictureInPicture": pictureInPicture,
            "deArrow": deArrow,
            "returnYouTubeDislike": returnYouTubeDislike,
            "hideShorts": hideShorts,
            "debug": debugLogging
        ]
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text
    }
}

final class SettingsStore: ObservableObject {
    @Published var settings: YouTubePlusSettings {
        didSet { save() }
    }

    private let defaults: UserDefaults
    private let key = "ytplus.settings.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        settings = Self.load(from: defaults, key: key)
    }

    private static func load(from defaults: UserDefaults, key: String) -> YouTubePlusSettings {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode(YouTubePlusSettings.self, from: data) else {
            return YouTubePlusSettings()
        }
        return decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: key)
    }
}
