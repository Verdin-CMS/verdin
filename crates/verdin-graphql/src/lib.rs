//! GraphQL API generated from the content schema (the `graphql` feature), shaped like
//! Strapi v5's GraphQL plugin: `articles`, `articles_connection`, `article(documentId)`,
//! `createArticle`, `updateArticle`, `deleteArticle`, single types, components, dynamic
//! zones as unions, relations with their own filters, and media as `UploadFile`.
//!
//! Arguments and selections are translated to the parameter tree REST query strings parse
//! to (see `args`), so both APIs share validation, permissions, filters and populate.

mod args;
mod http;
mod names;

use async_graphql::dynamic::{
    Enum, Field, FieldFuture, FieldValue, InputObject, InputValue, Object, ResolverContext, Scalar,
    Schema, TypeRef, Union,
};
use async_graphql::{Error, ErrorExtensions, Value};
use indexmap::IndexMap;
use serde_json::{Value as Json, json};
use verdin_auth::{ContentAction, ContentActor};
use verdin_content::{ContentError, DocumentService, PageMeta, WriteOptions};
use verdin_query::{Catalog, Limits, Node, Query, Status, TypeFields};
use verdin_schema::{Attribute, AttributeKind, ContentTypeKind, Schema as ContentSchema};

pub use http::router;

/// `graphql` feature settings.
#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub max_depth: usize,
    pub max_complexity: usize,
    pub introspection: bool,
    /// Serve GraphiQL on `GET /graphql` (loads from a CDN).
    pub playground: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self { max_depth: 10, max_complexity: 1000, introspection: true, playground: false }
    }
}

/// Shared by every resolver.
struct State {
    service: DocumentService,
    limits: Limits,
}

/// The schema side of the registry, for argument translation.
pub(crate) struct Model<'a> {
    pub catalog: &'a Catalog,
}

const STRING_OPS: &[&str] = &[
    "eq",
    "eqi",
    "ne",
    "nei",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "notContains",
    "containsi",
    "notContainsi",
    "startsWith",
    "startsWithi",
    "endsWith",
    "endsWithi",
];
const ORDERED_OPS: &[&str] = &["eq", "ne", "lt", "lte", "gt", "gte"];
const LIST_OPS: &[&str] = &["in", "notIn", "between"];

/// Builds the schema for `registry`.
pub fn schema(
    service: DocumentService,
    limits: Limits,
    options: &Options,
) -> Result<Schema, String> {
    let registry = service.registry().clone();
    let content = &registry.schema;
    let mut query = Object::new("Query").field(Field::new(
        "verdin",
        TypeRef::named_nn(TypeRef::STRING),
        |_| FieldFuture::new(async { Ok(Some(Value::from(env!("CARGO_PKG_VERSION")))) }),
    ));
    let mut mutation = Object::new("Mutation");
    let mut mutations = 0;
    let mut builder = Schema::build("Query", Some("Mutation"), None);

    for scalar in ["JSON", "DateTime", "Date", "Time", "Long"] {
        builder = builder.register(Scalar::new(scalar));
    }
    builder = builder
        .register(Enum::new("PublicationStatus").item("DRAFT").item("PUBLISHED"))
        .register(pagination_types().0)
        .register(pagination_types().1)
        .register(Object::new("DeleteMutationResponse").field(json_field(
            "documentId",
            TypeRef::named_nn(TypeRef::ID),
            Shape::Scalar,
        )))
        .register(upload_file_type());
    for filter in scalar_filters() {
        builder = builder.register(filter);
    }

    for component in content.components.values() {
        let name = names::component(&component.uid);
        let mut object = Object::new(&name).field(json_field(
            "id",
            TypeRef::named_nn(TypeRef::ID),
            Shape::Scalar,
        ));
        let mut input = InputObject::new(format!("{name}Input"))
            .field(InputValue::new("id", TypeRef::named(TypeRef::ID)));
        let mut filters = InputObject::new(format!("{name}FiltersInput"));
        for (field, attribute) in &component.attributes {
            if let Some((ty, shape)) = output_type(content, &name, field, attribute) {
                object = object.field(json_field(field, ty, shape));
            }
            if let Some(ty) = input_type(content, &name, field, attribute) {
                input = input.field(InputValue::new(field, ty));
            }
            if let Some(ty) = filter_type(content, attribute) {
                filters = filters.field(InputValue::new(field, TypeRef::named(ty)));
            }
        }
        filters = with_logic(filters, &format!("{name}FiltersInput"));
        builder = builder.register(object).register(input).register(filters);
    }

    for model in registry.types() {
        let content_type = &model.content_type;
        let type_name = names::pascal(&content_type.singular_name);
        let uid = content_type.uid.clone();
        let fields = model.fields.clone();

        // Object type, dynamic zone unions, inputs.
        let mut object = Object::new(&type_name).field(json_field(
            "documentId",
            TypeRef::named_nn(TypeRef::ID),
            Shape::Scalar,
        ));
        let mut input = InputObject::new(format!("{type_name}Input"));
        let mut filters = InputObject::new(format!("{type_name}FiltersInput"))
            .field(InputValue::new("documentId", TypeRef::named("IDFilterInput")));
        for (field, attribute) in &content_type.attributes {
            if attribute.private {
                continue;
            }
            if let AttributeKind::DynamicZone { components, .. } = &attribute.kind {
                let mut union =
                    Union::new(format!("{type_name}{}DynamicZone", names::field(field)));
                for uid in components {
                    union = union.possible_type(names::component(uid));
                }
                builder = builder.register(union);
            }
            if let Some((ty, shape)) = output_type(content, &type_name, field, attribute) {
                let mut output = json_field(field, ty, shape);
                if matches!(&attribute.kind, AttributeKind::Relation { relation, .. } if relation.is_to_many())
                {
                    output = with_list_arguments(output, &relation_target(content, attribute));
                }
                object = object.field(output);
            }
            if !matches!(&attribute.kind, AttributeKind::Relation { mapped_by: Some(_), .. })
                && let Some(ty) = input_type(content, &type_name, field, attribute)
            {
                input = input.field(InputValue::new(field, ty));
            }
            if let Some(ty) = filter_type(content, attribute) {
                filters = filters.field(InputValue::new(field, TypeRef::named(ty)));
            }
        }
        for system in ["createdAt", "updatedAt", "publishedAt"] {
            object = object.field(json_field(system, TypeRef::named("DateTime"), Shape::Scalar));
            filters = filters.field(InputValue::new(system, TypeRef::named("DateTimeFilterInput")));
        }
        filters = with_logic(filters, &format!("{type_name}FiltersInput"));
        builder = builder.register(object).register(input).register(filters);

        let singular = names::camel(&content_type.singular_name);
        let status_argument = || {
            InputValue::new("status", TypeRef::named("PublicationStatus"))
                .default_value(Value::Enum(async_graphql::Name::new("PUBLISHED")))
        };
        if content_type.kind == ContentTypeKind::CollectionType {
            let plural = names::camel(&content_type.plural_name);
            let collection = format!("{type_name}EntityResponseCollection");
            builder = builder.register(
                Object::new(&collection)
                    .field(json_field("nodes", TypeRef::named_nn_list_nn(&type_name), Shape::List))
                    .field(json_field("pageInfo", TypeRef::named_nn("Pagination"), Shape::Object)),
            );
            query = query
                .field(
                    with_list_arguments(
                        Field::new(&plural, TypeRef::named_nn_list_nn(&type_name), {
                            let (uid, fields) = (uid.clone(), fields.clone());
                            move |ctx| {
                                let (uid, fields) = (uid.clone(), fields.clone());
                                FieldFuture::new(async move {
                                    find_many(ctx, &uid, &fields, false).await
                                })
                            }
                        }),
                        &type_name,
                    )
                    .argument(status_argument()),
                )
                .field(
                    with_list_arguments(
                        Field::new(format!("{plural}_connection"), TypeRef::named(&collection), {
                            let (uid, fields) = (uid.clone(), fields.clone());
                            move |ctx| {
                                let (uid, fields) = (uid.clone(), fields.clone());
                                FieldFuture::new(async move {
                                    find_many(ctx, &uid, &fields, true).await
                                })
                            }
                        }),
                        &type_name,
                    )
                    .argument(status_argument()),
                )
                .field(
                    Field::new(&singular, TypeRef::named(&type_name), {
                        let (uid, fields) = (uid.clone(), fields.clone());
                        move |ctx| {
                            let (uid, fields) = (uid.clone(), fields.clone());
                            FieldFuture::new(async move { find_one(ctx, &uid, &fields).await })
                        }
                    })
                    .argument(InputValue::new("documentId", TypeRef::named_nn(TypeRef::ID)))
                    .argument(status_argument()),
                );
            mutation = mutation
                .field(
                    Field::new(format!("create{type_name}"), TypeRef::named(&type_name), {
                        let (uid, fields) = (uid.clone(), fields.clone());
                        move |ctx| {
                            let (uid, fields) = (uid.clone(), fields.clone());
                            FieldFuture::new(async move {
                                write(ctx, &uid, &fields, Write::Create).await
                            })
                        }
                    })
                    .argument(InputValue::new(
                        "data",
                        TypeRef::named_nn(format!("{type_name}Input")),
                    ))
                    .argument(status_argument()),
                )
                .field(
                    Field::new(format!("update{type_name}"), TypeRef::named(&type_name), {
                        let (uid, fields) = (uid.clone(), fields.clone());
                        move |ctx| {
                            let (uid, fields) = (uid.clone(), fields.clone());
                            FieldFuture::new(async move {
                                write(ctx, &uid, &fields, Write::Update).await
                            })
                        }
                    })
                    .argument(InputValue::new("documentId", TypeRef::named_nn(TypeRef::ID)))
                    .argument(InputValue::new(
                        "data",
                        TypeRef::named_nn(format!("{type_name}Input")),
                    ))
                    .argument(status_argument()),
                )
                .field(
                    Field::new(
                        format!("delete{type_name}"),
                        TypeRef::named("DeleteMutationResponse"),
                        {
                            let uid = uid.clone();
                            move |ctx| {
                                let uid = uid.clone();
                                FieldFuture::new(async move { delete(ctx, &uid).await })
                            }
                        },
                    )
                    .argument(InputValue::new("documentId", TypeRef::named_nn(TypeRef::ID))),
                );
        } else {
            query = query.field(
                Field::new(&singular, TypeRef::named(&type_name), {
                    let (uid, fields) = (uid.clone(), fields.clone());
                    move |ctx| {
                        let (uid, fields) = (uid.clone(), fields.clone());
                        FieldFuture::new(async move { find_one(ctx, &uid, &fields).await })
                    }
                })
                .argument(status_argument()),
            );
            mutation = mutation
                .field(
                    Field::new(format!("update{type_name}"), TypeRef::named(&type_name), {
                        let (uid, fields) = (uid.clone(), fields.clone());
                        move |ctx| {
                            let (uid, fields) = (uid.clone(), fields.clone());
                            FieldFuture::new(async move {
                                write(ctx, &uid, &fields, Write::Single).await
                            })
                        }
                    })
                    .argument(InputValue::new(
                        "data",
                        TypeRef::named_nn(format!("{type_name}Input")),
                    ))
                    .argument(status_argument()),
                )
                .field(Field::new(
                    format!("delete{type_name}"),
                    TypeRef::named("DeleteMutationResponse"),
                    {
                        let uid = uid.clone();
                        move |ctx| {
                            let uid = uid.clone();
                            FieldFuture::new(async move { delete(ctx, &uid).await })
                        }
                    },
                ));
        }
        mutations += 1;
    }

    if mutations == 0 {
        mutation = mutation.field(Field::new("verdin", TypeRef::named(TypeRef::STRING), |_| {
            FieldFuture::new(async { Ok(None::<Value>) })
        }));
    }
    let mut builder = builder
        .register(query)
        .register(mutation)
        .data(State { service, limits })
        .limit_depth(options.max_depth)
        .limit_complexity(options.max_complexity);
    if !options.introspection {
        builder = builder.disable_introspection();
    }
    builder.finish().map_err(|error| error.to_string())
}

// ------------------------------------------------------------------ types

/// How a field's JSON becomes a GraphQL value.
#[derive(Debug, Clone)]
enum Shape {
    Scalar,
    Object,
    List,
    /// Dynamic zone items, typed by their `__component`.
    Zone,
}

/// A field read from the parent's JSON (documents, components, files are JSON objects).
fn json_field(name: &str, ty: TypeRef, shape: Shape) -> Field {
    let key = name.to_owned();
    Field::new(name, ty, move |ctx| {
        let (key, shape) = (key.clone(), shape.clone());
        FieldFuture::new(async move {
            let parent = ctx.parent_value.try_downcast_ref::<Json>()?;
            let value = parent.get(&key).cloned().unwrap_or(Json::Null);
            Ok(to_field(value, &shape))
        })
    })
}

fn to_field(value: Json, shape: &Shape) -> Option<FieldValue<'static>> {
    if value.is_null() {
        return match shape {
            Shape::List | Shape::Zone => Some(FieldValue::list(Vec::<FieldValue>::new())),
            _ => None,
        };
    }
    Some(match shape {
        Shape::Scalar => FieldValue::value(Value::from_json(value).ok()?),
        Shape::Object => FieldValue::owned_any(value),
        Shape::List => FieldValue::list(
            value.as_array().cloned().unwrap_or_default().into_iter().map(FieldValue::owned_any),
        ),
        Shape::Zone => FieldValue::list(
            value.as_array().cloned().unwrap_or_default().into_iter().map(|item| {
                let component = item["__component"].as_str().unwrap_or_default().to_owned();
                FieldValue::owned_any(item).with_type(names::component(&component))
            }),
        ),
    })
}

fn scalar_type(kind: &AttributeKind) -> Option<&'static str> {
    use AttributeKind as A;
    Some(match kind {
        A::String { .. }
        | A::Email { .. }
        | A::Text { .. }
        | A::RichText { .. }
        | A::Uid { .. }
        | A::Enumeration { .. } => TypeRef::STRING,
        A::Integer { .. } => TypeRef::INT,
        A::BigInteger { .. } => "Long",
        A::Float { .. } | A::Decimal { .. } => TypeRef::FLOAT,
        A::Boolean => TypeRef::BOOLEAN,
        A::Date { .. } => "Date",
        A::Time { .. } => "Time",
        A::DateTime { .. } => "DateTime",
        A::Json => "JSON",
        _ => return None,
    })
}

fn relation_target(content: &ContentSchema, attribute: &Attribute) -> String {
    match &attribute.kind {
        AttributeKind::Relation { target, .. } => content
            .content_type(target)
            .map(|target| names::pascal(&target.singular_name))
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn output_type(
    content: &ContentSchema,
    owner: &str,
    field: &str,
    attribute: &Attribute,
) -> Option<(TypeRef, Shape)> {
    if let Some(scalar) = scalar_type(&attribute.kind) {
        return Some((TypeRef::named(scalar), Shape::Scalar));
    }
    Some(match &attribute.kind {
        AttributeKind::Relation { relation, .. } => {
            let target = relation_target(content, attribute);
            if relation.is_to_many() {
                (TypeRef::named_nn_list_nn(target), Shape::List)
            } else {
                (TypeRef::named(target), Shape::Object)
            }
        }
        AttributeKind::Media { multiple: true, .. } => {
            (TypeRef::named_nn_list_nn("UploadFile"), Shape::List)
        }
        AttributeKind::Media { .. } => (TypeRef::named("UploadFile"), Shape::Object),
        AttributeKind::Component { component, repeatable: true, .. } => {
            (TypeRef::named_nn_list_nn(names::component(component)), Shape::List)
        }
        AttributeKind::Component { component, .. } => {
            (TypeRef::named(names::component(component)), Shape::Object)
        }
        AttributeKind::DynamicZone { .. } => (
            TypeRef::named_nn_list_nn(format!("{owner}{}DynamicZone", names::field(field))),
            Shape::Zone,
        ),
        _ => return None,
    })
}

fn input_type(
    _content: &ContentSchema,
    _owner: &str,
    _field: &str,
    attribute: &Attribute,
) -> Option<TypeRef> {
    if let Some(scalar) = scalar_type(&attribute.kind) {
        return Some(TypeRef::named(scalar));
    }
    Some(match &attribute.kind {
        AttributeKind::Relation { relation, .. } if relation.is_to_many() => {
            TypeRef::named_nn_list(TypeRef::ID)
        }
        AttributeKind::Relation { .. } => TypeRef::named(TypeRef::ID),
        AttributeKind::Media { multiple: true, .. } => TypeRef::named_nn_list(TypeRef::ID),
        AttributeKind::Media { .. } => TypeRef::named(TypeRef::ID),
        AttributeKind::Component { component, repeatable: true, .. } => {
            TypeRef::named_nn_list(format!("{}Input", names::component(component)))
        }
        AttributeKind::Component { component, .. } => {
            TypeRef::named(format!("{}Input", names::component(component)))
        }
        // Items carry `__component`: typed as JSON like Strapi's dynamic zone inputs.
        AttributeKind::DynamicZone { .. } => TypeRef::named_nn_list("JSON"),
        _ => return None,
    })
}

fn filter_type(content: &ContentSchema, attribute: &Attribute) -> Option<String> {
    use AttributeKind as A;
    Some(match &attribute.kind {
        A::String { .. }
        | A::Email { .. }
        | A::Text { .. }
        | A::RichText { .. }
        | A::Uid { .. }
        | A::Enumeration { .. } => "StringFilterInput".into(),
        A::Integer { .. } => "IntFilterInput".into(),
        A::BigInteger { .. } => "LongFilterInput".into(),
        A::Float { .. } | A::Decimal { .. } => "FloatFilterInput".into(),
        A::Boolean => "BooleanFilterInput".into(),
        A::Date { .. } => "DateFilterInput".into(),
        A::Time { .. } => "TimeFilterInput".into(),
        A::DateTime { .. } => "DateTimeFilterInput".into(),
        A::Json => "JSONFilterInput".into(),
        A::Relation { .. } => format!("{}FiltersInput", relation_target(content, attribute)),
        A::Component { component, repeatable: false, .. } => {
            format!("{}FiltersInput", names::component(component))
        }
        _ => return None,
    })
}

fn with_logic(filters: InputObject, name: &str) -> InputObject {
    filters
        .field(InputValue::new("and", TypeRef::named_list(name)))
        .field(InputValue::new("or", TypeRef::named_list(name)))
        .field(InputValue::new("not", TypeRef::named(name)))
}

fn with_list_arguments(field: Field, type_name: &str) -> Field {
    field
        .argument(InputValue::new("filters", TypeRef::named(format!("{type_name}FiltersInput"))))
        .argument(InputValue::new("pagination", TypeRef::named("PaginationArg")))
        .argument(
            InputValue::new("sort", TypeRef::named_nn_list(TypeRef::STRING))
                .default_value(Value::List(Vec::new())),
        )
}

/// Filter inputs of scalar types: every operator the query parser knows.
fn scalar_filters() -> Vec<InputObject> {
    let make = |name: &str, ty: &str, ops: &[&str]| {
        let mut input = InputObject::new(name);
        for op in ops {
            input = input.field(InputValue::new(*op, TypeRef::named(ty)));
        }
        for op in LIST_OPS {
            input = input.field(InputValue::new(*op, TypeRef::named_list(ty)));
        }
        input
            .field(InputValue::new("null", TypeRef::named(TypeRef::BOOLEAN)))
            .field(InputValue::new("notNull", TypeRef::named(TypeRef::BOOLEAN)))
    };
    vec![
        make("StringFilterInput", TypeRef::STRING, STRING_OPS),
        make("IDFilterInput", TypeRef::ID, STRING_OPS),
        make("IntFilterInput", TypeRef::INT, ORDERED_OPS),
        make("LongFilterInput", "Long", ORDERED_OPS),
        make("FloatFilterInput", TypeRef::FLOAT, ORDERED_OPS),
        make("DateFilterInput", "Date", ORDERED_OPS),
        make("TimeFilterInput", "Time", ORDERED_OPS),
        make("DateTimeFilterInput", "DateTime", ORDERED_OPS),
        InputObject::new("BooleanFilterInput")
            .field(InputValue::new("eq", TypeRef::named(TypeRef::BOOLEAN)))
            .field(InputValue::new("ne", TypeRef::named(TypeRef::BOOLEAN)))
            .field(InputValue::new("null", TypeRef::named(TypeRef::BOOLEAN)))
            .field(InputValue::new("notNull", TypeRef::named(TypeRef::BOOLEAN))),
        InputObject::new("JSONFilterInput")
            .field(InputValue::new("null", TypeRef::named(TypeRef::BOOLEAN)))
            .field(InputValue::new("notNull", TypeRef::named(TypeRef::BOOLEAN))),
    ]
}

fn pagination_types() -> (Object, InputObject) {
    let int = |name: &str| json_field(name, TypeRef::named_nn(TypeRef::INT), Shape::Scalar);
    (
        Object::new("Pagination")
            .field(int("total"))
            .field(int("page"))
            .field(int("pageSize"))
            .field(int("pageCount")),
        InputObject::new("PaginationArg")
            .field(InputValue::new("page", TypeRef::named(TypeRef::INT)))
            .field(InputValue::new("pageSize", TypeRef::named(TypeRef::INT)))
            .field(InputValue::new("start", TypeRef::named(TypeRef::INT)))
            .field(InputValue::new("limit", TypeRef::named(TypeRef::INT))),
    )
}

fn upload_file_type() -> Object {
    let scalar = |name: &str, ty: TypeRef| json_field(name, ty, Shape::Scalar);
    Object::new("UploadFile")
        .field(scalar("id", TypeRef::named_nn(TypeRef::ID)))
        .field(scalar("documentId", TypeRef::named_nn(TypeRef::ID)))
        .field(scalar("name", TypeRef::named_nn(TypeRef::STRING)))
        .field(scalar("alternativeText", TypeRef::named(TypeRef::STRING)))
        .field(scalar("caption", TypeRef::named(TypeRef::STRING)))
        .field(scalar("width", TypeRef::named(TypeRef::INT)))
        .field(scalar("height", TypeRef::named(TypeRef::INT)))
        .field(scalar("focalPoint", TypeRef::named("JSON")))
        .field(scalar("formats", TypeRef::named("JSON")))
        .field(scalar("hash", TypeRef::named_nn(TypeRef::STRING)))
        .field(scalar("ext", TypeRef::named(TypeRef::STRING)))
        .field(scalar("mime", TypeRef::named_nn(TypeRef::STRING)))
        .field(scalar("size", TypeRef::named_nn(TypeRef::FLOAT)))
        .field(scalar("url", TypeRef::named_nn(TypeRef::STRING)))
        .field(scalar("previewUrl", TypeRef::named(TypeRef::STRING)))
        .field(scalar("provider", TypeRef::named_nn(TypeRef::STRING)))
        .field(scalar("createdAt", TypeRef::named("DateTime")))
        .field(scalar("updatedAt", TypeRef::named("DateTime")))
        .field(scalar("publishedAt", TypeRef::named("DateTime")))
}

// -------------------------------------------------------------- resolvers

fn error(code: &str, message: impl Into<String>) -> Error {
    let code = code.to_owned();
    Error::new(message).extend_with(move |_, extensions| extensions.set("code", code.clone()))
}

fn content_error(failure: ContentError) -> Error {
    match failure {
        ContentError::NotFound | ContentError::UnknownType(_) => error("NOT_FOUND", "Not Found"),
        ContentError::Validation(ref issues) => {
            let details = Value::from_json(json!(issues)).unwrap_or(Value::Null);
            error("BAD_USER_INPUT", failure.to_string())
                .extend_with(move |_, extensions| extensions.set("details", details.clone()))
        }
        ContentError::BadRequest(message) => error("BAD_USER_INPUT", message),
        ContentError::Db(failure) => {
            tracing::error!(error = %failure, "database error while serving GraphQL");
            error("INTERNAL_SERVER_ERROR", "Internal Server Error")
        }
    }
}

fn state<'a>(ctx: &ResolverContext<'a>) -> async_graphql::Result<&'a State> {
    ctx.data::<State>()
}

fn allow(ctx: &ResolverContext<'_>, uid: &str, action: ContentAction) -> async_graphql::Result<()> {
    let actor = ctx.data::<ContentActor>()?;
    if actor.allows(uid, action) { Ok(()) } else { Err(error("FORBIDDEN", "Forbidden")) }
}

/// The REST-equivalent query of a root field: its arguments plus what it selects.
fn query_of(
    ctx: &ResolverContext<'_>,
    fields: &TypeFields,
    connection: bool,
) -> async_graphql::Result<Query> {
    let state = state(ctx)?;
    let catalog = state.service.registry().catalog();
    let mut root: IndexMap<String, Node> = IndexMap::new();
    let arguments: Vec<(async_graphql::Name, Value)> =
        ctx.args.as_index_map().iter().map(|(name, value)| (name.clone(), value.clone())).collect();
    args::list_arguments(&arguments, &mut root);
    let model = Model { catalog };
    let selection = ctx.field().selection_set().collect::<Vec<_>>();
    let populate = if connection {
        selection
            .iter()
            .find(|field| field.name() == "nodes")
            .and_then(|nodes| args::populate(&model, fields, nodes.selection_set()))
    } else {
        args::populate(&model, fields, selection.into_iter())
    };
    if let Some(populate) = populate {
        root.insert("populate".into(), populate);
    }
    verdin_query::parse(&root, fields, catalog, &state.limits)
        .map_err(|failure| error("BAD_USER_INPUT", failure.message))
}

fn check_drafts(ctx: &ResolverContext<'_>, uid: &str, query: &Query) -> async_graphql::Result<()> {
    if query.status == Status::Draft {
        allow(ctx, uid, ContentAction::ReadDrafts)?;
    }
    Ok(())
}

async fn find_many<'a>(
    ctx: ResolverContext<'a>,
    uid: &str,
    fields: &TypeFields,
    connection: bool,
) -> async_graphql::Result<Option<FieldValue<'a>>> {
    allow(&ctx, uid, ContentAction::Find)?;
    let query = query_of(&ctx, fields, connection)?;
    check_drafts(&ctx, uid, &query)?;
    let page = state(&ctx)?.service.find_many(uid, &query).await.map_err(content_error)?;
    if !connection {
        return Ok(Some(FieldValue::list(page.documents.into_iter().map(FieldValue::owned_any))));
    }
    let info = match page.meta {
        PageMeta::Page { page, page_size, page_count, total } => json!({
            "page": page, "pageSize": page_size, "pageCount": page_count.unwrap_or(0), "total": total.unwrap_or(0)
        }),
        PageMeta::Offset { start, limit, total } => {
            let total = total.unwrap_or(0);
            let limit = limit.max(1);
            json!({ "page": start / limit + 1, "pageSize": limit, "pageCount": total.div_ceil(limit), "total": total })
        }
    };
    Ok(Some(FieldValue::owned_any(json!({ "nodes": page.documents, "pageInfo": info }))))
}

async fn find_one<'a>(
    ctx: ResolverContext<'a>,
    uid: &str,
    fields: &TypeFields,
) -> async_graphql::Result<Option<FieldValue<'a>>> {
    allow(&ctx, uid, ContentAction::FindOne)?;
    let query = query_of(&ctx, fields, false)?;
    check_drafts(&ctx, uid, &query)?;
    let service = &state(&ctx)?.service;
    let document_id = match ctx.args.get("documentId") {
        Some(value) => value.string()?.to_owned(),
        None => match service.single_document_id(uid).await.map_err(content_error)? {
            Some(document_id) => document_id,
            None => return Ok(None),
        },
    };
    let document = service.find_one(uid, &document_id, &query).await.map_err(content_error)?;
    Ok(document.map(FieldValue::owned_any))
}

#[derive(Clone, Copy)]
enum Write {
    Create,
    Update,
    /// Single types: update, or create on first write.
    Single,
}

async fn write<'a>(
    ctx: ResolverContext<'a>,
    uid: &str,
    fields: &TypeFields,
    kind: Write,
) -> async_graphql::Result<Option<FieldValue<'a>>> {
    let service = &state(&ctx)?.service;
    let data = ctx.args.try_get("data")?.as_value().clone().into_json()?;
    let query = query_of(&ctx, fields, false)?;
    let options = WriteOptions { publish: query.status == Status::Published, actor: None };
    let document_id = match kind {
        Write::Create => {
            allow(&ctx, uid, ContentAction::Create)?;
            service.create(uid, &data, options).await.map_err(content_error)?
        }
        Write::Update => {
            allow(&ctx, uid, ContentAction::Update)?;
            let document_id = ctx.args.try_get("documentId")?.string()?.to_owned();
            service.update(uid, &document_id, &data, options).await.map_err(content_error)?;
            document_id
        }
        Write::Single => {
            allow(&ctx, uid, ContentAction::Update)?;
            match service.single_document_id(uid).await.map_err(content_error)? {
                Some(document_id) => {
                    service
                        .update(uid, &document_id, &data, options)
                        .await
                        .map_err(content_error)?;
                    document_id
                }
                None => service.create(uid, &data, options).await.map_err(content_error)?,
            }
        }
    };
    let document = service.find_one(uid, &document_id, &query).await.map_err(content_error)?;
    Ok(document.map(FieldValue::owned_any))
}

async fn delete<'a>(
    ctx: ResolverContext<'a>,
    uid: &str,
) -> async_graphql::Result<Option<FieldValue<'a>>> {
    allow(&ctx, uid, ContentAction::Delete)?;
    let service = &state(&ctx)?.service;
    let document_id = match ctx.args.get("documentId") {
        Some(value) => value.string()?.to_owned(),
        None => match service.single_document_id(uid).await.map_err(content_error)? {
            Some(document_id) => document_id,
            None => return Err(error("NOT_FOUND", "Not Found")),
        },
    };
    service.delete(uid, &document_id).await.map_err(content_error)?;
    Ok(Some(FieldValue::owned_any(json!({ "documentId": document_id }))))
}
