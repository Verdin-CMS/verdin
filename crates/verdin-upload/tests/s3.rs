//! Storage against a real S3-compatible service. Runs when `VERDIN_TEST_S3_ENDPOINT` is
//! set, e.g. with the RustFS of `docker/compose.dev.yml`:
//!   VERDIN_TEST_S3_ENDPOINT=http://localhost:9000 AWS_ACCESS_KEY_ID=verdin \
//!   AWS_SECRET_ACCESS_KEY=verdin-secret cargo test -p verdin-upload --test s3

use std::path::Path;

use verdin_upload::{ProviderConfig, Storage};

#[tokio::test]
async fn stores_and_deletes_objects_on_s3() {
    let Ok(endpoint) = std::env::var("VERDIN_TEST_S3_ENDPOINT") else {
        eprintln!("skipped: VERDIN_TEST_S3_ENDPOINT is not set");
        return;
    };
    let config = ProviderConfig::S3 {
        bucket: "verdin".into(),
        region: Some("us-east-1".into()),
        endpoint: Some(endpoint.clone()),
        public_url: format!("{endpoint}/verdin"),
        prefix: "tests".into(),
        path_style: true,
    };
    let storage = Storage::new(&config, Path::new(".")).unwrap();
    assert_eq!(storage.provider(), "aws-s3");
    let name = format!("object_{}.txt", std::process::id());
    assert_eq!(storage.url(&name), format!("{endpoint}/verdin/tests/{name}"));

    // Large enough for several multipart parts.
    let file = tempfile::NamedTempFile::new().unwrap();
    let bytes: Vec<u8> = (0..20 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
    std::fs::write(file.path(), &bytes).unwrap();
    storage.put_file(&name, file.path(), "text/plain").await.unwrap();
    assert_eq!(storage.get(&name).await.unwrap().len(), bytes.len());

    storage.put_bytes("small.txt", b"hello".to_vec(), "text/html").await.unwrap();
    assert_eq!(&storage.get("small.txt").await.unwrap()[..], b"hello");

    storage.delete(&name).await.unwrap();
    storage.delete("small.txt").await.unwrap();
    storage.delete("never-existed.txt").await.unwrap();
    assert!(storage.get(&name).await.is_err());
}
