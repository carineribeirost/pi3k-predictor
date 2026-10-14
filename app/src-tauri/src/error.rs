use ts_rs::TS;

/// The single error type returned by every command. Serialized as `{ kind, message }`.
#[derive(Debug, thiserror::Error, serde::Serialize, TS)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
#[ts(export)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(String),
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn serializes_as_tagged_kind_message() {
        let json = serde_json::to_value(AppError::Io("disk full".into())).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "io", "message": "disk full" }));
    }
}
