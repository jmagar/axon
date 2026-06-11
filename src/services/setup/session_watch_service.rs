#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionWatchServiceAction {
    Install,
    Check,
    Remove,
    Status,
}
