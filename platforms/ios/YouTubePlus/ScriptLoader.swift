import Foundation
import WebKit

enum ScriptLoader {
    static func userScript() -> String {
        guard let url = Bundle.main.url(forResource: "youtube-plus-ios", withExtension: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8),
              !text.isEmpty else {
            return "console.error('[YouTube+] injected script missing from the app bundle');"
        }
        return text
    }

    static func contentRulesJSON() -> String? {
        guard let url = Bundle.main.url(forResource: "content-rules", withExtension: "json") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    static func prelude(for settings: YouTubePlusSettings) -> String {
        "window.YTPLUS_CONFIG = \(settings.scriptJSON());"
    }

    static func compileRules(_ completion: @escaping (WKContentRuleList?) -> Void) {
        guard let json = contentRulesJSON() else {
            completion(nil)
            return
        }
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "com.edgesoftwarelabs.youtubeplus.ads",
            encodedContentRuleList: json
        ) { list, error in
            if let error {
                NSLog("[YouTube+] content rules: %@", error.localizedDescription)
            }
            completion(list)
        }
    }
}
