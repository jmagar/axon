use console::Style;

fn tag(label: &str, style: Style) -> String {
    style.apply_to(label).to_string()
}

pub fn log_info(msg: &str) {
    eprintln!("{} {}", tag("◐", Style::new().cyan()), msg);
}

pub fn log_warn(msg: &str) {
    eprintln!("{} {}", tag("⚠", Style::new().yellow()), msg);
}

pub fn log_done(msg: &str) {
    eprintln!("{} {}", tag("✓", Style::new().green()), msg);
}
