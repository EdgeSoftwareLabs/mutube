import SwiftUI

@main
struct YouTubePlusApp: App {
    @StateObject private var settings = SettingsStore()
    @StateObject private var session = WebSession()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(session)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    session.open(url)
                }
        }
    }
}
