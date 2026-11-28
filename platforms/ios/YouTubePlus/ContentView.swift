import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var session: WebSession
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSettings = false
    @State private var welcomeVisible = false

    /// Ad block and Picture in Picture are WKWebView configuration. DeArrow and
    /// Hide Shorts change what the document-start script does to the first response.
    private var webToken: String {
        let current = settings.settings
        return "\(current.adBlock)|\(current.pictureInPicture)|\(current.deArrow)|\(current.hideShorts)"
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Theme.background.ignoresSafeArea()
            YouTubeWebView(settings: settings, session: session) {
                showSettings = true
            }
            .id(webToken)
            if welcomeVisible {
                welcomeToast
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(settings)
        }
        .onAppear(perform: appear)
        .onChange(of: scenePhase) { phase in
            handleScene(phase)
        }
    }

    private var welcomeToast: some View {
        VStack {
            HStack {
                Spacer()
                Text("Welcome to YouTube +")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.88))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.top, 48)
                    .padding(.trailing, 12)
            }
            Spacer()
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    private func appear() {
        PlaybackSession.configure()
        guard !settings.settings.welcomed else { return }
        settings.settings.welcomed = true
        welcomeVisible = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) {
            withAnimation(.easeOut(duration: 0.25)) {
                welcomeVisible = false
            }
        }
    }

    private func handleScene(_ phase: ScenePhase) {
        if phase == .active {
            // PlaybackSession.returnToForeground owns setAppActive(true) so we
            // do not flip the visibility shim twice or before the page is shown.
            PlaybackSession.returnToForeground()
        } else {
            // willResignActive already started the hold; reinforce it and set
            // the JS backgrounded flag as early as the scene phase allows.
            PlaybackSession.keepAlive()
            session.setAppActive(false)
        }
    }
}
