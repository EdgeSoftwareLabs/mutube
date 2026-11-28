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

/// Matches the switches on m.youtube.com Settings (Notifications).
/// YouTube's paper-toggle is a 36×14 track with a 20pt knob centered on the
/// end caps, so the knob overhangs the bar. Dark-theme tokens:
/// off track #717171, off knob #909090, on track #aaaaaa, on knob #ffffff.
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

    // Points, matching YouTube's paper-toggle metrics.
    private let trackWidth: CGFloat = 36
    private let trackHeight: CGFloat = 14
    private let knobSize: CGFloat = 20

    private var trackColor: Color {
        isOn
            ? Color(red: 170.0 / 255.0, green: 170.0 / 255.0, blue: 170.0 / 255.0) // #aaaaaa
            : Color(red: 113.0 / 255.0, green: 113.0 / 255.0, blue: 113.0 / 255.0) // #717171
    }

    private var knobColor: Color {
        isOn
            ? Color.white // #ffffff
            : Color(red: 144.0 / 255.0, green: 144.0 / 255.0, blue: 144.0 / 255.0) // #909090
    }

    var body: some View {
        // The knob's center sits on the track's end cap (7pt in from each end),
        // so a 20pt knob extends 3pt past the track horizontally and vertically.
        ZStack {
            Capsule()
                .fill(trackColor)
                .frame(width: trackWidth, height: trackHeight)
            Circle()
                .fill(knobColor)
                .frame(width: knobSize, height: knobSize)
                .shadow(color: Color.black.opacity(0.6), radius: 2.5, x: 0, y: 1)
                .offset(x: isOn ? 11 : -11)
        }
        .frame(width: trackWidth + 6, height: knobSize)
        .animation(.easeInOut(duration: 0.2), value: isOn)
    }
}
