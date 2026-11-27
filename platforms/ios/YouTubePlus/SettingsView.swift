import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: SettingsStore
    @Environment(\.dismiss) private var dismiss

    private var versionText: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Ad Block", isOn: $store.settings.adBlock)
                    Toggle("SponsorBlock", isOn: $store.settings.sponsorBlock)
                } header: {
                    Text("Ads")
                } footer: {
                    Text("Ad Block removes video ads and feed ads. SponsorBlock skips segments submitted by viewers.")
                }

                Section {
                    Toggle("Sponsor", isOn: $store.settings.sponsor)
                    Toggle("Intro", isOn: $store.settings.intro)
                    Toggle("Outro", isOn: $store.settings.outro)
                    Toggle("Self-promotion", isOn: $store.settings.selfpromo)
                    Toggle("Interaction reminder", isOn: $store.settings.interaction)
                } header: {
                    Text("SponsorBlock")
                }
                .disabled(!store.settings.sponsorBlock)

                Section {
                    Toggle("Background Play", isOn: $store.settings.backgroundPlay)
                    Toggle("Picture in Picture", isOn: $store.settings.pictureInPicture)
                } header: {
                    Text("Playback")
                } footer: {
                    Text("Background Play keeps the video going when the app is in the background or the screen is locked.")
                }

                Section {
                    Toggle("DeArrow", isOn: $store.settings.deArrow)
                    Text("DeArrow replaces clickbait titles and thumbnails with community-submitted, more accurate ones.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Toggle("Return YouTube Dislike", isOn: $store.settings.returnYouTubeDislike)
                    Toggle("Hide Shorts", isOn: $store.settings.hideShorts)
                } header: {
                    Text("Enhancements")
                }

                Section {
                    Toggle("Debug Logging", isOn: $store.settings.debugLogging)
                } header: {
                    Text("Developer")
                }

                Section {
                    LabeledContent("Version", value: versionText)
                    Text("YouTube +")
                    Text("Edge Software Labs LLC")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Text("Unofficial. Not affiliated with or endorsed by Google.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .navigationTitle("YouTube + Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(.white)
    }
}
