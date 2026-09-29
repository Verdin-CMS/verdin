//! Full-text search (`[search]`): a Tantivy index of every document version, kept up to
//! date by the Document Service's events and rebuilt when the schema changes. It ranks
//! `_q` in the content and admin APIs (see `verdin_content::SearchIndex`).
//!
//! Words are split on non-alphanumerics, lowercased and stripped of accents, so `cafe`
//! finds `Café`. Every word must match; the last one also matches as a prefix
//! (search as you type). Titles (a type's first text attribute) weigh double.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, STORED, STRING, Schema, TextFieldIndexing, TextOptions, Value,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RemoveLongFilter, SimpleTokenizer, TextAnalyzer,
};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term, doc};
use tokio::sync::mpsc;
use verdin_content::events::{BoxFuture, DocumentEvent, DocumentListener};
use verdin_content::{DocumentService, SearchIndex, SearchText};

const TOKENIZER: &str = "verdin";
/// Bump when the index layout changes: existing indexes are rebuilt.
const FORMAT: u32 = 2;
const FINGERPRINT: &str = "verdin-fingerprint";
/// Rows read per page while rebuilding.
const PAGE: i64 = 500;
/// Changes are committed once this long passes without new ones (or every second).
const DEBOUNCE: Duration = Duration::from_millis(200);

/// `[search]` in `verdin.toml`.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SearchConfig {
    pub enabled: bool,
    /// Index directory, relative to the project (rebuilt when missing).
    pub dir: PathBuf,
    /// Indexing memory budget, in megabytes.
    pub memory_mb: usize,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self { enabled: false, dir: PathBuf::from("data/search"), memory_mb: 50 }
    }
}

#[derive(Clone, Copy)]
struct Fields {
    /// `uid|documentId`: every version of a document.
    document: Field,
    /// `uid|documentId|locale|state`: one version.
    version: Field,
    uid: Field,
    locale: Field,
    state: Field,
    document_id: Field,
    title: Field,
    body: Field,
}

/// Why an index could not be opened.
#[derive(Debug)]
pub struct SearchError(String);

impl std::fmt::Display for SearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SearchError {}

impl From<tantivy::TantivyError> for SearchError {
    fn from(error: tantivy::TantivyError) -> Self {
        Self(error.to_string())
    }
}

enum Job {
    /// Replace every version of a document.
    Document { key: String, texts: Vec<SearchText> },
    /// Answer once the earlier jobs are searchable.
    Flush(tokio::sync::oneshot::Sender<()>),
}

/// The search index. Cheap to clone.
#[derive(Clone)]
pub struct Search {
    inner: Arc<Inner>,
}

struct Inner {
    dir: PathBuf,
    index: Index,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    fields: Fields,
    /// Answers queries (not while rebuilding).
    ready: AtomicBool,
    /// Rebuilds in flight: only the latest finishes.
    generation: AtomicU64,
    jobs: mpsc::UnboundedSender<Job>,
}

impl Search {
    /// Opens (or creates) the index in `dir` and starts applying changes. Call
    /// [`Search::start`] with the Document Service to (re)build it as needed.
    pub fn open(dir: &Path, memory_mb: usize) -> Result<Self, SearchError> {
        std::fs::create_dir_all(dir).map_err(|error| SearchError(error.to_string()))?;
        let schema = schema();
        let directory = MmapDirectory::open(dir).map_err(|error| SearchError(error.to_string()))?;
        let index = match Index::open_or_create(directory, schema.clone()) {
            Ok(index) => index,
            // An index of another layout: start over.
            Err(_) => {
                std::fs::remove_dir_all(dir).map_err(|error| SearchError(error.to_string()))?;
                std::fs::create_dir_all(dir).map_err(|error| SearchError(error.to_string()))?;
                Index::create_in_dir(dir, schema.clone())?
            }
        };
        index.tokenizers().register(TOKENIZER, analyzer());
        let fields = fields(&index.schema());
        let reader =
            index.reader_builder().reload_policy(ReloadPolicy::OnCommitWithDelay).try_into()?;
        let writer = index.writer(memory_mb.max(15) * 1_000_000)?;
        let (jobs, receiver) = mpsc::unbounded_channel();
        let search = Self {
            inner: Arc::new(Inner {
                dir: dir.to_owned(),
                index,
                reader,
                writer: Mutex::new(writer),
                fields,
                ready: AtomicBool::new(false),
                generation: AtomicU64::new(0),
                jobs,
            }),
        };
        tokio::spawn(search.clone().apply(receiver));
        Ok(search)
    }

    /// Checks the index against `service`'s schema and rebuilds it in the background when
    /// it differs (or is new). `_q` falls back to `$containsi` meanwhile.
    pub fn start(&self, service: DocumentService) {
        let fingerprint = fingerprint(&service);
        let stored = std::fs::read_to_string(self.inner.dir.join(FINGERPRINT)).unwrap_or_default();
        if stored == fingerprint {
            self.inner.ready.store(true, Ordering::SeqCst);
            return;
        }
        self.inner.ready.store(false, Ordering::SeqCst);
        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let search = self.clone();
        tokio::spawn(async move {
            match search.rebuild(&service, generation).await {
                Ok(true) => {
                    let _ = std::fs::write(search.inner.dir.join(FINGERPRINT), &fingerprint);
                    search.inner.ready.store(true, Ordering::SeqCst);
                    tracing::info!("search index rebuilt");
                }
                Ok(false) => {}
                Err(error) => tracing::error!(%error, "rebuilding the search index failed"),
            }
        });
    }

    /// Whether `_q` is answered by the index.
    pub fn ready(&self) -> bool {
        self.inner.ready.load(Ordering::SeqCst)
    }

    /// Waits until the index answers (tests, `verdin search rebuild`).
    pub async fn wait_ready(&self) {
        while !self.ready() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Waits until the changes sent so far are searchable.
    pub async fn flush(&self) {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        if self.inner.jobs.send(Job::Flush(sender)).is_ok() {
            let _ = receiver.await;
        }
    }

    async fn rebuild(
        &self,
        service: &DocumentService,
        generation: u64,
    ) -> Result<bool, SearchError> {
        let current = || self.inner.generation.load(Ordering::SeqCst) == generation;
        self.inner.writer.lock().expect("search writer").delete_all_documents()?;
        let mut uids: Vec<String> =
            service.registry().types().map(|model| model.uid().to_owned()).collect();
        uids.sort();
        for uid in uids {
            let mut after = 0;
            loop {
                if !current() {
                    return Ok(false);
                }
                let (texts, last) = service
                    .search_texts_page(&uid, after, PAGE)
                    .await
                    .map_err(|error| SearchError(error.to_string()))?;
                {
                    let writer = self.inner.writer.lock().expect("search writer");
                    for text in &texts {
                        let version = version_key(text);
                        writer.delete_term(Term::from_field_text(
                            self.inner.fields.version,
                            &version,
                        ));
                        writer.add_document(self.document(text))?;
                    }
                }
                match last {
                    Some(last) => after = last,
                    None => break,
                }
            }
        }
        if !current() {
            return Ok(false);
        }
        let mut writer = self.inner.writer.lock().expect("search writer");
        writer.commit()?;
        drop(writer);
        self.inner.reader.reload()?;
        Ok(true)
    }

    fn document(&self, text: &SearchText) -> TantivyDocument {
        let fields = self.inner.fields;
        doc!(
            fields.document => document_key(&text.uid, &text.document_id),
            fields.version => version_key(text),
            fields.uid => text.uid.clone(),
            fields.locale => text.locale.clone(),
            fields.state => state(text.published),
            fields.document_id => text.document_id.clone(),
            fields.title => text.title.clone(),
            fields.body => text.body.clone(),
        )
    }

    /// Applies queued changes, committing once they stop coming.
    async fn apply(self, mut receiver: mpsc::UnboundedReceiver<Job>) {
        while let Some(job) = receiver.recv().await {
            let mut pending = vec![job];
            let started = tokio::time::Instant::now();
            loop {
                match tokio::time::timeout(DEBOUNCE, receiver.recv()).await {
                    Ok(Some(Job::Flush(done))) => {
                        pending.push(Job::Flush(done));
                        break;
                    }
                    Ok(Some(job)) => pending.push(job),
                    Ok(None) | Err(_) => break,
                }
                if started.elapsed() > Duration::from_secs(1) {
                    break;
                }
            }
            if let Err(error) = self.write(pending) {
                tracing::error!(%error, "updating the search index failed");
            }
        }
    }

    fn write(&self, jobs: Vec<Job>) -> Result<(), SearchError> {
        let mut flushed = Vec::new();
        let mut writer = self.inner.writer.lock().expect("search writer");
        for job in jobs {
            match job {
                Job::Document { key, texts } => {
                    writer.delete_term(Term::from_field_text(self.inner.fields.document, &key));
                    for text in &texts {
                        writer.add_document(self.document(text))?;
                    }
                }
                Job::Flush(done) => flushed.push(done),
            }
        }
        let committed = writer.commit().map(|_| ());
        drop(writer);
        let reloaded = self.inner.reader.reload();
        for done in flushed {
            let _ = done.send(());
        }
        committed?;
        reloaded?;
        Ok(())
    }

    /// The listener that keeps the index current (it also makes services rank `_q`).
    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }

    fn query(
        &self,
        uid: &str,
        published: bool,
        locale: &str,
        text: &str,
    ) -> Option<Box<dyn Query>> {
        let fields = self.inner.fields;
        let mut analyzer = self.inner.index.tokenizers().get(TOKENIZER)?;
        let mut words = Vec::new();
        let mut stream = analyzer.token_stream(text);
        while let Some(token) = stream.next() {
            words.push(token.text.clone());
        }
        if words.is_empty() {
            return None;
        }
        // Typing: the last word may be unfinished.
        let prefix_last = text.chars().last().is_some_and(char::is_alphanumeric);
        let term = |field: Field, value: &str| Term::from_field_text(field, value);
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for (index, word) in words.iter().enumerate() {
            let prefix = prefix_last && index == words.len() - 1;
            let per_field = |field: Field| -> Box<dyn Query> {
                if prefix {
                    Box::new(FuzzyTermQuery::new_prefix(term(field, word), 0, true))
                } else {
                    Box::new(TermQuery::new(term(field, word), IndexRecordOption::WithFreqs))
                }
            };
            let either = BooleanQuery::new(vec![
                (
                    Occur::Should,
                    Box::new(BoostQuery::new(per_field(fields.title), 2.0)) as Box<dyn Query>,
                ),
                (Occur::Should, per_field(fields.body)),
            ]);
            clauses.push((Occur::Must, Box::new(either)));
        }
        for (field, value) in
            [(fields.uid, uid), (fields.locale, locale), (fields.state, state(published))]
        {
            clauses.push((
                Occur::Must,
                Box::new(TermQuery::new(term(field, value), IndexRecordOption::Basic)),
            ));
        }
        Some(Box::new(BooleanQuery::new(clauses)))
    }
}

impl SearchIndex for Search {
    fn search(
        &self,
        uid: &str,
        published: bool,
        locale: &str,
        text: &str,
        limit: usize,
    ) -> Option<Vec<String>> {
        if !self.ready() {
            return None;
        }
        let Some(query) = self.query(uid, published, locale, text) else { return Some(Vec::new()) };
        let searcher = self.inner.reader.searcher();
        let hits =
            searcher.search(&query, &TopDocs::with_limit(limit.max(1)).order_by_score()).ok()?;
        let field = self.inner.fields.document_id;
        Some(
            hits.into_iter()
                .filter_map(|(_, address)| {
                    let doc: TantivyDocument = searcher.doc(address).ok()?;
                    doc.get_first(field).and_then(|value| value.as_str()).map(str::to_owned)
                })
                .collect(),
        )
    }
}

impl DocumentListener for Search {
    fn notify<'a>(
        &'a self,
        event: &'a DocumentEvent,
        service: &'a DocumentService,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            match service.search_texts(&event.uid, &event.document_id).await {
                Ok(texts) => {
                    let key = document_key(&event.uid, &event.document_id);
                    let _ = self.inner.jobs.send(Job::Document { key, texts });
                }
                Err(error) => {
                    tracing::warn!(%error, uid = %event.uid, "search: reading the document failed")
                }
            }
        })
    }

    fn search_index(&self) -> Option<Arc<dyn SearchIndex>> {
        Some(Arc::new(self.clone()))
    }
}

fn schema() -> Schema {
    let mut builder = Schema::builder();
    for name in ["document", "version", "uid", "locale", "state"] {
        builder.add_text_field(name, STRING);
    }
    builder.add_text_field("document_id", STRING | STORED);
    let text = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(TOKENIZER)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );
    builder.add_text_field("title", text.clone());
    builder.add_text_field("body", text);
    builder.build()
}

fn fields(schema: &Schema) -> Fields {
    let field = |name: &str| schema.get_field(name).expect("search schema");
    Fields {
        document: field("document"),
        version: field("version"),
        uid: field("uid"),
        locale: field("locale"),
        state: field("state"),
        document_id: field("document_id"),
        title: field("title"),
        body: field("body"),
    }
}

fn analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(40))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build()
}

fn state(published: bool) -> &'static str {
    if published { "p" } else { "d" }
}

fn document_key(uid: &str, document_id: &str) -> String {
    format!("{uid}\u{1f}{document_id}")
}

fn version_key(text: &SearchText) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}",
        text.uid,
        text.document_id,
        text.locale,
        state(text.published)
    )
}

/// What the index depends on: its layout and the searchable attributes of every type.
fn fingerprint(service: &DocumentService) -> String {
    let mut types: Vec<String> = service
        .registry()
        .types()
        .map(|model| {
            let attributes: Vec<String> = model
                .content_type
                .attributes
                .iter()
                .map(|(name, attribute)| {
                    format!("{name}:{:?}:{}", attribute.kind, attribute.private)
                })
                .collect();
            format!(
                "{}|{}|{}|{}",
                model.uid(),
                model.draft_and_publish(),
                model.content_type.localized,
                attributes.join(",")
            )
        })
        .collect();
    types.sort();
    // Private component fields are left out of the words.
    for (uid, component) in &service.registry().schema.components {
        let private: Vec<&str> = component
            .attributes
            .iter()
            .filter(|(_, attribute)| attribute.private)
            .map(|(name, _)| name.as_str())
            .collect();
        types.push(format!("{uid}|{}", private.join(",")));
    }
    let digest = Sha256::digest(format!("{FORMAT}\n{}", types.join("\n")).as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
