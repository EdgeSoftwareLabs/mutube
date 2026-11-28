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
            .toggleStyle(YouTubeToggleStyle())
            .navigationTitle("YouTube + Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// Matches the switches on m.youtube.com Settings (History & privacy):
/// off is a #3f3f3f track with a light gray knob, on is an #f1f1f1 track
/// with an #0f0f0f knob. The system toggle's white tint draws both states
/// as the same solid pill.
struct YouTubeToggleStyle: ToggleStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 12) {
            configuration.label
                .foregroundColor(Color(red: 0.945, green: 0.945, blue: 0.945))
            Spacer(minLength: 12)
            YouTubeSwitch(isOn: configuration.isOn)
        }
        .contentShape(Rectangle())
        .opacity(isEnabled ? 1 : 0.45)
        .onTapGesture {
            guard isEnabled else { return }
            withAnimation(.easeInOut(duration: 0.18)) {
                configuration.isOn.toggle()
            }
        }
        .accessibilityElement(children: .combine)
        .youtubeToggleAccessibility(isOn: configuration.isOn)
    }
}

/// `.isToggle` is iOS 17. The deployment target stays 16, and the On/Off
/// value is announced on both.
private extension View {
    @ViewBuilder
    func youtubeToggleAccessibility(isOn: Bool) -> some View {
        if #available(iOS 17, *) {
            self.accessibilityAddTraits(.isToggle)
                .accessibilityValue(isOn ? "On" : "Off")
        } else {
            self.accessibilityValue(isOn ? "On" : "Off")
        }
    }
}

private struct YouTubeSwitch: View {
    var isOn: Bool

    var body: some View {
        ZStack(alignment: isOn ? .trailing : .leading) {
            Capsule()
                .fill(isOn
                      ? Color(red: 0.945, green: 0.945, blue: 0.945) // #f1f1f1
                      : Color(red: 0.247, green: 0.247, blue: 0.247)) // #3f3f3f
                .frame(width: 36, height: 14)
            Circle()
                .fill(isOn
                      ? Color(red: 0.059, green: 0.059, blue: 0.059) // #0f0f0f
                      : Color(white: 0.78))
                .frame(width: 20, height: 20)
                .shadow(color: .black.opacity(0.35), radius: 0.5, y: 1)
        }
        .frame(width: 40, height: 22)
        .animation(.easeInOut(duration: 0.18), value: isOn)
    }
}
