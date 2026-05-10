//! Sets the macOS Dock / About-dialog icon at runtime from an embedded PNG.
//!
//! Why this exists: in `npm run tauri dev` the executable at
//! `target/debug/AMQPush` is a raw Mach-O binary, not a `.app` bundle, so
//! macOS has no `Info.plist` to consult and shows the generic blue-folder
//! icon for the Dock and the "About AMQPush" panel.
//!
//! The fix is to set `NSApplication.applicationIconImage` programmatically
//! at startup. We embed `icons/icon.png` via `include_bytes!` so there's no
//! filesystem dependency — production `.app` builds still ship the icon via
//! the bundle's `CFBundleIconFile` (which takes precedence on cold-start),
//! but calling this is harmless there too.

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::{MainThreadMarker, NSData, NSString};

/// PNG bytes of the AMQPush logo, embedded at compile time.
static ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

/// Apply the AMQPush icon to the running NSApplication. Must be called from
/// the main thread; no-ops gracefully if NSImage construction fails.
pub fn install() {
    // `MainThreadMarker::new` returns Some only when called on the main
    // thread — Tauri's setup hook runs there, so this is the right spot.
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    // Build NSData around the embedded bytes (zero-copy for the Cocoa side
    // since NSData::with_bytes copies once into an autoreleased buffer).
    let data = NSData::with_bytes(ICON_PNG);

    // `initWithData` is safe in objc2 0.6 — it takes an alloc'd NSImage and
    // a valid NSData and returns Option<Retained<_>>.
    let image: Option<Retained<NSImage>> =
        NSImage::initWithData(NSImage::alloc(), &data);

    let Some(image) = image else { return };

    // Register the image under the well-known "NSApplicationIcon" name. The
    // standard macOS About panel (the one Tauri's default app menu opens via
    // `orderFrontStandardAboutPanel:`) loads its icon via
    // `NSImage(named: "NSApplicationIcon")` — that lookup hits a separate
    // named-image cache from `applicationIconImage`. Without this call the
    // Dock updates correctly but the About sheet still shows the generic
    // blue-folder icon that AppKit cached at launch.
    image.setName(Some(&NSString::from_str("NSApplicationIcon")));

    let app = NSApplication::sharedApplication(mtm);
    // SAFETY: setApplicationIconImage accepts an Option<&NSImage>. The image
    // is retained by AppKit for as long as it's the current dock icon; our
    // `Retained<_>` drops at end-of-scope, decrementing our local refcount,
    // which is the expected pattern.
    unsafe { app.setApplicationIconImage(Some(&image)) };
}
