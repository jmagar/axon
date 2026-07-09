use super::should_use_ansi_for_writer;
use crate::config::ColorChoice;
use crate::ui::{COLOR_OVERRIDE, COLOR_TEST_GUARD, install_color_choice};

#[test]
fn color_override_controls_logging_ansi() {
    let _g = COLOR_TEST_GUARD.lock().unwrap_or_else(|e| e.into_inner());
    let prev = COLOR_OVERRIDE.load(std::sync::atomic::Ordering::Relaxed);

    install_color_choice(ColorChoice::Never);
    assert!(!should_use_ansi_for_writer(true));

    install_color_choice(ColorChoice::Always);
    assert!(should_use_ansi_for_writer(false));

    install_color_choice(ColorChoice::Auto);
    assert!(
        !crate::ui::color_forced_always(),
        "auto must clear the forced-always override"
    );

    COLOR_OVERRIDE.store(prev, std::sync::atomic::Ordering::Relaxed);
}

#[test]
fn redact_event_fields_scrubs_message_and_extra() {
    let mut v = super::EventVisitor {
        message: "auth failed: Authorization: Bearer abcdef0123456789abcdef".to_string(),
        extra: vec![(
            "cause".to_string(),
            "token=deadbeefdeadbeefdeadbeefdeadbeef".to_string(),
        )],
    };
    super::redact_event_fields(&mut v);
    assert!(!v.message.contains("abcdef0123456789abcdef"));
    assert!(!v.extra[0].1.contains("deadbeefdeadbeefdeadbeef"));
}
