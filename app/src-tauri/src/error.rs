use ts_rs::TS;

/// The single error type returned by every command. Serialized as `{ kind, message }`.
#[derive(Debug, thiserror::Error, serde::Serialize, TS)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
#[ts(export)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("model not ready: {0}")]
    ModelNotReady(String),
    #[error("database error: {0}")]
    Db(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
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
