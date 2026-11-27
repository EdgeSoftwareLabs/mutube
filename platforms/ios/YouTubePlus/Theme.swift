import SwiftUI
import UIKit

enum Theme {
    /// Page chrome. Matches the mobile YouTube dark background.
    static let surface = Color(red: 15.0 / 255.0, green: 15.0 / 255.0, blue: 15.0 / 255.0)
    /// Unsafe areas (notch, Dynamic Island, home indicator) and the launch screen.
    static let background = Color.black
    static let uiSurface = UIColor(red: 15.0 / 255.0, green: 15.0 / 255.0, blue: 15.0 / 255.0, alpha: 1)
    static let uiBlack = UIColor.black
}
