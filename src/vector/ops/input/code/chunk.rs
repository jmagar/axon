#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SymbolKind {
    Function,
    Method,
    Struct,
    Enum,
    Trait,
    Impl,
    Const,
    Static,
    Type,
    Mod,
    Other,
}

impl SymbolKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Method => "method",
            Self::Struct => "struct",
            Self::Enum => "enum",
            Self::Trait => "trait",
            Self::Impl => "impl",
            Self::Const => "const",
            Self::Static => "static",
            Self::Type => "type",
            Self::Mod => "mod",
            Self::Other => "other",
        }
    }

    pub const fn is_tiny_merge_eligible(self) -> bool {
        matches!(self, Self::Const | Self::Static | Self::Type)
    }
}

/// Owned code chunk metadata. Never store tree-sitter nodes here; they borrow
/// the parse tree and cannot safely cross this pure chunking boundary.
///
/// `text` is the rendered chunk to embed. Post-processing may prepend leading
/// comments or synthesized declaration headers, so byte spans identify the
/// original source region used to produce the chunk rather than promising
/// `text == source[byte_start..byte_end]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeChunk {
    pub text: String,
    pub byte_start: usize,
    pub byte_end: usize,
    pub start_line: u32,
    pub end_line: u32,
    pub declaration_start_line: u32,
    pub declaration_end_line: u32,
    pub symbol_name: Option<String>,
    pub symbol_kind: Option<SymbolKind>,
}

impl CodeChunk {
    pub fn symbol_kind_str(&self) -> Option<&'static str> {
        self.symbol_kind.map(SymbolKind::as_str)
    }
}
