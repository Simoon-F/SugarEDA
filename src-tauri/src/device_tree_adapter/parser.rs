use super::{
    diagnostic::DeviceTreeDiagnostic,
    lexer::{Token, TokenKind},
};
use std::collections::BTreeMap;

const MAX_PIN_MUX_NODES: usize = 4096;
const MAX_BOOT_STRAP_NODES: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParsedDeviceTree {
    pub properties: BTreeMap<String, ParsedProperty>,
    pub pin_mux: Vec<ParsedAssignment>,
    pub boot_straps: Vec<ParsedAssignment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParsedProperty {
    pub value: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParsedAssignment {
    pub properties: BTreeMap<String, ParsedProperty>,
    pub line: usize,
    pub column: usize,
}

pub(super) fn parse(tokens: Vec<Token>) -> Result<ParsedDeviceTree, DeviceTreeDiagnostic> {
    Parser::new(tokens).parse()
}

struct Parser {
    tokens: Vec<Token>,
    position: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Self {
            tokens,
            position: 0,
        }
    }

    fn parse(mut self) -> Result<ParsedDeviceTree, DeviceTreeDiagnostic> {
        self.expect_symbol(TokenKind::Slash, "‘/dts-v1/;’ 文件头")?;
        self.expect_word("dts-v1")?;
        self.expect_symbol(TokenKind::Slash, "‘/dts-v1/;’ 文件头")?;
        self.expect_symbol(TokenKind::Semicolon, "文件头后的分号")?;
        self.expect_symbol(TokenKind::Slash, "根节点 ‘/’")?;
        self.expect_symbol(TokenKind::LeftBrace, "根节点起始花括号")?;

        let node = self.take_word("sugareda-device-config 根节点")?;
        if node.0 != "sugareda-device-config" {
            return Err(DeviceTreeDiagnostic::error(
                "device-tree.unknown-root-node",
                Some(node.1),
                Some(node.2),
                format!("根节点中不允许节点 {}", node.0),
                format!("Node {} is not allowed below the root", node.0),
            ));
        }
        self.expect_symbol(TokenKind::LeftBrace, "配置节点起始花括号")?;
        let tree = self.parse_config_body()?;
        self.expect_symbol(TokenKind::RightBrace, "配置节点结束花括号")?;
        self.optional_semicolon();
        self.expect_symbol(TokenKind::RightBrace, "根节点结束花括号")?;
        self.optional_semicolon();
        if let Some(token) = self.current() {
            return Err(DeviceTreeDiagnostic::error(
                "device-tree.trailing-content",
                Some(token.line),
                Some(token.column),
                "根节点后存在不允许的内容",
                "Content after the root node is not allowed",
            ));
        }
        Ok(tree)
    }

    fn parse_config_body(&mut self) -> Result<ParsedDeviceTree, DeviceTreeDiagnostic> {
        let mut properties = BTreeMap::new();
        let mut pin_mux = Vec::new();
        let mut boot_straps = Vec::new();
        let mut saw_pin_mux = false;
        let mut saw_boot_straps = false;
        while !self.at_symbol(&TokenKind::RightBrace) {
            let (name, line, column) = self.take_word("配置属性或子节点")?;
            if self.at_symbol(&TokenKind::Equals) {
                let property = self.parse_property_value(line, column)?;
                insert_property(&mut properties, name, property)?;
                continue;
            }
            if !self.at_symbol(&TokenKind::LeftBrace) {
                return Err(self.unexpected("属性赋值或受支持的子节点"));
            }
            self.position += 1;
            match name.as_str() {
                "pinmux" => {
                    if saw_pin_mux {
                        return Err(duplicate_node("pinmux", line, column));
                    }
                    saw_pin_mux = true;
                    pin_mux = self.parse_assignment_collection(
                        "assignment",
                        &["pin", "function"],
                        MAX_PIN_MUX_NODES,
                    )?;
                }
                "boot-straps" => {
                    if saw_boot_straps {
                        return Err(duplicate_node("boot-straps", line, column));
                    }
                    saw_boot_straps = true;
                    boot_straps = self.parse_assignment_collection(
                        "strap",
                        &["pin", "value"],
                        MAX_BOOT_STRAP_NODES,
                    )?;
                }
                _ => {
                    return Err(DeviceTreeDiagnostic::error(
                        "device-tree.unknown-node",
                        Some(line),
                        Some(column),
                        format!("配置节点中不允许子节点 {name}"),
                        format!("Child node {name} is not allowed in the configuration node"),
                    ));
                }
            }
            self.expect_symbol(TokenKind::RightBrace, "子节点结束花括号")?;
            self.optional_semicolon();
        }
        Ok(ParsedDeviceTree {
            properties,
            pin_mux,
            boot_straps,
        })
    }

    fn parse_assignment_collection(
        &mut self,
        expected_node: &str,
        allowed_properties: &[&str],
        max_nodes: usize,
    ) -> Result<Vec<ParsedAssignment>, DeviceTreeDiagnostic> {
        let mut assignments = Vec::new();
        while !self.at_symbol(&TokenKind::RightBrace) {
            let (name, line, column) = self.take_word("分配节点")?;
            if name != expected_node {
                return Err(DeviceTreeDiagnostic::error(
                    "device-tree.unknown-assignment-node",
                    Some(line),
                    Some(column),
                    format!("这里只允许 {expected_node}@N 节点"),
                    format!("Only {expected_node}@N nodes are allowed here"),
                ));
            }
            if self.at_symbol(&TokenKind::At) {
                self.position += 1;
                self.take_word("节点单元地址")?;
            }
            self.expect_symbol(TokenKind::LeftBrace, "分配节点起始花括号")?;
            let properties = self.parse_assignment_properties(allowed_properties)?;
            self.expect_symbol(TokenKind::RightBrace, "分配节点结束花括号")?;
            self.optional_semicolon();
            assignments.push(ParsedAssignment {
                properties,
                line,
                column,
            });
            if assignments.len() > max_nodes {
                return Err(DeviceTreeDiagnostic::error(
                    "device-tree.too-many-assignments",
                    Some(line),
                    Some(column),
                    format!("分配节点数量超过 {max_nodes} 上限"),
                    format!("Assignment node count exceeds the {max_nodes} limit"),
                ));
            }
        }
        Ok(assignments)
    }

    fn parse_assignment_properties(
        &mut self,
        allowed: &[&str],
    ) -> Result<BTreeMap<String, ParsedProperty>, DeviceTreeDiagnostic> {
        let mut properties = BTreeMap::new();
        while !self.at_symbol(&TokenKind::RightBrace) {
            let (name, line, column) = self.take_word("分配属性")?;
            if !allowed.contains(&name.as_str()) {
                return Err(DeviceTreeDiagnostic::error(
                    "device-tree.unknown-property",
                    Some(line),
                    Some(column),
                    format!("不允许属性 {name}"),
                    format!("Property {name} is not allowed"),
                ));
            }
            self.expect_symbol(TokenKind::Equals, "属性赋值符号")?;
            let property = self.parse_quoted_property(line, column)?;
            insert_property(&mut properties, name, property)?;
        }
        Ok(properties)
    }

    fn parse_property_value(
        &mut self,
        line: usize,
        column: usize,
    ) -> Result<ParsedProperty, DeviceTreeDiagnostic> {
        self.expect_symbol(TokenKind::Equals, "属性赋值符号")?;
        self.parse_quoted_property(line, column)
    }

    fn parse_quoted_property(
        &mut self,
        line: usize,
        column: usize,
    ) -> Result<ParsedProperty, DeviceTreeDiagnostic> {
        let value = match self.current().map(|token| &token.kind) {
            Some(TokenKind::Quoted(value)) => value.clone(),
            _ => return Err(self.unexpected("单个字符串属性值")),
        };
        self.position += 1;
        self.expect_symbol(TokenKind::Semicolon, "属性后的分号")?;
        Ok(ParsedProperty {
            value,
            line,
            column,
        })
    }

    fn expect_word(&mut self, expected: &str) -> Result<(), DeviceTreeDiagnostic> {
        let (actual, line, column) = self.take_word(expected)?;
        if actual != expected {
            return Err(DeviceTreeDiagnostic::error(
                "device-tree.unexpected-token",
                Some(line),
                Some(column),
                format!("应为 {expected}，实际为 {actual}"),
                format!("Expected {expected}, found {actual}"),
            ));
        }
        Ok(())
    }

    fn take_word(
        &mut self,
        expected: &str,
    ) -> Result<(String, usize, usize), DeviceTreeDiagnostic> {
        let Some(token) = self.current().cloned() else {
            return Err(self.unexpected(expected));
        };
        let TokenKind::Word(word) = token.kind else {
            return Err(self.unexpected(expected));
        };
        self.position += 1;
        Ok((word, token.line, token.column))
    }

    fn expect_symbol(
        &mut self,
        expected: TokenKind,
        description: &str,
    ) -> Result<(), DeviceTreeDiagnostic> {
        if self.at_symbol(&expected) {
            self.position += 1;
            Ok(())
        } else {
            Err(self.unexpected(description))
        }
    }

    fn at_symbol(&self, expected: &TokenKind) -> bool {
        self.current().is_some_and(|token| &token.kind == expected)
    }

    fn optional_semicolon(&mut self) {
        if self.at_symbol(&TokenKind::Semicolon) {
            self.position += 1;
        }
    }

    fn current(&self) -> Option<&Token> {
        self.tokens.get(self.position)
    }

    fn unexpected(&self, expected: &str) -> DeviceTreeDiagnostic {
        let (line, column) = self
            .current()
            .map(|token| (Some(token.line), Some(token.column)))
            .unwrap_or((None, None));
        DeviceTreeDiagnostic::error(
            "device-tree.unexpected-token",
            line,
            column,
            format!("语法无效，应为{expected}"),
            format!("Invalid syntax; expected {expected}"),
        )
    }
}

fn insert_property(
    properties: &mut BTreeMap<String, ParsedProperty>,
    name: String,
    property: ParsedProperty,
) -> Result<(), DeviceTreeDiagnostic> {
    if properties.contains_key(&name) {
        return Err(DeviceTreeDiagnostic::error(
            "device-tree.duplicate-property",
            Some(property.line),
            Some(property.column),
            format!("属性 {name} 被重复定义"),
            format!("Property {name} is defined more than once"),
        ));
    }
    properties.insert(name, property);
    Ok(())
}

fn duplicate_node(name: &str, line: usize, column: usize) -> DeviceTreeDiagnostic {
    DeviceTreeDiagnostic::error(
        "device-tree.duplicate-node",
        Some(line),
        Some(column),
        format!("节点 {name} 被重复定义"),
        format!("Node {name} is defined more than once"),
    )
}
