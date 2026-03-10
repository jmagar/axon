use crate::crates::core::config::{Config, build_cli_command};
use clap::Command;
use std::error::Error;

pub async fn run_completions(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let shell = cfg
        .positional
        .first()
        .map(String::as_str)
        .ok_or("completions requires a shell: bash, zsh, or fish")?;
    let command = build_cli_command();
    let script = match shell {
        "bash" => render_bash(&command),
        "zsh" => render_zsh(&command),
        "fish" => render_fish(&command),
        other => return Err(format!("unsupported shell for completions: {other}").into()),
    };
    print!("{script}");
    Ok(())
}

fn render_bash(command: &Command) -> String {
    let commands = shell_words(command_names(command));
    let flags = shell_words(global_flags(command));
    format!(
        r#"_axon() {{
    local cur prev
    COMPREPLY=()
    cur="${{COMP_WORDS[COMP_CWORD]}}"
    prev="${{COMP_WORDS[COMP_CWORD-1]}}"

    if [[ $COMP_CWORD -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "{commands}" -- "$cur") )
        return 0
    fi

    if [[ $COMP_CWORD -eq 2 && ( "${{COMP_WORDS[1]}}" == "completions" || "${{COMP_WORDS[1]}}" == "completion" ) ]]; then
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
        return 0
    fi

    if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "{flags}" -- "$cur") )
    fi
}}

complete -F _axon axon
"#
    )
}

fn render_zsh(command: &Command) -> String {
    let commands = zsh_array(command_names(command));
    let flags = zsh_array(global_flags(command));
    format!(
        r#"#compdef axon

_axon() {{
    local -a commands
    local -a global_flags
    local -a shells
    commands=({commands})
    global_flags=({flags})
    shells=('bash' 'zsh' 'fish')

    if (( CURRENT == 2 )); then
        _describe 'command' commands
        return
    fi

    if (( CURRENT == 3 )) && [[ $words[2] == completions || $words[2] == completion ]]; then
        _describe 'shell' shells
        return
    fi

    if [[ $words[CURRENT] == -* ]]; then
        _describe 'option' global_flags
    fi
}}

compdef _axon axon
"#
    )
}

fn render_fish(command: &Command) -> String {
    let mut script = String::from("complete -c axon -f\n");

    for name in command_names(command) {
        script.push_str(&format!(
            "complete -c axon -n '__fish_use_subcommand' -a '{}'\n",
            name
        ));
    }

    for flag in global_flags(command) {
        if let Some(name) = flag.strip_prefix("--") {
            script.push_str(&format!("complete -c axon -l {name}\n"));
        }
    }

    script.push_str(
        "complete -c axon -n '__fish_seen_subcommand_from completions completion' -a 'bash zsh fish'\n",
    );
    script
}

fn command_names(command: &Command) -> Vec<String> {
    let mut names = Vec::new();
    for subcommand in command.get_subcommands() {
        names.push(subcommand.get_name().to_string());
        names.extend(subcommand.get_all_aliases().map(str::to_string));
    }
    names.sort();
    names.dedup();
    names
}

fn global_flags(command: &Command) -> Vec<String> {
    let mut flags = Vec::new();
    for arg in command.get_arguments() {
        if let Some(long) = arg.get_long() {
            flags.push(format!("--{long}"));
        }
    }
    flags.sort();
    flags.dedup();
    flags
}

fn shell_words(values: Vec<String>) -> String {
    values.join(" ")
}

fn zsh_array(values: Vec<String>) -> String {
    values
        .into_iter()
        .map(|value| format!("'{}'", value.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{render_bash, render_fish, render_zsh};
    use crate::crates::core::config::build_cli_command;

    #[test]
    fn bash_completion_lists_commands_and_shells() {
        let script = render_bash(&build_cli_command());
        assert!(script.contains("complete -F _axon axon"));
        assert!(script.contains("completions"));
        assert!(script.contains("completion"));
        assert!(script.contains("bash zsh fish"));
        assert!(script.contains("--wait"));
    }

    #[test]
    fn zsh_completion_uses_compdef_and_shell_describe() {
        let script = render_zsh(&build_cli_command());
        assert!(script.contains("#compdef axon"));
        assert!(script.contains("compdef _axon axon"));
        assert!(script.contains("_describe 'shell' shells"));
        assert!(script.contains("'mcp'"));
    }

    #[test]
    fn fish_completion_emits_subcommands_and_global_flags() {
        let script = render_fish(&build_cli_command());
        assert!(script.contains("complete -c axon -f"));
        assert!(script.contains("complete -c axon -n '__fish_use_subcommand' -a 'completions'"));
        assert!(script.contains("complete -c axon -l wait"));
        assert!(script.contains("__fish_seen_subcommand_from completions completion"));
    }
}
