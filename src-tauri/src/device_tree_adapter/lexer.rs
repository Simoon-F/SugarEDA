use super::diagnostic::DeviceTreeDiagnostic;
use std::{iter::Peekable, str::Chars};

const MAX_TOKENS: usize = 50_000;
const MAX_QUOTED_BYTES: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Token {
    pub kind: TokenKind,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum TokenKind {
    Word(String),
    Quoted(String),
    Slash,
    LeftBrace,
    RightBrace,
    Equals,
    Semicolon,
    At,
}

pub(super) fn lex(bytes: &[u8]) -> Result<Vec<Token>, DeviceTreeDiagnostic> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        DeviceTreeDiagnostic::error(
            "device-tree.invalid-utf8",
            None,
            None,
            "Device Tree 子集文件必须是 UTF-8 文本",
            "Device Tree subset input must be UTF-8 text",
        )
    })?;
    Lexer::new(text).run()
}

struct Lexer<'a> {
    chars: Peekable<Chars<'a>>,
    line: usize,
    column: usize,
    tokens: Vec<Token>,
}

impl<'a> Lexer<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            chars: text.chars().peekable(),
            line: 1,
            column: 1,
            tokens: Vec::new(),
        }
    }

    fn run(mut self) -> Result<Vec<Token>, DeviceTreeDiagnostic> {
        while let Some(character) = self.peek() {
            if character.is_whitespace() {
                self.advance();
                continue;
            }
            let line = self.line;
            let column = self.column;
            match character {
                '/' => self.slash_or_comment(line, column)?,
                '"' => {
                    let quoted = self.quoted(line, column)?;
                    self.push(TokenKind::Quoted(quoted), line, column)?;
                }
                '{' => self.single(TokenKind::LeftBrace, line, column)?,
                '}' => self.single(TokenKind::RightBrace, line, column)?,
                '=' => self.single(TokenKind::Equals, line, column)?,
                ';' => self.single(TokenKind::Semicolon, line, column)?,
                '@' => self.single(TokenKind::At, line, column)?,
                _ if word_character(character) => {
                    let word = self.word();
                    self.push(TokenKind::Word(word), line, column)?;
                }
                _ => {
                    return Err(DeviceTreeDiagnostic::error(
                        "device-tree.invalid-character",
                        Some(line),
                        Some(column),
                        format!("不支持的字符 {character:?}"),
                        format!("Unsupported character {character:?}"),
                    ));
                }
            }
        }
        Ok(self.tokens)
    }

    fn slash_or_comment(&mut self, line: usize, column: usize) -> Result<(), DeviceTreeDiagnostic> {
        self.advance();
        match self.peek() {
            Some('/') => {
                while self.peek().is_some_and(|character| character != '\n') {
                    self.advance();
                }
                Ok(())
            }
            Some('*') => {
                self.advance();
                loop {
                    match self.advance() {
                        Some('*') if self.peek() == Some('/') => {
                            self.advance();
                            return Ok(());
                        }
                        Some(_) => {}
                        None => {
                            return Err(DeviceTreeDiagnostic::error(
                                "device-tree.unterminated-comment",
                                Some(line),
                                Some(column),
                                "块注释没有结束",
                                "Block comment is not terminated",
                            ));
                        }
                    }
                }
            }
            _ => self.push(TokenKind::Slash, line, column),
        }
    }

    fn quoted(&mut self, line: usize, column: usize) -> Result<String, DeviceTreeDiagnostic> {
        self.advance();
        let mut value = String::new();
        loop {
            match self.advance() {
                Some('"') => return Ok(value),
                Some('\\') => match self.advance() {
                    Some('"') => value.push('"'),
                    Some('\\') => value.push('\\'),
                    _ => {
                        return Err(self.string_error(
                            "device-tree.invalid-string-escape",
                            line,
                            column,
                        ))
                    }
                },
                Some(character) if !character.is_control() => value.push(character),
                Some(_) => {
                    return Err(self.string_error("device-tree.invalid-string", line, column))
                }
                None => {
                    return Err(self.string_error("device-tree.unterminated-string", line, column))
                }
            }
            if value.len() > MAX_QUOTED_BYTES {
                return Err(DeviceTreeDiagnostic::error(
                    "device-tree.string-too-long",
                    Some(line),
                    Some(column),
                    "字符串超过 512 字节限制",
                    "String exceeds the 512-byte limit",
                ));
            }
        }
    }

    fn string_error(&self, code: &'static str, line: usize, column: usize) -> DeviceTreeDiagnostic {
        DeviceTreeDiagnostic::error(
            code,
            Some(line),
            Some(column),
            "字符串格式无效或没有结束",
            "String is invalid or unterminated",
        )
    }

    fn word(&mut self) -> String {
        let mut word = String::new();
        while self.peek().is_some_and(word_character) {
            if let Some(character) = self.advance() {
                word.push(character);
            }
        }
        word
    }

    fn single(
        &mut self,
        kind: TokenKind,
        line: usize,
        column: usize,
    ) -> Result<(), DeviceTreeDiagnostic> {
        self.advance();
        self.push(kind, line, column)
    }

    fn push(
        &mut self,
        kind: TokenKind,
        line: usize,
        column: usize,
    ) -> Result<(), DeviceTreeDiagnostic> {
        if self.tokens.len() >= MAX_TOKENS {
            return Err(DeviceTreeDiagnostic::error(
                "device-tree.too-many-tokens",
                Some(line),
                Some(column),
                "Token 数量超过安全上限",
                "Token count exceeds the safety limit",
            ));
        }
        self.tokens.push(Token { kind, line, column });
        Ok(())
    }

    fn peek(&mut self) -> Option<char> {
        self.chars.peek().copied()
    }

    fn advance(&mut self) -> Option<char> {
        let character = self.chars.next()?;
        if character == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }
        Some(character)
    }
}

fn word_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '+')
}
