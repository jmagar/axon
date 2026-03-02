use super::constants::{ALLOWED_FLAGS, ASYNC_MODES, NO_JSON_MODES};

pub(super) fn build_args(mode: &str, input: &str, flags: &serde_json::Value) -> Vec<String> {
    let is_async = ASYNC_MODES.contains(&mode);
    let mut args: Vec<String> = vec![mode.to_string()];

    let trimmed = input.trim();
    if !trimmed.is_empty() {
        let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
        let is_job_subcmd = matches!(
            parts[0],
            "cancel" | "status" | "errors" | "list" | "cleanup" | "clear" | "worker" | "recover"
        );
        if is_job_subcmd {
            for part in parts {
                let p = part.trim();
                if !p.is_empty() {
                    args.push(p.to_string());
                }
            }
        } else {
            args.push(trimmed.to_string());
        }
    }

    if !NO_JSON_MODES.contains(&mode) {
        args.push("--json".to_string());
    }
    if mode == "scrape" {
        args.push("--embed".to_string());
        args.push("false".to_string());
    }

    if let Some(obj) = flags.as_object() {
        for (json_key, cli_flag) in ALLOWED_FLAGS {
            if is_async && *json_key == "wait" {
                continue;
            }
            if let Some(val) = obj.get(*json_key) {
                match val {
                    serde_json::Value::Bool(true) => {
                        args.push(cli_flag.to_string());
                    }
                    serde_json::Value::Bool(false) => {
                        args.push(cli_flag.to_string());
                        args.push("false".to_string());
                    }
                    serde_json::Value::Number(n) => {
                        args.push(cli_flag.to_string());
                        args.push(n.to_string());
                    }
                    serde_json::Value::String(s) if !s.is_empty() => {
                        args.push(cli_flag.to_string());
                        args.push(s.clone());
                    }
                    _ => {}
                }
            }
        }
    }

    args
}
