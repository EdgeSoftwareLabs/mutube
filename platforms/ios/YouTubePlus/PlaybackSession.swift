import AVFoundation
import MediaPlayer
import UIKit
import WebKit

/// Keeps YouTube audio in the playback session so it continues in the
/// background and with the screen locked, and publishes the lock screen
/// and Control Center controls. `UIBackgroundModes` includes `audio`.
enum PlaybackSession {
    private static weak var webView: WKWebView?
    private static var commandsInstalled = false
    private static var nowInfo: [String: Any] = [:]
    private static var artworkURL = ""
    private static var artworkTask: URLSessionDataTask?

    static func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
        } catch {
            NSLog("[YouTube+] AVAudioSession: %@", error.localizedDescription)
        }
    }

    static func attach(_ webView: WKWebView) {
        self.webView = webView
        configure()
        installCommands()
    }

    /// Scene is no longer active. Leave media running and put our now-playing
    /// info back in case WebKit cleared it while hiding the page.
    static func keepAlive() {
        configure()
        webView?.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        if !nowInfo.isEmpty {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nowInfo
        }
    }

    static func update(from body: [String: Any]) {
        configure()
        var info = nowInfo
        if let title = body["title"] as? String, !title.isEmpty {
            info[MPMediaItemPropertyTitle] = title
        }
        if let author = body["author"] as? String {
            info[MPMediaItemPropertyArtist] = author
        }
        if let duration = number(body["duration"]), duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let elapsed = number(body["elapsed"]), elapsed >= 0 {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = number(body["rate"]) ?? 0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        nowInfo = info
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if let art = body["artwork"] as? String, !art.isEmpty, art != artworkURL, let url = URL(string: art) {
            loadArtwork(url)
        }
    }

    private static func number(_ value: Any?) -> Double? {
        if let n = value as? Double { return n }
        if let n = value as? Int { return Double(n) }
        if let n = value as? NSNumber { return n.doubleValue }
        return nil
    }

    private static func loadArtwork(_ url: URL) {
        artworkURL = url.absoluteString
        artworkTask?.cancel()
        artworkTask = URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            let item = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard artworkURL == url.absoluteString else { return }
                nowInfo[MPMediaItemPropertyArtwork] = item
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nowInfo
            }
        }
        artworkTask?.resume()
    }

    private static func installCommands() {
        if commandsInstalled { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
        center.skipForwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.isEnabled = true
        center.skipBackwardCommand.preferredIntervals = [10]
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true

        center.playCommand.addTarget { _ in
            run("play", nil)
            return .success
        }
        center.pauseCommand.addTarget { _ in
            run("pause", nil)
            return .success
        }
        center.togglePlayPauseCommand.addTarget { _ in
            run("toggle", nil)
            return .success
        }
        center.skipForwardCommand.addTarget { event in
            let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 10
            run("skip", interval)
            return .success
        }
        center.skipBackwardCommand.addTarget { event in
            let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 10
            run("skip", -interval)
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let change = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            run("seek", change.positionTime)
            return .success
        }
    }

    private static func run(_ name: String, _ value: Double?) {
        let js: String
        if let value {
            js = "window.YouTubePlus&&window.YouTubePlus.remoteCommand('\(name)',\(value));"
        } else {
            js = "window.YouTubePlus&&window.YouTubePlus.remoteCommand('\(name)');"
        }
        DispatchQueue.main.async {
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
