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
    private static var didActivate = false
    private static var nowInfo: [String: Any] = [:]
    private static var artworkURL = ""
    private static var artworkTask: URLSessionDataTask?

    /// Category is set once. Calling `setActive` again while a video is
    /// starting interrupts WebKit and the player drops into the buffer spinner.
    static func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            if !didActivate {
                try session.setActive(true)
                didActivate = true
            }
        } catch {
            NSLog("[YouTube+] AVAudioSession: %@", error.localizedDescription)
        }
    }

    /// The app is leaving the foreground. Activate again so locked-screen audio keeps the session.
    static func activateForBackground() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
            didActivate = true
        } catch {
            NSLog("[YouTube+] AVAudioSession: %@", error.localizedDescription)
        }
    }

    static func attach(_ webView: WKWebView) {
        self.webView = webView
        configure()
        installCommands()
        installLifecycle()
    }

    private static var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private static var lifecycleInstalled = false
    private static var holdGeneration = 0
    private static var nudgeItems: [DispatchWorkItem] = []

    /// Scene is no longer active. Keep the audio session and ask the page to
    /// resume a video the user had not paused. Retries run inside a background
    /// task because WebKit suspends the page as soon as the screen locks.
    static func keepAlive() {
        holdInBackground()
    }

    static func holdInBackground() {
        activateForBackground()
        webView?.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        // willResignActive and the scene phase both call this. Cancelling the
        // nudges we just scheduled drops the resume, and audio stops.
        if backgroundTask != .invalid {
            nudge(true, holdGeneration)
            return
        }
        holdGeneration += 1
        let generation = holdGeneration
        if backgroundTask == .invalid {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "YouTubePlusAudio") {
                endHold()
            }
        }
        scheduleNudge(generation, 0, true)
        scheduleNudge(generation, 0.25, false)
        scheduleNudge(generation, 0.75, false)
        if !nowInfo.isEmpty {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nowInfo
        }
    }

    static func returnToForeground() {
        // Drop every pending 250/750ms retry before the page can call play()
        // over a pause the user just made. Do not do this while backgrounding.
        holdGeneration += 1
        let retired = holdGeneration
        cancelNudges()
        endHold()
        webView?.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        webView?.evaluateJavaScript("window.YouTubePlus&&window.YouTubePlus.setAppActive(true, \(retired));", completionHandler: nil)
    }

    static func installLifecycle() {
        if lifecycleInstalled { return }
        lifecycleInstalled = true
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            holdInBackground()
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            returnToForeground()
        }
        center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            returnToForeground()
        }
    }

    private static func scheduleNudge(_ generation: Int, _ delay: Double, _ force: Bool) {
        let item = DispatchWorkItem {
            guard generation == holdGeneration else { return }
            nudge(force, generation)
            if delay >= 0.75 { endHold() }
        }
        nudgeItems.append(item)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private static func cancelNudges() {
        nudgeItems.forEach { $0.cancel() }
        nudgeItems.removeAll()
    }

    private static func nudge(_ force: Bool, _ generation: Int) {
        webView?.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        let flag = force ? "true" : "false"
        webView?.evaluateJavaScript(
            "window.YouTubePlus&&window.YouTubePlus.holdForBackground(\(flag), \(generation));",
            completionHandler: nil
        )
    }

    private static func endHold() {
        if backgroundTask == .invalid { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    static func update(from body: [String: Any]) {
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
        center.skipForwardCommand.addTarget { _ in
            // Always 10. The event interval is 5 when WebKit's media session owns the button.
            run("skip", 10)
            return .success
        }
        center.skipBackwardCommand.addTarget { _ in
            run("skip", -10)
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let change = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            run("seek", change.positionTime)
            return .success
        }
    }

    private static func run(_ name: String, _ value: Double?) {
        activateForBackground()
        let js: String
        if let value {
            js = "window.YouTubePlus&&window.YouTubePlus.remoteCommand('\(name)',\(value));"
        } else {
            js = "window.YouTubePlus&&window.YouTubePlus.remoteCommand('\(name)');"
        }
        let box = RemoteTask()
        box.id = UIApplication.shared.beginBackgroundTask(withName: "YouTubePlusRemote") {
            box.end()
        }
        func attempt(_ remaining: Int) {
            guard let webView else {
                box.end()
                return
            }
            webView.evaluateJavaScript(js) { _, error in
                if error != nil && remaining > 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        attempt(remaining - 1)
                    }
                    return
                }
                box.end()
            }
        }
        DispatchQueue.main.async {
            attempt(2)
        }
    }
}

private final class RemoteTask {
    var id: UIBackgroundTaskIdentifier = .invalid
    func end() {
        if id == .invalid { return }
        let ending = id
        id = .invalid
        UIApplication.shared.endBackgroundTask(ending)
    }
}
