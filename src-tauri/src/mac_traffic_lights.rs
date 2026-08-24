//! Chrome-like macOS title strip: traffic lights stay in `#mac-titlebar`.
//!
//! Native Spaces fullscreen auto-hides the lights until the cursor hits the
//! top edge. We disable that and make the green button toggle our own
//! “fill screen + keep titled overlay” mode, with an explicit saved frame so
//! the second click restores the previous window size.

#![cfg(target_os = "macos")]

use std::cell::RefCell;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2::{define_class, msg_send, ClassType, MainThreadOnly, Message};
use objc2_app_kit::{
    NSApplication, NSApplicationPresentationOptions, NSView, NSWindow, NSWindowButton,
    NSWindowCollectionBehavior,
};
use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// Must match `#mac-titlebar` height in `app.css`.
pub const TITLEBAR_HEIGHT: f64 = 38.0;
const TRAFFIC_LIGHT_X: f64 = 16.0;

struct ImmersiveState {
    frame: objc2_foundation::NSRect,
    presentation: NSApplicationPresentationOptions,
}

static IMMERSIVE: Mutex<Option<ImmersiveState>> = Mutex::new(None);

thread_local! {
    static ZOOM_TARGET: RefCell<Option<Retained<SeMaZoomTarget>>> = const { RefCell::new(None) };
    static ACTIVE_WINDOW: RefCell<Option<Retained<NSWindow>>> = const { RefCell::new(None) };
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SeMaZoomTarget"]
    struct SeMaZoomTarget;

    impl SeMaZoomTarget {
        #[unsafe(method(toggleImmersive:))]
        fn toggle_immersive(&self, _sender: Option<&AnyObject>) {
            ACTIVE_WINDOW.with(|cell| {
                if let Some(win) = cell.borrow().as_ref() {
                    toggle_immersive_for(win);
                }
            });
        }
    }

    unsafe impl NSObjectProtocol for SeMaZoomTarget {}
);

impl SeMaZoomTarget {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

fn remember_active_window(ns_window: &NSWindow) {
    ACTIVE_WINDOW.with(|cell| {
        *cell.borrow_mut() = Some(ns_window.retain());
    });
}

pub fn configure_window(window: &impl HasWindowHandle) {
    let Some(ns_window) = ns_window_from(window) else {
        return;
    };
    remember_active_window(&ns_window);
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    unsafe {
        let mut behavior = ns_window.collectionBehavior();
        behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
        behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
        behavior.insert(NSWindowCollectionBehavior::FullScreenNone);
        ns_window.setCollectionBehavior(behavior);

        // Green button → our toggle (save/restore frame).
        if let Some(zoom_btn) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) {
            let target = SeMaZoomTarget::new(mtm);
            let _: () = msg_send![&zoom_btn, setTarget: &*target];
            let _: () = msg_send![&zoom_btn, setAction: objc2::sel!(toggleImmersive:)];
            ZOOM_TARGET.with(|cell| {
                *cell.borrow_mut() = Some(target);
            });
        }

        inset_traffic_lights(&ns_window);
        show_traffic_lights(&ns_window);
    }
}

pub fn reapply(window: &impl HasWindowHandle) {
    let Some(ns_window) = ns_window_from(window) else {
        return;
    };
    remember_active_window(&ns_window);
    unsafe {
        inset_traffic_lights(&ns_window);
        show_traffic_lights(&ns_window);
    }
}

fn ns_window_from(window: &impl HasWindowHandle) -> Option<Retained<NSWindow>> {
    let handle = window.window_handle().ok()?;
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
        return None;
    };
    let view = unsafe { appkit.ns_view.cast::<NSView>().as_ref() };
    view.window()
}

fn toggle_immersive_for(ns_window: &NSWindow) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    let mut guard = IMMERSIVE.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(prev) = guard.take() {
        ns_window.setFrame_display(prev.frame, true);
        ns_window.setMovable(true);
        app.setPresentationOptions(prev.presentation);
        unsafe {
            inset_traffic_lights(ns_window);
            show_traffic_lights(ns_window);
        }
        return;
    }

    let frame = ns_window.frame();
    let presentation = app.presentationOptions();
    let Some(screen) = ns_window.screen() else {
        return;
    };
    let screen_frame = screen.frame();

    *guard = Some(ImmersiveState {
        frame,
        presentation,
    });

    let opts = NSApplicationPresentationOptions::AutoHideDock
        .union(NSApplicationPresentationOptions::AutoHideMenuBar);
    app.setPresentationOptions(opts);

    ns_window.setFrame_display(screen_frame, true);
    ns_window.setMovable(false);
    unsafe {
        inset_traffic_lights(ns_window);
        show_traffic_lights(ns_window);
    }
}

unsafe fn show_traffic_lights(window: &NSWindow) {
    for btn in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(b) = window.standardWindowButton(btn) {
            b.setHidden(false);
            b.setAlphaValue(1.0);
        }
    }
}

unsafe fn inset_traffic_lights(window: &NSWindow) {
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let Some(zoom) = window.standardWindowButton(NSWindowButton::ZoomButton) else {
        return;
    };

    let Some(btn_superview) = close.superview() else {
        return;
    };
    let Some(title_bar_container) = btn_superview.superview() else {
        return;
    };

    let close_rect = NSView::frame(close.as_ref());
    let button_h = close_rect.size.height;

    let mut title_bar_rect = NSView::frame(&title_bar_container);
    title_bar_rect.size.height = TITLEBAR_HEIGHT;
    title_bar_rect.origin.y = window.frame().size.height - TITLEBAR_HEIGHT;
    title_bar_container.setFrame(title_bar_rect);

    let mini_rect = NSView::frame(miniaturize.as_ref());
    let space_between = mini_rect.origin.x - close_rect.origin.x;
    let origin_y = ((TITLEBAR_HEIGHT - button_h) / 2.0).max(0.0);

    let buttons: [&NSView; 3] = [close.as_ref(), miniaturize.as_ref(), zoom.as_ref()];
    for (i, button) in buttons.into_iter().enumerate() {
        button.setFrameOrigin(NSPoint {
            x: TRAFFIC_LIGHT_X + (i as f64 * space_between),
            y: origin_y,
        });
    }
}
