//! Row export helpers: render a row as JSON, an `INSERT` statement, or TSV.

use termide_db::DbValue;

/// JSON-encode a row as `{"col": value, …}`.
pub(crate) fn row_to_json(names: &[String], row: &[DbValue]) -> String {
    let mut out = String::from("{");
    for (i, name) in names.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push_str(&json_string(name));
        out.push_str(": ");
        out.push_str(&json_value(row.get(i)));
    }
    out.push('}');
    out
}

fn json_value(v: Option<&DbValue>) -> String {
    match v {
        None | Some(DbValue::Null) => "null".to_string(),
        Some(DbValue::Bool(b)) => b.to_string(),
        Some(DbValue::Int(i)) => i.to_string(),
        Some(DbValue::Float(f)) => f.to_string(),
        Some(DbValue::Text(s)) => json_string(s),
        Some(DbValue::Bytes(_)) => json_string(&v.unwrap().display()),
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Build an `INSERT INTO "table" (...) VALUES (...);` statement. Identifiers
/// are double-quoted (portable for SQLite/Postgres); adapt for MySQL backticks.
pub(crate) fn row_to_insert(table: &str, names: &[String], row: &[DbValue]) -> String {
    let cols = names
        .iter()
        .map(|n| format!("\"{}\"", n.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(", ");
    let vals = (0..names.len())
        .map(|i| sql_literal(row.get(i)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "INSERT INTO \"{}\" ({}) VALUES ({});",
        table.replace('"', "\"\""),
        cols,
        vals
    )
}

fn sql_literal(v: Option<&DbValue>) -> String {
    match v {
        None | Some(DbValue::Null) => "NULL".to_string(),
        Some(DbValue::Bool(b)) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Some(DbValue::Int(i)) => i.to_string(),
        Some(DbValue::Float(f)) => f.to_string(),
        Some(DbValue::Text(s)) => format!("'{}'", s.replace('\'', "''")),
        Some(DbValue::Bytes(_)) => format!("'{}'", v.unwrap().display().replace('\'', "''")),
    }
}

/// Flatten tabs/newlines so a TSV row stays one line per record.
pub(crate) fn tsv_escape(s: &str) -> String {
    s.replace(['\t', '\n', '\r'], " ")
}
