import Foundation

/// Turns a `youtubeplus://` URL into a page the web view can load.
/// Matches `platforms/ios/js/open-url.js` (covered by `tests/ios-open-url.js`).
enum YouTubeLink {
    static func mobileURL(from url: URL) -> URL? {
        guard url.scheme?.lowercased() == "youtubeplus" else { return nil }
        let host = url.host?.lowercased() ?? ""
        if host == "open" {
            guard let raw = queryValue("url", in: url), let inner = URL(string: raw) else { return nil }
            return normalize(inner)
        }
        if host == "watch" {
            guard let id = queryValue("v", in: url), isVideoID(id) else { return nil }
            return watchURL(videoID: id, copying: url)
        }
        if host == "youtu.be" || host.hasSuffix(".youtu.be") {
            guard let id = firstPathComponent(url.path), isVideoID(id) else { return nil }
            return watchURL(videoID: id, copying: url)
        }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = "https"
        guard let https = components.url else { return nil }
        return normalize(https)
    }

    private static func normalize(_ url: URL) -> URL? {
        guard let host = url.host?.lowercased(), url.scheme == "https" || url.scheme == "http" else { return nil }
        if isBlocked(host: host, path: url.path) { return nil }
        if host == "youtu.be" || host.hasSuffix(".youtu.be") {
            guard let id = firstPathComponent(url.path), isVideoID(id) else { return nil }
            return watchURL(videoID: id, copying: url)
        }
        if host == "music.youtube.com" || host == "studio.youtube.com" || host == "tv.youtube.com" || host == "kids.youtube.com" {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.scheme = "https"
            return components?.url
        }
        guard host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com" else { return nil }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = "https"
        components?.host = "m.youtube.com"
        return components?.url
    }

    private static func watchURL(videoID: String, copying url: URL) -> URL? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "m.youtube.com"
        components.path = "/watch"
        var items = [URLQueryItem(name: "v", value: videoID)]
        let extras = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        for item in extras where item.name != "v" {
            items.append(item)
        }
        components.queryItems = items
        return components.url
    }

    private static func queryValue(_ name: String, in url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == name }?
            .value
    }

    private static func firstPathComponent(_ path: String) -> String? {
        path.split(separator: "/").first.map(String.init)
    }

    private static func isVideoID(_ value: String) -> Bool {
        value.range(of: #"^[\w-]{11}$"#, options: .regularExpression) != nil
    }

    private static func isBlocked(host: String, path: String) -> Bool {
        if host == "accounts.google.com" || host.hasSuffix(".accounts.google.com") { return true }
        if host == "accounts.youtube.com" || host == "myaccount.google.com" { return true }
        if host == "consent.google.com" || host == "consent.youtube.com" { return true }
        if host.hasPrefix("accounts.") { return true }
        let lowered = path.lowercased()
        return lowered.contains("/signin") || lowered.contains("/oauth") ||
            lowered.contains("servicelogin") || lowered.contains("/account")
    }
}
