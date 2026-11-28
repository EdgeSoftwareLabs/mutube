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
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Only while the in-header buttons are missing. This row sits under
            // the page, so it never covers Search.
            if !session.headerActionsMounted {
                fallbackControls
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

    private var fallbackControls: some View {
        HStack(spacing: 8) {
            Spacer()
            if settings.settings.pictureInPicture {
                overlayButton("pip.enter", label: "Picture in Picture") {
                    session.requestPictureInPicture()
                }
            }
            overlayButton("gearshape.fill", label: "YouTube + Settings") {
                showSettings = true
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(Theme.surface)
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

    private func overlayButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white.opacity(0.92))
                .frame(width: 32, height: 32)
                .background(Color.black.opacity(0.55))
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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
        PlaybackSession.configure()
        session.setAppActive(phase == .active)
    }
}
