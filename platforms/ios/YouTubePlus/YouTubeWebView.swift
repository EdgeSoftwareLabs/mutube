import SwiftUI
import WebKit
import SafariServices

final class WebSession: ObservableObject {
    @Published var url: URL
    @Published var canGoBack = false
    @Published var canGoForward = false
    let home: URL
    weak var webView: WKWebView?

    init() {
        let home = URL(string: "https://m.youtube.com/")!
        self.home = home
        url = home
    }

    func update(from webView: WKWebView) {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        guard let current = webView.url, let scheme = current.scheme?.lowercased() else { return }
        if scheme == "http" || scheme == "https" {
            url = current
        }
    }

    func setAppActive(_ active: Bool) {
        let flag = active ? "true" : "false"
        webView?.evaluateJavaScript("window.YouTubePlus&&window.YouTubePlus.setAppActive(\(flag));", completionHandler: nil)
    }

    func pushSettings(_ settings: YouTubePlusSettings) {
        let json = settings.scriptJSON()
        webView?.evaluateJavaScript("window.YouTubePlus&&window.YouTubePlus.applySettings(\(json));", completionHandler: nil)
    }

    /// Cold launch: `onOpenURL` often arrives while content rules are still compiling,
    /// so the first load reads `url`. If the page is already up, load immediately.
    func open(_ incoming: URL) {
        guard let target = YouTubeLink.mobileURL(from: incoming) else { return }
        url = target
        webView?.load(URLRequest(url: target))
    }
}

private enum WebCache {
    private static var installed = false

    static func install() {
        if installed { return }
        installed = true
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024)
    }
}

struct YouTubeWebView: UIViewRepresentable {
    @ObservedObject var settings: SettingsStore
    @ObservedObject var session: WebSession
    var onRequestSettings: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(settings: settings, session: session, onRequestSettings: onRequestSettings)
    }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.makeWebView()
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.settings = settings
        context.coordinator.session = session
        context.coordinator.onRequestSettings = onRequestSettings
        context.coordinator.webView = webView
        session.webView = webView
        if #available(iOS 16.4, *) {
            webView.isInspectable = settings.settings.debugLogging
        }
        context.coordinator.pushSettings(to: webView)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "ytplus")
        coordinator.webView = nil
    }
}

extension YouTubeWebView {
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var settings: SettingsStore
        var session: WebSession
        var onRequestSettings: () -> Void
        weak var webView: WKWebView?
        private var refreshControl: UIRefreshControl?
        private var lastPushed = ""
        private var didStartLoad = false

        init(settings: SettingsStore, session: WebSession, onRequestSettings: @escaping () -> Void) {
            self.settings = settings
            self.session = session
            self.onRequestSettings = onRequestSettings
        }

        func makeWebView() -> WKWebView {
            WebCache.install()
            PlaybackSession.configure()
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .default()
            config.suppressesIncrementalRendering = false
            config.allowsInlineMediaPlayback = true
            config.allowsPictureInPictureMediaPlayback = settings.settings.pictureInPicture
            config.allowsAirPlayForMediaPlayback = true
            config.mediaTypesRequiringUserActionForPlayback = []
            config.defaultWebpagePreferences.allowsContentJavaScript = true
            config.preferences.javaScriptCanOpenWindowsAutomatically = true
            enableElementFullscreen(config)

            let controller = config.userContentController
            // Main frame only. Browse JSON and tab thumbnails live there; subframes
            // would each install the parser hook and the poll timer.
            let prelude = WKUserScript(
                source: ScriptLoader.prelude(for: settings.settings),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            let bundle = WKUserScript(
                source: ScriptLoader.userScript(),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            let boot = WKUserScript(
                source: "window.YouTubePlus&&window.YouTubePlus.boot();",
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
            controller.addUserScript(prelude)
            controller.addUserScript(bundle)
            controller.addUserScript(boot)
            controller.add(self, name: "ytplus")

            let webView = WKWebView(frame: .zero, configuration: config)
            webView.navigationDelegate = self
            webView.uiDelegate = self
            webView.allowsBackForwardNavigationGestures = true
            webView.allowsLinkPreview = true
            webView.isOpaque = true
            webView.backgroundColor = Theme.uiSurface
            webView.underPageBackgroundColor = Theme.uiSurface
            webView.scrollView.backgroundColor = Theme.uiSurface
            webView.scrollView.contentInsetAdjustmentBehavior = .automatic
            webView.scrollView.keyboardDismissMode = .interactive
            webView.scrollView.indicatorStyle = .white
            webView.tintColor = .white
            if #available(iOS 16.4, *) {
                webView.isInspectable = settings.settings.debugLogging
            }

            let refresh = UIRefreshControl()
            refresh.tintColor = .white
            refresh.addTarget(self, action: #selector(refresh(_:)), for: .valueChanged)
            webView.scrollView.refreshControl = refresh
            refreshControl = refresh

            let longPress = UILongPressGestureRecognizer(target: self, action: #selector(longPressed(_:)))
            longPress.numberOfTouchesRequired = 2
            longPress.minimumPressDuration = 0.55
            webView.addGestureRecognizer(longPress)

            self.webView = webView
            session.webView = webView
            PlaybackSession.attach(webView)
            start(webView)
            return webView
        }

        private func start(_ webView: WKWebView) {
            let loadPage = { [weak self, weak webView] in
                guard let self, let webView, !self.didStartLoad else { return }
                self.didStartLoad = true
                webView.load(URLRequest(url: self.session.url))
            }
            guard settings.settings.adBlock else {
                loadPage()
                return
            }
            ScriptLoader.compileRules { list in
                DispatchQueue.main.async {
                    if let list {
                        webView.configuration.userContentController.add(list)
                    }
                    loadPage()
                }
            }
        }

        func pushSettings(to webView: WKWebView) {
            guard webView.url?.host != nil else { return }
            let json = settings.settings.scriptJSON()
            guard json != lastPushed else { return }
            lastPushed = json
            webView.evaluateJavaScript("window.YouTubePlus&&window.YouTubePlus.applySettings(\(json));", completionHandler: nil)
        }

        @objc private func refresh(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        @objc private func longPressed(_ gesture: UILongPressGestureRecognizer) {
            guard gesture.state == .began else { return }
            onRequestSettings()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            let type = body["type"] as? String
            if type == "settings" {
                onRequestSettings()
                return
            }
            if type == "audioSession" {
                PlaybackSession.configure()
                return
            }
            if type == "nowPlaying" {
                PlaybackSession.update(from: body)
                return
            }
            guard settings.settings.debugLogging, type == "log" else { return }
            if let text = body["message"] as? String {
                NSLog("[YouTube+] %@", text)
            }
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            session.update(from: webView)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            refreshControl?.endRefreshing()
            session.update(from: webView)
            lastPushed = ""
            pushSettings(to: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            if let rewritten = Self.youtubeWebURL(from: url) {
                decisionHandler(.cancel)
                webView.load(URLRequest(url: rewritten))
                return
            }
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "tel" || scheme == "mailto" || scheme == "sms" {
                decisionHandler(.cancel)
                UIApplication.shared.open(url)
                return
            }
            if Self.isInApp(url) {
                if navigationAction.targetFrame == nil {
                    decisionHandler(.cancel)
                    webView.load(URLRequest(url: url))
                } else {
                    decisionHandler(.allow)
                }
                return
            }
            let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            if navigationAction.targetFrame == nil || mainFrame {
                decisionHandler(.cancel)
                if scheme == "http" || scheme == "https" {
                    openExternal(url)
                }
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            if Self.isInApp(url) {
                webView.load(URLRequest(url: url))
            } else if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                openExternal(url)
            }
            return nil
        }

        private func openExternal(_ url: URL) {
            DispatchQueue.main.async {
                guard let presenter = Self.topViewController() else {
                    UIApplication.shared.open(url)
                    return
                }
                let safari = SFSafariViewController(url: url)
                safari.preferredBarTintColor = Theme.uiSurface
                safari.preferredControlTintColor = .white
                presenter.present(safari, animated: true)
            }
        }

        private func enableElementFullscreen(_ config: WKWebViewConfiguration) {
            let selector = NSSelectorFromString("setElementFullscreenEnabled:")
            let prefs = config.preferences
            guard prefs.responds(to: selector) else { return }
            typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
            let setter = unsafeBitCast(prefs.method(for: selector), to: Setter.self)
            setter(prefs, selector, true)
        }

        static func topViewController() -> UIViewController? {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let window = scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.flatMap(\.windows).first
            var top = window?.rootViewController
            while let presented = top?.presentedViewController {
                top = presented
            }
            return top
        }

        static func youtubeWebURL(from url: URL) -> URL? {
            guard let scheme = url.scheme?.lowercased(), scheme == "youtube" || scheme == "vnd.youtube" else { return nil }
            if let host = url.host, host.contains(".") {
                var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
                comps?.scheme = "https"
                return comps?.url
            }
            var comps = URLComponents()
            comps.scheme = "https"
            comps.host = "m.youtube.com"
            let path = url.path
            comps.path = path.isEmpty ? "/" : (path.hasPrefix("/") ? path : "/" + path)
            comps.query = url.query
            return comps.url
        }

        static func isInApp(_ url: URL) -> Bool {
            guard let scheme = url.scheme?.lowercased() else { return false }
            if scheme == "about" || scheme == "blob" || scheme == "data" { return true }
            if scheme != "http" && scheme != "https" { return false }
            guard let host = url.host?.lowercased() else { return false }
            let mediaHosts = [
                "youtube.com", "youtube-nocookie.com", "youtu.be",
                "googlevideo.com", "ytimg.com", "ggpht.com", "googleapis.com", "gstatic.com"
            ]
            if mediaHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) { return true }
            return isGoogleSignIn(url)
        }

        static func isGoogleSignIn(_ url: URL) -> Bool {
            guard let host = url.host?.lowercased() else { return false }
            let hosts = [
                "accounts.google.com", "accounts.youtube.com", "myaccount.google.com",
                "consent.google.com", "ogs.google.com", "apis.google.com"
            ]
            if hosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) { return true }
            let google = host == "google.com" || host.hasSuffix(".google.com") || host.hasSuffix(".googleusercontent.com")
            let path = url.path.lowercased()
            if google && (path.contains("signin") || path.contains("oauth") || path.contains("servicelogin") || path.contains("/accounts")) {
                return true
            }
            return false
        }
    }
}
