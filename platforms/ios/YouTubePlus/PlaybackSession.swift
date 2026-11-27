import AVFoundation

/// Keeps YouTube audio in the playback session so it continues in the
/// background and with the screen locked. `UIBackgroundModes` includes `audio`.
enum PlaybackSession {
    static func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
        } catch {
            NSLog("[YouTube+] AVAudioSession: %@", error.localizedDescription)
        }
    }
}
