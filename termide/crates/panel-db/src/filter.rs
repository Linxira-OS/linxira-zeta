//! Filter operator helpers: the type-aware operator menu and the mapping
//! between display labels and [`FilterOp`], plus value coercion.

use termide_db::{DbValue, FilterOp, TypeCategory};

/// Operator labels offered for a column category (type-aware).
pub(crate) fn operators_for(cat: TypeCategory) -> &'static [&'static str] {
    match cat {
        TypeCategory::Number | TypeCategory::Date => {
            &["=", "≠", ">", "≥", "<", "≤", "is null", "is not null"]
        }
        TypeCategory::Text | TypeCategory::Other => &[
            "contains",
            "starts with",
            "ends with",
            "=",
            "≠",
            "is null",
            "is not null",
        ],
        TypeCategory::Bool => &["=", "≠", "is null", "is not null"],
        TypeCategory::Bytes => &["is null", "is not null"],
    }
}

pub(crate) fn op_from_label(label: &str) -> Option<FilterOp> {
    Some(match label {
        "contains" => FilterOp::Contains,
        "starts with" => FilterOp::StartsWith,
        "ends with" => FilterOp::EndsWith,
        "=" => FilterOp::Eq,
        "≠" => FilterOp::Ne,
        ">" => FilterOp::Gt,
        "≥" => FilterOp::Ge,
        "<" => FilterOp::Lt,
        "≤" => FilterOp::Le,
        "is null" => FilterOp::IsNull,
        "is not null" => FilterOp::IsNotNull,
        _ => return None,
    })
}

pub(crate) fn label_for(op: FilterOp) -> &'static str {
    match op {
        FilterOp::Contains => "contains",
        FilterOp::StartsWith => "starts with",
        FilterOp::EndsWith => "ends with",
        FilterOp::Eq => "=",
        FilterOp::Ne => "≠",
        FilterOp::Gt => ">",
        FilterOp::Ge => "≥",
        FilterOp::Lt => "<",
        FilterOp::Le => "≤",
        FilterOp::IsNull => "is null",
        FilterOp::IsNotNull => "is not null",
    }
}

/// Coerce the user's text into a typed [`DbValue`] for binding, by category.
pub(crate) fn parse_value(cat: TypeCategory, text: &str) -> DbValue {
    match cat {
        TypeCategory::Number => {
            if let Ok(i) = text.parse::<i64>() {
                DbValue::Int(i)
            } else if let Ok(f) = text.parse::<f64>() {
                DbValue::Float(f)
            } else {
                DbValue::Text(text.to_string())
            }
        }
        TypeCategory::Bool => match text.to_ascii_lowercase().as_str() {
            "true" | "1" | "t" | "yes" | "y" => DbValue::Bool(true),
            "false" | "0" | "f" | "no" | "n" => DbValue::Bool(false),
            _ => DbValue::Text(text.to_string()),
        },
        _ => DbValue::Text(text.to_string()),
    }
}
