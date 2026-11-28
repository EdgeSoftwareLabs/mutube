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

/// The newer YouTube/Google pill: a 48×26 track with the knob inside it.
/// Off is a #717171 track and a #0f0f0f knob on the left. On is an #f1f1f1
/// track and the same dark knob on the right. A 2pt gap leaves a ring of
/// track color around the knob. No shadow and no border.
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

    // Points. Track is about 2:1. Knob diameter is the track height minus 4,
    // so a 2pt margin shows the track color all the way around the knob.
    private let trackWidth: CGFloat = 48
    private let trackHeight: CGFloat = 26
    private let knobSize: CGFloat = 22
    private let inset: CGFloat = 2

    private var trackColor: Color {
        isOn
            ? Color(red: 241.0 / 255.0, green: 241.0 / 255.0, blue: 241.0 / 255.0) // #f1f1f1
            : Color(red: 113.0 / 255.0, green: 113.0 / 255.0, blue: 113.0 / 255.0) // #717171
    }

    private var knobColor: Color {
        Color(red: 15.0 / 255.0, green: 15.0 / 255.0, blue: 15.0 / 255.0) // #0f0f0f
    }

    var body: some View {
        let travel = (trackWidth - knobSize) / 2 - inset
        ZStack {
            Capsule()
                .fill(trackColor)
                .frame(width: trackWidth, height: trackHeight)
            Circle()
                .fill(knobColor)
                .frame(width: knobSize, height: knobSize)
                .offset(x: isOn ? travel : -travel)
        }
        .frame(width: trackWidth, height: trackHeight)
        .animation(.easeInOut(duration: 0.2), value: isOn)
    }
}
