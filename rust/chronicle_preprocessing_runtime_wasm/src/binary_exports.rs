use arrow_array::{
    builder::{
        ArrayBuilder, FixedSizeBinaryBuilder, Int32Builder, StringDictionaryBuilder, UInt32Builder,
    },
    types::Int32Type,
    Array, ArrayRef, DictionaryArray, RecordBatch, StringArray, UInt32Array,
};
use arrow_ipc::{
    writer::{DictionaryHandling, FileWriter, IpcWriteOptions},
    CompressionType,
};
use arrow_schema::{DataType, Field, Schema};
use chronicle_chrono_kernel_wasm::pipeline_v2::{LogicalStageCheckpoint, PipelineRowLineage};
use chronicle_preprocessing_semantic_adapter::ChroniclePlan;
use parquet::{
    basic::{ConvertedType, Repetition, Type as PhysicalType},
    data_type::{BoolType, ByteArray, ByteArrayType, DoubleType, Int32Type as ParquetInt32Type},
    file::{properties::WriterProperties, writer::SerializedFileWriter},
    schema::types::Type as ParquetType,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fmt::Write as FmtWrite;
use std::io::{Cursor, Write};
use std::sync::Arc;

const RESULT_CELL_CORRESPONDENCE_PROTOCOL: &str = "chronicle-result-cell-correspondence/v4";
const SOURCE_COORDINATE_PROTOCOL: &str = "chronicle-source-coordinate-index/v3";
const ROW_LINEAGE_PROTOCOL: &str = "chronicle-row-lineage/v2";
/// v2 adds the `source_field` / `target_output_column` coordinates and the
/// `exact-field`, `declared-column-scope`, and `conservative-search-window`
/// precision classes. The published Pages build is a deliberate older rollback
/// and no consumer holds v1 bytes, so the shape moved rather than growing a
/// parallel v1-compatible table.
///
/// v3 takes the lineage-search rows out of the `raw-row` key space. They count
/// pipeline-internal events, not one-based raw data rows, so joining them to
/// the source-coordinate index produced a range that was a different set of
/// records than the one actually scanned. They now carry
/// `LINEAGE_SEARCH_SOURCE_KEY_KIND`, name their ordering in the new
/// `source_index_space` column, and are excluded from `sourceCoordinateJoin`.
const SOURCE_RESULT_INFLUENCE_PROTOCOL: &str = "chronicle-source-result-influence/v3";

/// The `source_key_kind` of a lineage-search window. Deliberately not
/// `raw-row`: its `source_record_index` / `source_record_last` are positions in
/// the ordering named by `source_index_space`, so a consumer that joins by raw
/// record must skip this kind rather than silently mis-address records.
const LINEAGE_SEARCH_SOURCE_KEY_KIND: &str = "lineage-search-window";

/// The record-index space of the source-coordinate index, and therefore of
/// every witness row whose `source_index_space` is null.
const SOURCE_COORDINATE_RECORD_INDEX_BASE: &str = "one-based-data-row";

struct RunCachedStringDictionaryBuilder {
    keys: Int32Builder,
    values: Vec<String>,
    lookup: HashMap<String, i32>,
    last: Option<(String, i32)>,
}

impl RunCachedStringDictionaryBuilder {
    #[cfg(test)]
    fn new() -> Self {
        Self::with_capacity(1_024, 16)
    }

    fn with_capacity(key_capacity: usize, distinct_capacity: usize) -> Self {
        Self {
            keys: Int32Builder::with_capacity(key_capacity),
            values: Vec::with_capacity(distinct_capacity),
            lookup: HashMap::with_capacity(distinct_capacity),
            last: None,
        }
    }

    fn with_dictionary(values: &StringArray, key_capacity: usize) -> Result<Self, String> {
        let mut builder = Self::with_capacity(key_capacity, values.len());
        for value in values.iter() {
            let value = value.ok_or_else(|| {
                "string dictionary values must not contain null entries".to_string()
            })?;
            let key = i32::try_from(builder.values.len())
                .map_err(|_| "string dictionary exceeds i32 keys".to_string())?;
            builder.values.push(value.to_string());
            builder.lookup.insert(value.to_string(), key);
        }
        Ok(builder)
    }

    fn append(&mut self, value: &str) -> Result<(), String> {
        let key = if let Some((last_value, key)) = &self.last {
            if last_value == value {
                *key
            } else {
                self.key_for(value)?
            }
        } else {
            self.key_for(value)?
        };
        self.keys.append_value(key);
        Ok(())
    }

    fn key_for(&mut self, value: &str) -> Result<i32, String> {
        let key = if let Some(key) = self.lookup.get(value) {
            *key
        } else {
            let key = i32::try_from(self.values.len())
                .map_err(|_| "string dictionary exceeds i32 keys".to_string())?;
            self.values.push(value.to_string());
            self.lookup.insert(value.to_string(), key);
            key
        };
        self.last = Some((value.to_string(), key));
        Ok(key)
    }

    fn append_null(&mut self) {
        self.keys.append_null();
    }

    fn finish(mut self) -> Result<DictionaryArray<Int32Type>, String> {
        DictionaryArray::try_new(self.keys.finish(), Arc::new(StringArray::from(self.values)))
            .map_err(|error| error.to_string())
    }
}

pub struct CanonicalOutput<'a> {
    pub kind: &'a str,
    pub media_type: &'a str,
    pub bytes: &'a [u8],
    pub terminal_logical_node: &'a str,
}

pub struct CanonicalSource<'a> {
    pub role_id: &'a str,
    pub source_artifact_digest: &'a str,
    pub source_media_type: &'a str,
    pub coordinate_media_type: &'a str,
    pub normalization: &'a str,
    pub bytes: &'a [u8],
}

pub struct InfluenceContext<'a> {
    pub implementation_digest: &'a str,
    pub plan_digest: &'a str,
    pub profile_lock_digest: &'a str,
    pub dependency_certificate_digest: &'a str,
}

struct SourceCoordinateBuilders {
    role_id: RunCachedStringDictionaryBuilder,
    source_artifact_digest: RunCachedStringDictionaryBuilder,
    source_media_type: RunCachedStringDictionaryBuilder,
    coordinate_media_type: RunCachedStringDictionaryBuilder,
    normalization: RunCachedStringDictionaryBuilder,
    address_kind: RunCachedStringDictionaryBuilder,
    source_record_index: UInt32Builder,
    selector: StringDictionaryBuilder<Int32Type>,
    value_digest: FixedSizeBinaryBuilder,
}

impl SourceCoordinateBuilders {
    fn new() -> Self {
        Self {
            role_id: RunCachedStringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                8,
            ),
            source_artifact_digest: RunCachedStringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                8,
            ),
            source_media_type: RunCachedStringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                8,
            ),
            coordinate_media_type: RunCachedStringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                8,
            ),
            normalization: RunCachedStringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                8,
            ),
            address_kind: RunCachedStringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                8,
            ),
            source_record_index: UInt32Builder::with_capacity(SOURCE_COORDINATE_BATCH_ROWS),
            selector: StringDictionaryBuilder::with_capacity(
                SOURCE_COORDINATE_BATCH_ROWS,
                256,
                16_384,
            ),
            value_digest: FixedSizeBinaryBuilder::with_capacity(SOURCE_COORDINATE_BATCH_ROWS, 32),
        }
    }

    fn append(
        &mut self,
        source: &CanonicalSource<'_>,
        address_kind: &'static str,
        source_record_index: Option<u32>,
        selector: &str,
        value_bytes: &[u8],
    ) -> Result<(), String> {
        let value_digest = sha256_array(value_bytes);
        self.append_with_value_digest(
            source,
            address_kind,
            source_record_index,
            selector,
            value_digest,
        )
    }

    fn append_with_value_digest(
        &mut self,
        source: &CanonicalSource<'_>,
        address_kind: &'static str,
        source_record_index: Option<u32>,
        selector: &str,
        value_digest: [u8; 32],
    ) -> Result<(), String> {
        self.role_id
            .append(source.role_id)
            .map_err(|error| error.to_string())?;
        self.source_artifact_digest
            .append(source.source_artifact_digest)
            .map_err(|error| error.to_string())?;
        self.source_media_type
            .append(source.source_media_type)
            .map_err(|error| error.to_string())?;
        self.coordinate_media_type
            .append(source.coordinate_media_type)
            .map_err(|error| error.to_string())?;
        self.normalization
            .append(source.normalization)
            .map_err(|error| error.to_string())?;
        self.address_kind
            .append(address_kind)
            .map_err(|error| error.to_string())?;
        if let Some(source_record_index) = source_record_index {
            self.source_record_index.append_value(source_record_index);
        } else {
            self.source_record_index.append_null();
        }
        self.selector
            .append(selector)
            .map_err(|error| error.to_string())?;
        self.value_digest
            .append_value(value_digest)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn len(&self) -> usize {
        self.source_record_index.len()
    }

    fn with_dictionaries(dictionaries: &SourceCoordinateDictionaries) -> Result<Self, String> {
        let dictionary = |values: &StringArray| {
            RunCachedStringDictionaryBuilder::with_dictionary(values, SOURCE_COORDINATE_BATCH_ROWS)
        };
        Ok(Self {
            role_id: dictionary(&dictionaries.role_id)?,
            source_artifact_digest: dictionary(&dictionaries.source_artifact_digest)?,
            source_media_type: dictionary(&dictionaries.source_media_type)?,
            coordinate_media_type: dictionary(&dictionaries.coordinate_media_type)?,
            normalization: dictionary(&dictionaries.normalization)?,
            address_kind: dictionary(&dictionaries.address_kind)?,
            source_record_index: UInt32Builder::with_capacity(SOURCE_COORDINATE_BATCH_ROWS),
            selector: StringDictionaryBuilder::new_with_dictionary(
                SOURCE_COORDINATE_BATCH_ROWS,
                &dictionaries.selector,
            )
            .map_err(|error| error.to_string())?,
            value_digest: FixedSizeBinaryBuilder::with_capacity(SOURCE_COORDINATE_BATCH_ROWS, 32),
        })
    }

    fn finish(mut self, schema: Arc<Schema>) -> Result<RecordBatch, String> {
        let arrays: Vec<ArrayRef> = vec![
            Arc::new(self.role_id.finish()?),
            Arc::new(self.source_artifact_digest.finish()?),
            Arc::new(self.source_media_type.finish()?),
            Arc::new(self.coordinate_media_type.finish()?),
            Arc::new(self.normalization.finish()?),
            Arc::new(self.address_kind.finish()?),
            Arc::new(self.source_record_index.finish()),
            Arc::new(self.selector.finish()),
            Arc::new(self.value_digest.finish()),
        ];
        RecordBatch::try_new(schema, arrays)
            .map_err(|error| format!("build source coordinate Arrow batch: {error}"))
    }
}

struct SourceCoordinateDictionaries {
    role_id: StringArray,
    source_artifact_digest: StringArray,
    source_media_type: StringArray,
    coordinate_media_type: StringArray,
    normalization: StringArray,
    address_kind: StringArray,
    selector: StringArray,
}

impl SourceCoordinateDictionaries {
    fn from_batch(batch: &RecordBatch) -> Result<Self, String> {
        let values = |column_index: usize| {
            batch
                .column(column_index)
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .and_then(|dictionary| dictionary.values().as_any().downcast_ref::<StringArray>())
                .cloned()
                .ok_or_else(|| {
                    format!("source-coordinate column {column_index} is not a string dictionary")
                })
        };
        Ok(Self {
            role_id: values(0)?,
            source_artifact_digest: values(1)?,
            source_media_type: values(2)?,
            coordinate_media_type: values(3)?,
            normalization: values(4)?,
            address_kind: values(5)?,
            selector: values(7)?,
        })
    }
}

const SOURCE_COORDINATE_BATCH_ROWS: usize = 131_072;

fn source_coordinate_schema() -> Arc<Schema> {
    let mut metadata = HashMap::new();
    metadata.insert("protocolVersion".into(), SOURCE_COORDINATE_PROTOCOL.into());
    metadata.insert(
        "claimBoundary".into(),
        "Exact role-bound source coordinates and value identities. Coordinates are dependency-witness endpoints; output contribution is not implied without a separate witness edge.".into(),
    );
    metadata.insert(
        "recordIndexBase".into(),
        SOURCE_COORDINATE_RECORD_INDEX_BASE.into(),
    );
    metadata.insert("recordBatchCompression".into(), "lz4-frame".into());
    metadata.insert(
        "recordBatchRows".into(),
        SOURCE_COORDINATE_BATCH_ROWS.to_string(),
    );
    metadata.insert(
        "coordinateIdentityDerivation".into(),
        "sha256(length-prefixed protocolVersion, role_id, source_artifact_digest, source_media_type, coordinate_media_type, normalization, address_kind, selector; optional record index marker and little-endian u32; value_sha256)".into(),
    );
    Arc::new(Schema::new_with_metadata(
        vec![
            Field::new("role_id", dictionary_type(), false),
            Field::new("source_artifact_digest", dictionary_type(), false),
            Field::new("source_media_type", dictionary_type(), false),
            Field::new("coordinate_media_type", dictionary_type(), false),
            Field::new("normalization", dictionary_type(), false),
            Field::new("address_kind", dictionary_type(), false),
            Field::new("source_record_index", DataType::UInt32, true),
            Field::new("selector", dictionary_type(), false),
            Field::new("value_sha256", DataType::FixedSizeBinary(32), false),
        ],
        metadata,
    ))
}

struct SourceCoordinateBatchWriter {
    schema: Arc<Schema>,
    writer: FileWriter<Cursor<Vec<u8>>>,
    builders: SourceCoordinateBuilders,
    row_count: u32,
}

impl SourceCoordinateBatchWriter {
    fn new() -> Result<Self, String> {
        let schema = source_coordinate_schema();
        let write_options = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|error| format!("configure source coordinate compression: {error}"))?
            .with_dictionary_handling(DictionaryHandling::Delta);
        let writer =
            FileWriter::try_new_with_options(Cursor::new(Vec::new()), &schema, write_options)
                .map_err(|error| format!("create source coordinate writer: {error}"))?;
        Ok(Self {
            schema,
            writer,
            builders: SourceCoordinateBuilders::new(),
            row_count: 0,
        })
    }

    fn append(
        &mut self,
        source: &CanonicalSource<'_>,
        address_kind: &'static str,
        source_record_index: Option<u32>,
        selector: &str,
        value_bytes: &[u8],
    ) -> Result<(), String> {
        self.builders.append(
            source,
            address_kind,
            source_record_index,
            selector,
            value_bytes,
        )?;
        self.row_count = self
            .row_count
            .checked_add(1)
            .ok_or_else(|| "source coordinate index exceeds u32 rows".to_string())?;
        if self.builders.len() >= SOURCE_COORDINATE_BATCH_ROWS {
            self.flush()?;
        }
        Ok(())
    }

    fn append_with_value_digest(
        &mut self,
        source: &CanonicalSource<'_>,
        address_kind: &'static str,
        source_record_index: Option<u32>,
        selector: &str,
        value_digest: [u8; 32],
    ) -> Result<(), String> {
        self.builders.append_with_value_digest(
            source,
            address_kind,
            source_record_index,
            selector,
            value_digest,
        )?;
        self.row_count = self
            .row_count
            .checked_add(1)
            .ok_or_else(|| "source coordinate index exceeds u32 rows".to_string())?;
        if self.builders.len() >= SOURCE_COORDINATE_BATCH_ROWS {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        if self.builders.len() == 0 {
            return Ok(());
        }
        let builders = std::mem::replace(&mut self.builders, SourceCoordinateBuilders::new());
        let batch = builders.finish(self.schema.clone())?;
        let dictionaries = SourceCoordinateDictionaries::from_batch(&batch)?;
        self.builders = SourceCoordinateBuilders::with_dictionaries(&dictionaries)?;
        self.writer
            .write(&batch)
            .map_err(|error| format!("write source coordinate batch: {error}"))
    }

    fn finish(mut self) -> Result<(Vec<u8>, u32), String> {
        self.flush()?;
        let output = self
            .writer
            .into_inner()
            .map_err(|error| format!("finish source coordinate file: {error}"))?;
        Ok((output.into_inner(), self.row_count))
    }
}

#[cfg(test)]
fn source_coordinate_prefix(source: &CanonicalSource<'_>) -> Sha256 {
    let mut hasher = Sha256::new();
    for field in [
        SOURCE_COORDINATE_PROTOCOL.as_bytes(),
        source.role_id.as_bytes(),
        source.source_artifact_digest.as_bytes(),
        source.source_media_type.as_bytes(),
        source.coordinate_media_type.as_bytes(),
        source.normalization.as_bytes(),
    ] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field);
    }
    hasher
}

#[cfg(test)]
fn source_coordinate_id(
    coordinate_prefix: &Sha256,
    address_kind: &str,
    source_record_index: Option<u32>,
    selector: &str,
    value_digest: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = coordinate_prefix.clone();
    for field in [address_kind.as_bytes(), selector.as_bytes()] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field);
    }
    match source_record_index {
        Some(index) => {
            hasher.update([1]);
            hasher.update(index.to_le_bytes());
        }
        None => hasher.update([0]),
    }
    hasher.update(value_digest);
    hasher.finalize().into()
}

fn append_source_json_coordinates(
    builders: &mut SourceCoordinateBatchWriter,
    source: &CanonicalSource<'_>,
    path: &mut String,
    value: &serde_json::Value,
) -> Result<(), String> {
    match value {
        serde_json::Value::Array(values) => {
            if values.is_empty() {
                builders.append_with_value_digest(
                    source,
                    "json-leaf",
                    None,
                    path,
                    sha256_array(b"[]"),
                )?;
            }
            for (index, value) in values.iter().enumerate() {
                let previous_len = path.len();
                write!(path, "/{index}").expect("writing to String cannot fail");
                append_source_json_coordinates(builders, source, path, value)?;
                path.truncate(previous_len);
            }
        }
        serde_json::Value::Object(values) => {
            if values.is_empty() {
                builders.append_with_value_digest(
                    source,
                    "json-leaf",
                    None,
                    path,
                    sha256_array(b"{}"),
                )?;
            }
            for (key, value) in values {
                let previous_len = path.len();
                push_json_pointer_segment(path, key);
                append_source_json_coordinates(builders, source, path, value)?;
                path.truncate(previous_len);
            }
        }
        _ => {
            let value_digest = canonical_json_value_digest(value)
                .map_err(|error| format!("canonicalize source JSON coordinate {path}: {error}"))?;
            builders.append_with_value_digest(source, "json-leaf", None, path, value_digest)?;
        }
    }
    Ok(())
}

fn append_source_csv_coordinates(
    builders: &mut SourceCoordinateBatchWriter,
    source: &CanonicalSource<'_>,
) -> Result<(), String> {
    std::str::from_utf8(source.bytes)
        .map_err(|error| format!("read {} source CSV as UTF-8: {error}", source.role_id))?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(source.bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("read {} source CSV header: {error}", source.role_id))?
        .clone();
    let mut sorted_columns = headers.iter().enumerate().collect::<Vec<_>>();
    sorted_columns.sort_by_key(|(_, column)| *column);
    let mut value_digest_caches = (0..sorted_columns.len())
        .map(|_| BoundedValueDigestCache::default())
        .collect::<Vec<_>>();
    let mut row_count = 0_u32;
    let mut row = csv::ByteRecord::new();
    let mut zero_based_index = 0_usize;
    while reader
        .read_byte_record(&mut row)
        .map_err(|error| format!("read {} source CSV row: {error}", source.role_id))?
    {
        let source_record_index = u32::try_from(zero_based_index + 1)
            .map_err(|_| format!("{} source row index exceeds u32", source.role_id))?;
        row_count = source_record_index;
        for (sorted_index, (column_index, column)) in sorted_columns.iter().enumerate() {
            let value_bytes = row.get(*column_index).unwrap_or_default();
            builders.append_with_value_digest(
                source,
                "csv-cell",
                Some(source_record_index),
                column,
                value_digest_caches[sorted_index].digest(value_bytes),
            )?;
        }
        zero_based_index += 1;
    }
    let header_values = headers.iter().collect::<Vec<_>>();
    let encoded_headers = serde_jcs::to_vec(&header_values)
        .map_err(|error| format!("canonicalize {} source columns: {error}", source.role_id))?;
    builders.append(
        source,
        "csv-shape",
        None,
        "/shape/columns",
        &encoded_headers,
    )?;
    builders.append(
        source,
        "csv-shape",
        None,
        "/shape/rows",
        row_count.to_string().as_bytes(),
    )?;
    Ok(())
}

struct ResultCellBuilders {
    output_kind: RunCachedStringDictionaryBuilder,
    address_kind: RunCachedStringDictionaryBuilder,
    output_row_index: UInt32Builder,
    selector: StringDictionaryBuilder<Int32Type>,
    cell_value_digest: FixedSizeBinaryBuilder,
    terminal_logical_node: RunCachedStringDictionaryBuilder,
    row_lineage_output_kind: RunCachedStringDictionaryBuilder,
    row_lineage_row_index: UInt32Builder,
}

impl ResultCellBuilders {
    fn new() -> Self {
        Self {
            output_kind: RunCachedStringDictionaryBuilder::with_capacity(
                RESULT_CELL_BATCH_ROWS,
                16,
            ),
            address_kind: RunCachedStringDictionaryBuilder::with_capacity(
                RESULT_CELL_BATCH_ROWS,
                8,
            ),
            output_row_index: UInt32Builder::with_capacity(RESULT_CELL_BATCH_ROWS),
            selector: StringDictionaryBuilder::with_capacity(RESULT_CELL_BATCH_ROWS, 256, 16_384),
            cell_value_digest: FixedSizeBinaryBuilder::with_capacity(RESULT_CELL_BATCH_ROWS, 32),
            terminal_logical_node: RunCachedStringDictionaryBuilder::with_capacity(
                RESULT_CELL_BATCH_ROWS,
                16,
            ),
            row_lineage_output_kind: RunCachedStringDictionaryBuilder::with_capacity(
                RESULT_CELL_BATCH_ROWS,
                16,
            ),
            row_lineage_row_index: UInt32Builder::with_capacity(RESULT_CELL_BATCH_ROWS),
        }
    }

    fn with_dictionaries(dictionaries: &ResultCellDictionaries) -> Result<Self, String> {
        let dictionary = |values: &StringArray| {
            RunCachedStringDictionaryBuilder::with_dictionary(values, RESULT_CELL_BATCH_ROWS)
        };
        Ok(Self {
            output_kind: dictionary(&dictionaries.output_kind)?,
            address_kind: dictionary(&dictionaries.address_kind)?,
            output_row_index: UInt32Builder::with_capacity(RESULT_CELL_BATCH_ROWS),
            selector: StringDictionaryBuilder::new_with_dictionary(
                RESULT_CELL_BATCH_ROWS,
                &dictionaries.selector,
            )
            .map_err(|error| error.to_string())?,
            cell_value_digest: FixedSizeBinaryBuilder::with_capacity(RESULT_CELL_BATCH_ROWS, 32),
            terminal_logical_node: dictionary(&dictionaries.terminal_logical_node)?,
            row_lineage_output_kind: dictionary(&dictionaries.row_lineage_output_kind)?,
            row_lineage_row_index: UInt32Builder::with_capacity(RESULT_CELL_BATCH_ROWS),
        })
    }

    fn len(&self) -> usize {
        self.output_row_index.len()
    }

    fn finish(mut self, schema: Arc<Schema>) -> Result<RecordBatch, String> {
        let arrays: Vec<ArrayRef> = vec![
            Arc::new(self.output_kind.finish()?),
            Arc::new(self.address_kind.finish()?),
            Arc::new(self.output_row_index.finish()),
            Arc::new(self.selector.finish()),
            Arc::new(self.cell_value_digest.finish()),
            Arc::new(self.terminal_logical_node.finish()?),
            Arc::new(self.row_lineage_output_kind.finish()?),
            Arc::new(self.row_lineage_row_index.finish()),
        ];
        RecordBatch::try_new(schema, arrays)
            .map_err(|error| format!("build result-cell correspondence Arrow batch: {error}"))
    }
}

struct ResultCellDictionaries {
    output_kind: StringArray,
    address_kind: StringArray,
    selector: StringArray,
    terminal_logical_node: StringArray,
    row_lineage_output_kind: StringArray,
}

impl ResultCellDictionaries {
    fn from_batch(batch: &RecordBatch) -> Result<Self, String> {
        let values = |column_index: usize| {
            batch
                .column(column_index)
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .and_then(|dictionary| dictionary.values().as_any().downcast_ref::<StringArray>())
                .cloned()
                .ok_or_else(|| {
                    format!("result-cell column {column_index} is not a string dictionary")
                })
        };
        Ok(Self {
            output_kind: values(0)?,
            address_kind: values(1)?,
            selector: values(3)?,
            terminal_logical_node: values(5)?,
            row_lineage_output_kind: values(6)?,
        })
    }
}

const RESULT_CELL_BATCH_ROWS: usize = 131_072;

fn result_cell_schema() -> Arc<Schema> {
    let mut metadata = HashMap::new();
    metadata.insert(
        "protocolVersion".into(),
        RESULT_CELL_CORRESPONDENCE_PROTOCOL.into(),
    );
    metadata.insert(
        "claimBoundary".into(),
        "Exact canonical tabular cell coordinates and value digests; exact joins to output-row lineage keys; raw-row contributors remain conservative and semantic dependencies remain declared-transitive.".into(),
    );
    metadata.insert("recordBatchCompression".into(), "lz4-frame".into());
    metadata.insert("recordBatchRows".into(), RESULT_CELL_BATCH_ROWS.to_string());
    metadata.insert(
        "dependencyIdentityDerivation".into(),
        "sha256(length-prefixed protocolVersion, output_kind, selector, terminal_logical_node)"
            .into(),
    );
    metadata.insert(
        "rowCorrespondencePrecisionDerivation".into(),
        "row_lineage_output_kind and row_lineage_row_index present => conservative; otherwise output_row_index present => unresolved; otherwise not-applicable".into(),
    );
    metadata.insert(
        "semanticDependencyPrecision".into(),
        "declared-transitive".into(),
    );
    Arc::new(Schema::new_with_metadata(
        vec![
            Field::new("output_kind", dictionary_type(), false),
            Field::new("address_kind", dictionary_type(), false),
            Field::new("output_row_index", DataType::UInt32, true),
            Field::new("selector", dictionary_type(), false),
            Field::new("cell_value_sha256", DataType::FixedSizeBinary(32), false),
            Field::new("terminal_logical_node", dictionary_type(), false),
            Field::new("row_lineage_output_kind", dictionary_type(), true),
            Field::new("row_lineage_row_index", DataType::UInt32, true),
        ],
        metadata,
    ))
}

struct ResultCellBatchWriter {
    schema: Arc<Schema>,
    writer: FileWriter<Cursor<Vec<u8>>>,
    builders: ResultCellBuilders,
    row_count: u32,
}

impl ResultCellBatchWriter {
    fn new() -> Result<Self, String> {
        let schema = result_cell_schema();
        let write_options = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|error| format!("configure result-cell compression: {error}"))?
            .with_dictionary_handling(DictionaryHandling::Delta);
        let writer =
            FileWriter::try_new_with_options(Cursor::new(Vec::new()), &schema, write_options)
                .map_err(|error| format!("create result-cell correspondence writer: {error}"))?;
        Ok(Self {
            schema,
            writer,
            builders: ResultCellBuilders::new(),
            row_count: 0,
        })
    }

    fn finish_row(&mut self) -> Result<(), String> {
        self.row_count = self
            .row_count
            .checked_add(1)
            .ok_or_else(|| "result cell correspondence exceeds u32 rows".to_string())?;
        if self.builders.len() >= RESULT_CELL_BATCH_ROWS {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        if self.builders.len() == 0 {
            return Ok(());
        }
        let builders = std::mem::replace(&mut self.builders, ResultCellBuilders::new());
        let batch = builders.finish(self.schema.clone())?;
        let dictionaries = ResultCellDictionaries::from_batch(&batch)?;
        self.builders = ResultCellBuilders::with_dictionaries(&dictionaries)?;
        self.writer
            .write(&batch)
            .map_err(|error| format!("write result-cell correspondence batch: {error}"))
    }

    fn finish(mut self) -> Result<(Vec<u8>, u32), String> {
        self.flush()?;
        let output = self
            .writer
            .into_inner()
            .map_err(|error| format!("finish result-cell correspondence file: {error}"))?;
        Ok((output.into_inner(), self.row_count))
    }
}

fn sha256_array(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

struct Sha256Writer<'a>(&'a mut Sha256);

impl Write for Sha256Writer<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn canonical_json_value_digest(value: &serde_json::Value) -> Result<[u8; 32], String> {
    let mut digest = Sha256::new();
    serde_jcs::to_writer(Sha256Writer(&mut digest), value)
        .map_err(|error| format!("canonicalize JSON value: {error}"))?;
    Ok(digest.finalize().into())
}

const VALUE_DIGEST_CACHE_MAX_ENTRIES: usize = 256;

struct BoundedValueDigestCache {
    values: Option<HashMap<Vec<u8>, [u8; 32]>>,
}

impl Default for BoundedValueDigestCache {
    fn default() -> Self {
        Self {
            values: Some(HashMap::new()),
        }
    }
}

impl BoundedValueDigestCache {
    fn digest(&mut self, bytes: &[u8]) -> [u8; 32] {
        let Some(values) = &mut self.values else {
            return sha256_array(bytes);
        };
        if let Some(digest) = values.get(bytes) {
            return *digest;
        }
        let digest = sha256_array(bytes);
        if values.len() < VALUE_DIGEST_CACHE_MAX_ENTRIES {
            values.insert(bytes.to_vec(), digest);
        } else {
            self.values = None;
        }
        digest
    }
}

#[cfg(test)]
fn dependency_spec_prefix(output_kind: &str) -> Sha256 {
    let mut hasher = Sha256::new();
    for field in [RESULT_CELL_CORRESPONDENCE_PROTOCOL, output_kind] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field.as_bytes());
    }
    hasher
}

#[cfg(test)]
fn dependency_spec_digest_from_prefix(
    prefix: &Sha256,
    selector: &str,
    terminal_node: &str,
) -> [u8; 32] {
    let mut hasher = prefix.clone();
    for field in [selector, terminal_node] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field.as_bytes());
    }
    hasher.finalize().into()
}

#[cfg(test)]
fn dependency_spec_digest(output_kind: &str, selector: &str, terminal_node: &str) -> [u8; 32] {
    dependency_spec_digest_from_prefix(
        &dependency_spec_prefix(output_kind),
        selector,
        terminal_node,
    )
}

struct ResultCellInput<'a> {
    address_kind: &'static str,
    output_row_index: Option<u32>,
    selector: &'a str,
    value_bytes: &'a [u8],
    cached_value_digest: Option<[u8; 32]>,
    row_lineage: Option<&'a PipelineRowLineage>,
}

fn push_cell(
    batch_writer: &mut ResultCellBatchWriter,
    output: &CanonicalOutput<'_>,
    input: ResultCellInput<'_>,
) -> Result<(), String> {
    let builders = &mut batch_writer.builders;
    let ResultCellInput {
        address_kind,
        output_row_index,
        selector,
        value_bytes,
        cached_value_digest,
        row_lineage,
    } = input;
    builders
        .output_kind
        .append(output.kind)
        .map_err(|error| error.to_string())?;
    builders
        .address_kind
        .append(address_kind)
        .map_err(|error| error.to_string())?;
    if let Some(output_row_index) = output_row_index {
        builders.output_row_index.append_value(output_row_index);
    } else {
        builders.output_row_index.append_null();
    }
    builders
        .selector
        .append(selector)
        .map_err(|error| error.to_string())?;
    builders
        .cell_value_digest
        .append_value(cached_value_digest.unwrap_or_else(|| sha256_array(value_bytes)))
        .map_err(|error| error.to_string())?;
    builders
        .terminal_logical_node
        .append(output.terminal_logical_node)
        .map_err(|error| error.to_string())?;
    if let Some(lineage) = row_lineage {
        builders
            .row_lineage_output_kind
            .append(&lineage.output_kind)
            .map_err(|error| error.to_string())?;
        builders
            .row_lineage_row_index
            .append_value(lineage.output_row_index);
    } else {
        builders.row_lineage_output_kind.append_null();
        builders.row_lineage_row_index.append_null();
    }
    batch_writer.finish_row()
}

fn json_pointer_escape(value: &str) -> String {
    let mut escaped = String::new();
    push_json_pointer_segment(&mut escaped, value);
    escaped.remove(0);
    escaped
}

fn push_json_pointer_segment(path: &mut String, value: &str) {
    path.push('/');
    for character in value.chars() {
        match character {
            '~' => path.push_str("~0"),
            '/' => path.push_str("~1"),
            other => path.push(other),
        }
    }
}

fn append_json_cells(
    batch_writer: &mut ResultCellBatchWriter,
    output: &CanonicalOutput<'_>,
    path: &mut String,
    value: &serde_json::Value,
) -> Result<(), String> {
    match value {
        serde_json::Value::Array(values) => {
            if values.is_empty() {
                push_cell(
                    batch_writer,
                    output,
                    ResultCellInput {
                        address_kind: "json-leaf",
                        output_row_index: None,
                        selector: path,
                        value_bytes: b"[]",
                        cached_value_digest: Some(sha256_array(b"[]")),
                        row_lineage: None,
                    },
                )?;
            }
            for (index, value) in values.iter().enumerate() {
                let previous_len = path.len();
                write!(path, "/{index}").expect("writing to String cannot fail");
                append_json_cells(batch_writer, output, path, value)?;
                path.truncate(previous_len);
            }
        }
        serde_json::Value::Object(values) => {
            if values.is_empty() {
                push_cell(
                    batch_writer,
                    output,
                    ResultCellInput {
                        address_kind: "json-leaf",
                        output_row_index: None,
                        selector: path,
                        value_bytes: b"{}",
                        cached_value_digest: Some(sha256_array(b"{}")),
                        row_lineage: None,
                    },
                )?;
            }
            for (key, value) in values {
                let previous_len = path.len();
                push_json_pointer_segment(path, key);
                append_json_cells(batch_writer, output, path, value)?;
                path.truncate(previous_len);
            }
        }
        _ => {
            let value_digest = canonical_json_value_digest(value)
                .map_err(|error| format!("canonicalize JSON result cell {path}: {error}"))?;
            push_cell(
                batch_writer,
                output,
                ResultCellInput {
                    address_kind: "json-leaf",
                    output_row_index: None,
                    selector: path,
                    value_bytes: &[],
                    cached_value_digest: Some(value_digest),
                    row_lineage: None,
                },
            )?;
        }
    }
    Ok(())
}

fn append_csv_cells(
    batch_writer: &mut ResultCellBatchWriter,
    output: &CanonicalOutput<'_>,
    lineages: Option<&[Option<&PipelineRowLineage>]>,
) -> Result<(), String> {
    std::str::from_utf8(output.bytes)
        .map_err(|error| format!("read {} result CSV as UTF-8: {error}", output.kind))?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(output.bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("read {} result CSV header: {error}", output.kind))?
        .clone();
    let mut sorted_columns = headers.iter().enumerate().collect::<Vec<_>>();
    sorted_columns.sort_by_key(|(_, column)| *column);
    let mut value_digest_caches = (0..sorted_columns.len())
        .map(|_| BoundedValueDigestCache::default())
        .collect::<Vec<_>>();
    let mut row_count = 0_u32;
    let mut row = csv::ByteRecord::new();
    let mut next_row_index = 0_usize;
    while reader
        .read_byte_record(&mut row)
        .map_err(|error| format!("read {} result CSV row: {error}", output.kind))?
    {
        let row_index = u32::try_from(next_row_index)
            .map_err(|_| format!("{} row index exceeds u32", output.kind))?;
        row_count = row_index.saturating_add(1);
        let lineage = lineages
            .and_then(|rows| rows.get(row_index as usize))
            .copied()
            .flatten();
        for (sorted_index, (column_index, column)) in sorted_columns.iter().enumerate() {
            let value_bytes = row.get(*column_index).unwrap_or_default();
            push_cell(
                batch_writer,
                output,
                ResultCellInput {
                    address_kind: "csv-cell",
                    output_row_index: Some(row_index),
                    selector: column,
                    value_bytes,
                    cached_value_digest: Some(
                        value_digest_caches[sorted_index].digest(value_bytes),
                    ),
                    row_lineage: lineage,
                },
            )?;
        }
        next_row_index += 1;
    }
    push_cell(
        batch_writer,
        output,
        ResultCellInput {
            address_kind: "csv-shape",
            output_row_index: None,
            selector: "/shape/rows",
            value_bytes: row_count.to_string().as_bytes(),
            cached_value_digest: None,
            row_lineage: None,
        },
    )?;
    let header_values = headers.iter().collect::<Vec<_>>();
    let columns = serde_jcs::to_vec(&header_values)
        .map_err(|error| format!("canonicalize {} columns: {error}", output.kind))?;
    push_cell(
        batch_writer,
        output,
        ResultCellInput {
            address_kind: "csv-shape",
            output_row_index: None,
            selector: "/shape/columns",
            value_bytes: &columns,
            cached_value_digest: None,
            row_lineage: None,
        },
    )?;
    Ok(())
}

fn dictionary_type() -> DataType {
    DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8))
}

/// Stable exact coordinates for every state-bearing ingress CSV cell or JSON
/// leaf. These are dependency-witness endpoints, not claims that a coordinate
/// affected a particular output. The source artifact digest preserves byte
/// identity while `normalization` makes decoded/normalized coordinate spaces
/// explicit.
pub fn source_coordinate_index_arrow(
    sources: &[CanonicalSource<'_>],
) -> Result<(Vec<u8>, u32), String> {
    let mut batch_writer = SourceCoordinateBatchWriter::new()?;
    let mut sorted_sources = sources.iter().collect::<Vec<_>>();
    sorted_sources.sort_by_key(|source| source.role_id);
    for source in sorted_sources {
        match source.coordinate_media_type {
            "text/csv" => append_source_csv_coordinates(&mut batch_writer, source)?,
            "application/json" => {
                let value: serde_json::Value =
                    serde_json::from_slice(source.bytes).map_err(|error| {
                        format!("parse {} source JSON coordinates: {error}", source.role_id)
                    })?;
                append_source_json_coordinates(
                    &mut batch_writer,
                    source,
                    &mut String::new(),
                    &value,
                )?;
            }
            other => {
                return Err(format!(
                    "unsupported source coordinate media type {other} for {}",
                    source.role_id
                ));
            }
        }
    }
    batch_writer.finish()
}

/// A compact, normalized index of every canonical CSV/JSON result cell.
///
/// Cell coordinates and value identities are exact. CSV cells join to the
/// existing row-lineage table through `(row_lineage_output_kind,
/// row_lineage_row_index)`. The joined raw-row relation remains explicitly
/// conservative until product kernels retain field-level contributor sets.
pub fn result_cell_correspondence_arrow(
    outputs: &[CanonicalOutput<'_>],
    row_lineages: &[PipelineRowLineage],
) -> Result<(Vec<u8>, u32), String> {
    let mut lineages = BTreeMap::<&str, Vec<Option<&PipelineRowLineage>>>::new();
    for lineage in row_lineages {
        let row_index = lineage.output_row_index as usize;
        let rows = lineages.entry(lineage.output_kind.as_str()).or_default();
        if rows.len() <= row_index {
            rows.resize(row_index + 1, None);
        }
        if rows[row_index].replace(lineage).is_some() {
            return Err(format!(
                "duplicate row lineage for {} row {}",
                lineage.output_kind, lineage.output_row_index
            ));
        }
    }
    let mut batch_writer = ResultCellBatchWriter::new()?;
    let mut sorted_outputs = outputs.iter().collect::<Vec<_>>();
    sorted_outputs.sort_by_key(|output| output.kind);
    for output in sorted_outputs {
        match output.media_type {
            "text/csv" => append_csv_cells(
                &mut batch_writer,
                output,
                lineages.get(output.kind).map(Vec::as_slice),
            )?,
            "application/json" => {
                let value: serde_json::Value = serde_json::from_slice(output.bytes)
                    .map_err(|error| format!("parse {} JSON cells: {error}", output.kind))?;
                append_json_cells(&mut batch_writer, output, &mut String::new(), &value)?;
            }
            other => return Err(format!("unsupported canonical cell media type {other}")),
        }
    }
    batch_writer.finish()
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct InfluenceWitnessRecord {
    source_key_kind: &'static str,
    source_role_id: String,
    source_selector_prefix: Option<String>,
    source_field: Option<String>,
    source_record_index: Option<u32>,
    source_record_last: Option<u32>,
    source_index_space: Option<String>,
    target_kind: &'static str,
    target_id: String,
    target_logical_node: String,
    target_output_kind: Option<String>,
    target_output_row_index: Option<u32>,
    target_output_column: Option<String>,
    relation: &'static str,
    precision: &'static str,
    evidence_kind: &'static str,
    evidence_digest: [u8; 32],
}

struct InfluenceWitnessSpec<'a> {
    source_key_kind: &'static str,
    source_role_id: &'a str,
    source_selector_prefix: Option<&'a str>,
    /// The exact supplied column, in the step contract's `<role>.<column>`
    /// field namespace. Null on rows that claim only role-level reach.
    source_field: Option<&'a str>,
    source_record_index: Option<u32>,
    source_record_last: Option<u32>,
    /// Names the ordering `source_record_index` / `source_record_last` are
    /// positions in, whenever that is *not* the source-coordinate index's
    /// `one-based-data-row` space. Non-null exactly on the
    /// `lineage-search-window` rows, which count pipeline-internal events and
    /// are therefore excluded from `sourceCoordinateJoin`.
    source_index_space: Option<&'a str>,
    target_kind: &'static str,
    target_id: String,
    target_logical_node: String,
    target_output_kind: Option<String>,
    target_output_row_index: Option<u32>,
    /// The exact output column, or the `*`-globbed JSON pointer family the step
    /// contract binds. Null on rows that claim only whole-artifact reach.
    target_output_column: Option<&'a str>,
    relation: &'static str,
    precision: &'static str,
    evidence_kind: &'static str,
    extra_evidence: &'a [u8],
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct SourceScope {
    role_id: String,
    selector_prefix: Option<String>,
    reached_nodes: BTreeSet<String>,
}

fn json_pointer_head(selector: &str) -> Option<String> {
    let encoded = selector.strip_prefix('/')?.split('/').next()?;
    Some(encoded.replace("~1", "/").replace("~0", "~"))
}

fn downstream_closure(plan: &ChroniclePlan, seeds: BTreeSet<String>) -> BTreeSet<String> {
    let mut reached = seeds;
    let mut frontier = reached.iter().cloned().collect::<VecDeque<_>>();
    while let Some(source_node) = frontier.pop_front() {
        for node in &plan.nodes {
            if node.input_nodes.contains(&source_node) && reached.insert(node.node_id.clone()) {
                frontier.push_back(node.node_id.clone());
            }
        }
    }
    reached
}

/// Distinct source scopes and their declared downstream reach. A scope is a
/// whole source role, or one top-level JSON pointer prefix of the
/// `processing_options` document — the same selector space the streamed
/// source-coordinate index addresses, without materializing its records.
fn source_scopes(
    sources: &[CanonicalSource<'_>],
    plan: &ChroniclePlan,
) -> Result<Vec<SourceScope>, String> {
    let mut keys = BTreeSet::new();
    for source in sources {
        if source.role_id == "processing_options"
            && source.coordinate_media_type == "application/json"
        {
            let value: serde_json::Value =
                serde_json::from_slice(source.bytes).map_err(|error| {
                    format!("parse {} source JSON coordinates: {error}", source.role_id)
                })?;
            let prefixes = match &value {
                serde_json::Value::Object(values) => values
                    .keys()
                    .map(|key| format!("/{}", json_pointer_escape(key)))
                    .collect::<Vec<_>>(),
                serde_json::Value::Array(values) => {
                    (0..values.len()).map(|index| format!("/{index}")).collect()
                }
                _ => Vec::new(),
            };
            if prefixes.is_empty() {
                keys.insert((source.role_id.to_string(), None));
            }
            for prefix in prefixes {
                keys.insert((source.role_id.to_string(), Some(prefix)));
            }
        } else {
            keys.insert((source.role_id.to_string(), None));
        }
    }
    Ok(keys
        .into_iter()
        .map(|(role_id, selector_prefix)| {
            let mut seeds = BTreeSet::new();
            if role_id == "raw_chronicle_csv" {
                seeds.insert("parse_events".to_string());
            } else if role_id == "processing_options" {
                let option_key = selector_prefix.as_deref().and_then(json_pointer_head);
                if let Some(option_key) = option_key {
                    for node in &plan.nodes {
                        if node.knobs.iter().any(|knob| {
                            crate::exact_option_key_reaches_certified(
                                &option_key,
                                &knob.option_key,
                            )
                        }) {
                            seeds.insert(node.node_id.clone());
                        }
                    }
                }
            } else {
                for node in &plan.nodes {
                    if node.support_roles.contains(&role_id) {
                        seeds.insert(node.node_id.clone());
                    }
                }
            }
            SourceScope {
                role_id,
                selector_prefix,
                reached_nodes: downstream_closure(plan, seeds),
            }
        })
        .collect())
}

fn influence_evidence_digest(
    context: &InfluenceContext<'_>,
    source_key: &str,
    target_kind: &str,
    target_id: &str,
    relation: &str,
    extra: &[u8],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for field in [
        SOURCE_RESULT_INFLUENCE_PROTOCOL.as_bytes(),
        context.implementation_digest.as_bytes(),
        context.plan_digest.as_bytes(),
        context.profile_lock_digest.as_bytes(),
        context.dependency_certificate_digest.as_bytes(),
        source_key.as_bytes(),
        target_kind.as_bytes(),
        target_id.as_bytes(),
        relation.as_bytes(),
        extra,
    ] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field);
    }
    hasher.finalize().into()
}

fn append_influence_witness(
    records: &mut Vec<InfluenceWitnessRecord>,
    context: &InfluenceContext<'_>,
    spec: InfluenceWitnessSpec<'_>,
) {
    let source_key = format!(
        "{}:{}:{}:{}:{}:{}",
        spec.source_key_kind,
        spec.source_role_id,
        spec.source_selector_prefix.unwrap_or("*"),
        spec.source_field.unwrap_or("*"),
        match (spec.source_record_index, spec.source_record_last) {
            (Some(first), Some(last)) => format!("{first}-{last}"),
            (Some(first), None) => first.to_string(),
            _ => "*".into(),
        },
        spec.source_index_space.unwrap_or("*"),
    );
    let evidence_digest = influence_evidence_digest(
        context,
        &source_key,
        spec.target_kind,
        &spec.target_id,
        spec.relation,
        spec.extra_evidence,
    );
    records.push(InfluenceWitnessRecord {
        source_key_kind: spec.source_key_kind,
        source_role_id: spec.source_role_id.into(),
        source_selector_prefix: spec.source_selector_prefix.map(str::to_string),
        source_field: spec.source_field.map(str::to_string),
        source_record_index: spec.source_record_index,
        source_record_last: spec.source_record_last,
        source_index_space: spec.source_index_space.map(str::to_string),
        target_kind: spec.target_kind,
        target_id: spec.target_id,
        target_logical_node: spec.target_logical_node,
        target_output_kind: spec.target_output_kind,
        target_output_row_index: spec.target_output_row_index,
        target_output_column: spec.target_output_column.map(str::to_string),
        relation: spec.relation,
        precision: spec.precision,
        evidence_kind: spec.evidence_kind,
        evidence_digest,
    });
}

/// A compact, proof-carrying bridge between exact source coordinates, typed
/// logical checkpoints, output rows, and result cells.
///
/// This is deliberately normalized rather than a materialized coordinate ×
/// cell closure. Consumers join source coordinates by role/selector-prefix or
/// raw-row key, then join result cells by output-kind/output-row key. This
/// retains the exact endpoints while avoiding redundant Cartesian expansion.
///
/// One kind never joins to the source-coordinate index:
/// `LINEAGE_SEARCH_SOURCE_KEY_KIND` rows address pipeline-internal event
/// positions in the ordering their `source_index_space` names, not raw data
/// rows, and the published `sourceCoordinateJoin` excludes them.
pub fn source_result_influence_witness_arrow(
    sources: &[CanonicalSource<'_>],
    outputs: &[CanonicalOutput<'_>],
    row_lineages: &[PipelineRowLineage],
    plan: &ChroniclePlan,
    checkpoints: &BTreeMap<String, LogicalStageCheckpoint>,
    context: &InfluenceContext<'_>,
) -> Result<(Vec<u8>, u32), String> {
    let scopes = source_scopes(sources, plan)?;
    let output_scopes = outputs
        .iter()
        .map(|output| (output.kind, output.terminal_logical_node))
        .collect::<BTreeSet<_>>();
    let row_lineage_outputs = row_lineages
        .iter()
        .map(|lineage| lineage.output_kind.as_str())
        .collect::<BTreeSet<_>>();
    let mut records = Vec::new();

    for scope in &scopes {
        let source_kind = if scope.selector_prefix.is_some() {
            "selector-prefix"
        } else {
            "role-scope"
        };
        for node_id in &scope.reached_nodes {
            if let Some(checkpoint) = checkpoints.get(node_id) {
                append_influence_witness(
                    &mut records,
                    context,
                    InfluenceWitnessSpec {
                        source_key_kind: source_kind,
                        source_role_id: &scope.role_id,
                        source_selector_prefix: scope.selector_prefix.as_deref(),
                        source_record_index: None,
                        source_record_last: None,
                        source_index_space: None,
                        source_field: None,
                        target_kind: "logical-checkpoint",
                        target_id: checkpoint.terminal_digest.clone(),
                        target_logical_node: node_id.clone(),
                        target_output_kind: None,
                        target_output_row_index: None,
                        target_output_column: None,
                        relation: "may-affect-checkpoint",
                        precision: "declared-transitive",
                        evidence_kind: "product-plan-and-typed-checkpoint",
                        extra_evidence: checkpoint.schema_digest.as_bytes(),
                    },
                );
            }
        }
    }

    // Output cell families whose value is a verbatim copy of one supplied
    // column, grouped by the output kind that carries them.
    let exact_contributions = chronicle_chrono_kernel_wasm::step_contract::exact_cell_contributions();
    let mut exact_by_output_kind: BTreeMap<&str, Vec<_>> = BTreeMap::new();
    for contribution in &exact_contributions {
        exact_by_output_kind
            .entry(contribution.output_kind)
            .or_default()
            .push(contribution);
    }

    for lineage in row_lineages {
        for source_range in &lineage.source_data_row_ranges {
            let target_id = format!("{}:{}", lineage.output_kind, lineage.output_row_index);
            let extra = format!(
                "{}-{}:{}",
                source_range.first, source_range.last, lineage.output_row_index
            );
            append_influence_witness(
                &mut records,
                context,
                InfluenceWitnessSpec {
                    source_key_kind: "raw-row",
                    source_role_id: "raw_chronicle_csv",
                    source_selector_prefix: None,
                    source_field: None,
                    source_record_index: Some(source_range.first),
                    source_record_last: Some(source_range.last),
                    source_index_space: None,
                    target_kind: "result-row",
                    target_id,
                    target_logical_node: lineage.terminal_logical_node.to_string(),
                    target_output_kind: Some(lineage.output_kind.to_string()),
                    target_output_row_index: Some(lineage.output_row_index),
                    target_output_column: None,
                    relation: "may-contribute-via-row-lineage",
                    precision: "conservative-row-lineage",
                    evidence_kind: "kernel-row-lineage",
                    extra_evidence: extra.as_bytes(),
                },
            );
        }

        // The stop-event search window is a real control dependency the row
        // ranges do not carry: the scanned records that were rejected still
        // decided which stop was selected. Routing it here is what keeps the
        // search channel from being silently absent from the witness.
        //
        // These bounds are positions in a pipeline-internal ordering — either
        // `pipeline-event-order` (post-`drop_empty_timestamp`, post-sort,
        // post-dedupe) or the 0-based `participant-source-event-order` — never
        // the source-coordinate index's `one-based-data-row` space. They carry
        // their own `source_key_kind`, name the space in `source_index_space`,
        // and are excluded from `sourceCoordinateJoin`. Publishing them as
        // `raw-row` asserted a raw-record range that is a *different* set, not
        // a superset, of what was scanned — a `participant-source-event-order`
        // search starting at 0 addressed a record outside the one-based space
        // entirely, so the `conservative-search-window` claim was false.
        for search in &lineage.searches {
            if search.end_event_index_exclusive <= search.start_event_index {
                continue;
            }
            let target_id = format!("{}:{}", lineage.output_kind, lineage.output_row_index);
            let mut extra = format!("{}:{}:", search.reason, search.index_space).into_bytes();
            extra.extend_from_slice(search.candidate_chain_digest.as_bytes());
            append_influence_witness(
                &mut records,
                context,
                InfluenceWitnessSpec {
                    source_key_kind: LINEAGE_SEARCH_SOURCE_KEY_KIND,
                    source_role_id: "raw_chronicle_csv",
                    source_selector_prefix: None,
                    source_field: None,
                    source_record_index: Some(search.start_event_index),
                    source_record_last: Some(search.end_event_index_exclusive - 1),
                    source_index_space: Some(search.index_space.as_str()),
                    target_kind: "result-row",
                    target_id,
                    target_logical_node: lineage.terminal_logical_node.to_string(),
                    target_output_kind: Some(lineage.output_kind.to_string()),
                    target_output_row_index: Some(lineage.output_row_index),
                    target_output_column: None,
                    relation: "may-contribute-via-lineage-search",
                    precision: "conservative-search-window",
                    evidence_kind: "kernel-lineage-search",
                    extra_evidence: &extra,
                },
            );
        }

        // Exactly one contributing raw record and no search window means the
        // verbatim-copy columns of this output row came from that one record.
        let single_record = match lineage.source_data_row_ranges.as_slice() {
            [only] if only.first == only.last && lineage.searches.is_empty() => Some(only.first),
            _ => None,
        };
        let Some(record_index) = single_record else {
            continue;
        };
        for contribution in exact_by_output_kind
            .get(lineage.output_kind.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let target_id = format!(
                "{}:{}:{}",
                lineage.output_kind, lineage.output_row_index, contribution.column
            );
            let extra = format!("{}:{}", contribution.source_field, record_index);
            append_influence_witness(
                &mut records,
                context,
                InfluenceWitnessSpec {
                    source_key_kind: "source-column-record",
                    source_role_id: "raw_chronicle_csv",
                    source_selector_prefix: None,
                    source_field: Some(contribution.source_field),
                    source_record_index: Some(record_index),
                    source_record_last: Some(record_index),
                    source_index_space: None,
                    target_kind: "result-cell",
                    target_id,
                    target_logical_node: lineage.terminal_logical_node.to_string(),
                    target_output_kind: Some(lineage.output_kind.to_string()),
                    target_output_row_index: Some(lineage.output_row_index),
                    target_output_column: Some(contribution.column),
                    relation: "exact-field-contribution",
                    precision: "exact-field",
                    evidence_kind: "kernel-row-lineage-and-field-contract",
                    extra_evidence: extra.as_bytes(),
                },
            );
        }
    }

    // Column-granular declared reach. Output families that carry no row
    // lineage at all (compliance, day coverage, review summary, visualization
    // data, every aggregate) would otherwise be one unresolved whole-artifact
    // gap; the field contract resolves them to named output columns.
    let present_roles = sources
        .iter()
        .map(|source| source.role_id)
        .collect::<BTreeSet<_>>();
    let cell_scope_kinds = output_scopes
        .iter()
        .filter(|(output_kind, _)| !row_lineage_outputs.contains(output_kind))
        .copied()
        .collect::<BTreeMap<_, _>>();
    let mut column_witnessed_scopes = BTreeSet::new();
    for reach in chronicle_chrono_kernel_wasm::step_contract::source_column_output_reach() {
        let Some((role_id, _column)) = reach.source_field.split_once('.') else {
            continue;
        };
        if !present_roles.contains(role_id) {
            continue;
        }
        for cell in &reach.cells {
            let Some(terminal_node) = cell_scope_kinds.get(cell.output_kind) else {
                continue;
            };
            column_witnessed_scopes.insert((role_id, cell.output_kind));
            let target_id = format!("{}:{}", cell.output_kind, cell.column);
            append_influence_witness(
                &mut records,
                context,
                InfluenceWitnessSpec {
                    source_key_kind: "source-column",
                    source_role_id: role_id,
                    source_selector_prefix: None,
                    source_field: Some(reach.source_field),
                    source_record_index: None,
                    source_record_last: None,
                    source_index_space: None,
                    target_kind: "result-column",
                    target_id,
                    target_logical_node: (*terminal_node).into(),
                    target_output_kind: Some(cell.output_kind.into()),
                    target_output_row_index: None,
                    target_output_column: Some(cell.column),
                    relation: "may-affect-output-column",
                    precision: "declared-column-scope",
                    evidence_kind: "field-level-step-contract",
                    extra_evidence: cell.emitting_step.as_bytes(),
                },
            );
        }
    }

    for scope in &scopes {
        let source_kind = if scope.selector_prefix.is_some() {
            "selector-prefix"
        } else {
            "role-scope"
        };
        for (output_kind, terminal_node) in &output_scopes {
            let no_declared_binding = scope.reached_nodes.is_empty();
            let reached_output = scope.reached_nodes.contains(*terminal_node);
            let has_row_witness =
                scope.role_id == "raw_chronicle_csv" && row_lineage_outputs.contains(*output_kind);
            // A scope now also counts as witnessed when the field contract
            // resolved it to named output columns above. An explicit gap row
            // survives only where no lineage information exists at all.
            let has_column_witness = column_witnessed_scopes
                .contains(&(scope.role_id.as_str(), *output_kind));
            if no_declared_binding
                || (reached_output && !has_row_witness && !has_column_witness)
            {
                append_influence_witness(
                    &mut records,
                    context,
                    InfluenceWitnessSpec {
                        source_key_kind: source_kind,
                        source_role_id: &scope.role_id,
                        source_selector_prefix: scope.selector_prefix.as_deref(),
                        source_field: None,
                        source_record_index: None,
                        source_record_last: None,
                        source_index_space: None,
                        target_kind: "result-scope",
                        target_id: (*output_kind).into(),
                        target_logical_node: (*terminal_node).into(),
                        target_output_kind: Some((*output_kind).into()),
                        target_output_row_index: None,
                        target_output_column: None,
                        relation: if no_declared_binding {
                            "semantic-scope-unresolved"
                        } else {
                            "cell-contribution-unresolved"
                        },
                        precision: "unresolved",
                        evidence_kind: "explicit-gap",
                        extra_evidence: output_kind.as_bytes(),
                    },
                );
            }
        }
    }

    records.sort_by(|left, right| {
        (
            left.source_key_kind,
            left.source_role_id.as_str(),
            left.source_selector_prefix.as_deref(),
            left.source_field.as_deref(),
            left.source_index_space.as_deref(),
            left.source_record_index,
            left.source_record_last,
            left.target_kind,
            left.target_id.as_str(),
            left.relation,
        )
            .cmp(&(
                right.source_key_kind,
                right.source_role_id.as_str(),
                right.source_selector_prefix.as_deref(),
                right.source_field.as_deref(),
                right.source_index_space.as_deref(),
                right.source_record_index,
                right.source_record_last,
                right.target_kind,
                right.target_id.as_str(),
                right.relation,
            ))
    });
    records.dedup();
    let row_count = u32::try_from(records.len())
        .map_err(|_| "source-result influence witness exceeds u32 rows".to_string())?;

    let mut source_key_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut source_role_id = StringDictionaryBuilder::<Int32Type>::new();
    let mut source_selector_prefix = StringDictionaryBuilder::<Int32Type>::new();
    let mut source_field = StringDictionaryBuilder::<Int32Type>::new();
    let source_record_index = UInt32Array::from(
        records
            .iter()
            .map(|record| record.source_record_index)
            .collect::<Vec<_>>(),
    );
    let source_record_last = UInt32Array::from(
        records
            .iter()
            .map(|record| record.source_record_last)
            .collect::<Vec<_>>(),
    );
    let mut source_index_space = StringDictionaryBuilder::<Int32Type>::new();
    let mut target_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut target_id = StringDictionaryBuilder::<Int32Type>::new();
    let mut target_logical_node = StringDictionaryBuilder::<Int32Type>::new();
    let mut target_output_kind = StringDictionaryBuilder::<Int32Type>::new();
    let target_output_row_index = UInt32Array::from(
        records
            .iter()
            .map(|record| record.target_output_row_index)
            .collect::<Vec<_>>(),
    );
    let mut target_output_column = StringDictionaryBuilder::<Int32Type>::new();
    let mut relation = StringDictionaryBuilder::<Int32Type>::new();
    let mut precision = StringDictionaryBuilder::<Int32Type>::new();
    let mut evidence_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut evidence_digest = FixedSizeBinaryBuilder::with_capacity(records.len(), 32);

    for record in &records {
        source_key_kind
            .append(record.source_key_kind)
            .map_err(|error| error.to_string())?;
        source_role_id
            .append(&record.source_role_id)
            .map_err(|error| error.to_string())?;
        if let Some(value) = &record.source_selector_prefix {
            source_selector_prefix
                .append(value)
                .map_err(|error| error.to_string())?;
        } else {
            source_selector_prefix.append_null();
        }
        if let Some(value) = &record.source_field {
            source_field
                .append(value)
                .map_err(|error| error.to_string())?;
        } else {
            source_field.append_null();
        }
        if let Some(value) = &record.source_index_space {
            source_index_space
                .append(value)
                .map_err(|error| error.to_string())?;
        } else {
            source_index_space.append_null();
        }
        target_kind
            .append(record.target_kind)
            .map_err(|error| error.to_string())?;
        target_id
            .append(&record.target_id)
            .map_err(|error| error.to_string())?;
        target_logical_node
            .append(&record.target_logical_node)
            .map_err(|error| error.to_string())?;
        if let Some(value) = &record.target_output_kind {
            target_output_kind
                .append(value)
                .map_err(|error| error.to_string())?;
        } else {
            target_output_kind.append_null();
        }
        if let Some(value) = &record.target_output_column {
            target_output_column
                .append(value)
                .map_err(|error| error.to_string())?;
        } else {
            target_output_column.append_null();
        }
        relation
            .append(record.relation)
            .map_err(|error| error.to_string())?;
        precision
            .append(record.precision)
            .map_err(|error| error.to_string())?;
        evidence_kind
            .append(record.evidence_kind)
            .map_err(|error| error.to_string())?;
        evidence_digest
            .append_value(record.evidence_digest)
            .map_err(|error| error.to_string())?;
    }

    let mut metadata = HashMap::new();
    metadata.insert(
        "protocolVersion".into(),
        SOURCE_RESULT_INFLUENCE_PROTOCOL.into(),
    );
    metadata.insert(
        "claimBoundary".into(),
        "Every row states its own strength in `precision`. `exact-field`: the result cell in `target_output_column` holds a verbatim copy of the supplied cell named by `source_field` in raw record `source_record_index`; the step contract shows that column has exactly one contributor along every declared write of it, and the kernel row lineage shows exactly one contributing raw record with no stop-event search. Whether the row exists and where it sits stay governed by the row-set and row-order dependencies the conservative rows carry, so the exact claim is about the value in an existing cell, not about its presence or position. `declared-column-scope`: the declared field edges connect `source_field` to the named `target_output_column`; it is a may-influence over-approximation and never asserts the cell did change. `conservative-row-lineage`: the inclusive raw-record range may contribute to that result row. `conservative-search-window`: the kernel scanned exactly that inclusive index range while selecting a stop event or establishing that none qualified, so events in it decided the row without appearing in its contributing range; the range is stated in the pipeline-internal ordering named by `source_index_space`, never in raw data rows, and it is not a raw-record claim. `declared-transitive`: plan reachability to a logical checkpoint. `unresolved`: an explicit gap where no lineage information of any kind exists for that scope. Absence of a row is never a non-influence claim.".into(),
    );
    metadata.insert(
        "sourceCoordinateJoin".into(),
        "source_key_kind <> 'lineage-search-window' AND role_id=source_role_id AND (source_selector_prefix is null OR selector=source_selector_prefix OR selector starts source_selector_prefix + '/') AND (source_field is null OR column = split_part(source_field, '.', 2)) AND (source_record_index is null OR (source_record_index <= record_index AND record_index <= coalesce(source_record_last, source_record_index)))".into(),
    );
    metadata.insert(
        "sourceIndexSpace".into(),
        "Null means `source_record_index` / `source_record_last` are source-coordinate record indices in the `one-based-data-row` base the source-coordinate index publishes, and the row joins by `sourceCoordinateJoin`. Non-null names a pipeline-internal ordering those two columns are positions in instead — `pipeline-event-order` counts normalized events after `drop_empty_timestamp`, sorting and dedupe; `participant-source-event-order` is the 0-based per-participant screen-event order. Rows in a non-null space carry `source_key_kind` = 'lineage-search-window', address no raw record, and are excluded from `sourceCoordinateJoin`. Join them instead to the row-lineage artifact's candidate-search rows, which publish the same bounds under `search_index_space`.".into(),
    );
    metadata.insert(
        "resultCellJoin".into(),
        "output_kind=target_output_kind AND (target_output_row_index is null OR output_row_index=target_output_row_index) AND (target_output_column is null OR column matches target_output_column, where a '*' segment stands for any index or key)".into(),
    );
    metadata.insert(
        "precisionClasses".into(),
        "exact-field, declared-column-scope, conservative-row-lineage, conservative-search-window, declared-transitive, unresolved".into(),
    );
    metadata.insert(
        "implementationDigest".into(),
        context.implementation_digest.into(),
    );
    metadata.insert("planDigest".into(), context.plan_digest.into());
    metadata.insert(
        "profileLockDigest".into(),
        context.profile_lock_digest.into(),
    );
    metadata.insert(
        "dependencyCertificateDigest".into(),
        context.dependency_certificate_digest.into(),
    );
    metadata.insert("recordBatchCompression".into(), "lz4-frame".into());
    let schema = Arc::new(Schema::new_with_metadata(
        vec![
            Field::new("source_key_kind", dictionary_type(), false),
            Field::new("source_role_id", dictionary_type(), false),
            Field::new("source_selector_prefix", dictionary_type(), true),
            Field::new("source_field", dictionary_type(), true),
            Field::new("source_record_index", DataType::UInt32, true),
            Field::new("source_record_last", DataType::UInt32, true),
            Field::new("source_index_space", dictionary_type(), true),
            Field::new("target_kind", dictionary_type(), false),
            Field::new("target_id", dictionary_type(), false),
            Field::new("target_logical_node", dictionary_type(), false),
            Field::new("target_output_kind", dictionary_type(), true),
            Field::new("target_output_row_index", DataType::UInt32, true),
            Field::new("target_output_column", dictionary_type(), true),
            Field::new("relation", dictionary_type(), false),
            Field::new("precision", dictionary_type(), false),
            Field::new("evidence_kind", dictionary_type(), false),
            Field::new("evidence_sha256", DataType::FixedSizeBinary(32), false),
        ],
        metadata,
    ));
    let arrays: Vec<ArrayRef> = vec![
        Arc::new(source_key_kind.finish()),
        Arc::new(source_role_id.finish()),
        Arc::new(source_selector_prefix.finish()),
        Arc::new(source_field.finish()),
        Arc::new(source_record_index),
        Arc::new(source_record_last),
        Arc::new(source_index_space.finish()),
        Arc::new(target_kind.finish()),
        Arc::new(target_id.finish()),
        Arc::new(target_logical_node.finish()),
        Arc::new(target_output_kind.finish()),
        Arc::new(target_output_row_index),
        Arc::new(target_output_column.finish()),
        Arc::new(relation.finish()),
        Arc::new(precision.finish()),
        Arc::new(evidence_kind.finish()),
        Arc::new(evidence_digest.finish()),
    ];
    let batch = RecordBatch::try_new(schema.clone(), arrays)
        .map_err(|error| format!("build source-result influence Arrow batch: {error}"))?;
    let mut output = Cursor::new(Vec::new());
    {
        let write_options = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|error| format!("configure source-result influence compression: {error}"))?;
        let mut writer = FileWriter::try_new_with_options(&mut output, &schema, write_options)
            .map_err(|error| format!("create source-result influence writer: {error}"))?;
        writer
            .write(&batch)
            .map_err(|error| format!("write source-result influence batch: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("finish source-result influence file: {error}"))?;
    }
    Ok((output.into_inner(), row_count))
}

pub fn row_lineage_arrow(
    lineages: &[PipelineRowLineage],
    source_input_digest: &str,
) -> Result<Vec<u8>, String> {
    let mut output_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut output_row_index = Vec::new();
    let mut relationship_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut source_data_row_first = Vec::new();
    let mut source_data_row_last = Vec::new();
    let mut source_digest = StringDictionaryBuilder::<Int32Type>::new();
    let mut terminal_logical_node = StringDictionaryBuilder::<Int32Type>::new();
    let mut dependency_precision = StringDictionaryBuilder::<Int32Type>::new();
    let mut search_protocol_version = StringDictionaryBuilder::<Int32Type>::new();
    let mut search_index_space = StringDictionaryBuilder::<Int32Type>::new();
    let mut search_reason = StringDictionaryBuilder::<Int32Type>::new();
    let mut search_start_participant_id = StringDictionaryBuilder::<Int32Type>::new();
    let mut search_start_event_index = Vec::new();
    let mut search_end_event_index_exclusive = Vec::new();
    let mut search_candidate_event_count = Vec::new();
    let mut search_candidate_chain_digest = FixedSizeBinaryBuilder::new(32);
    for lineage in lineages {
        for source_range in &lineage.source_data_row_ranges {
            output_kind
                .append(lineage.output_kind.as_str())
                .map_err(|error| format!("encode lineage output kind: {error}"))?;
            output_row_index.push(lineage.output_row_index);
            relationship_kind
                .append("direct-source-range")
                .map_err(|error| format!("encode lineage relationship: {error}"))?;
            source_data_row_first.push(Some(source_range.first));
            source_data_row_last.push(Some(source_range.last));
            source_digest
                .append(source_input_digest)
                .map_err(|error| format!("encode lineage source digest: {error}"))?;
            terminal_logical_node
                .append(lineage.terminal_logical_node.as_str())
                .map_err(|error| format!("encode lineage terminal node: {error}"))?;
            dependency_precision
                .append("conservative")
                .map_err(|error| format!("encode lineage precision: {error}"))?;
            search_protocol_version.append_null();
            search_index_space.append_null();
            search_reason.append_null();
            search_start_participant_id.append_null();
            search_start_event_index.push(None);
            search_end_event_index_exclusive.push(None);
            search_candidate_event_count.push(None);
            search_candidate_chain_digest.append_null();
        }
        for search in &lineage.searches {
            output_kind
                .append(lineage.output_kind.as_str())
                .map_err(|error| format!("encode lineage output kind: {error}"))?;
            output_row_index.push(lineage.output_row_index);
            relationship_kind
                .append("candidate-search")
                .map_err(|error| format!("encode lineage relationship: {error}"))?;
            source_data_row_first.push(None);
            source_data_row_last.push(None);
            source_digest
                .append(source_input_digest)
                .map_err(|error| format!("encode lineage source digest: {error}"))?;
            terminal_logical_node
                .append(lineage.terminal_logical_node.as_str())
                .map_err(|error| format!("encode lineage terminal node: {error}"))?;
            dependency_precision
                .append("exact-event-range")
                .map_err(|error| format!("encode lineage precision: {error}"))?;
            search_protocol_version
                .append(search.protocol_version.as_str())
                .map_err(|error| format!("encode lineage search protocol: {error}"))?;
            search_index_space
                .append(search.index_space.as_str())
                .map_err(|error| format!("encode lineage search index space: {error}"))?;
            search_reason
                .append(search.reason.as_str())
                .map_err(|error| format!("encode lineage search reason: {error}"))?;
            search_start_participant_id
                .append(search.start_participant_id.as_str())
                .map_err(|error| format!("encode lineage search participant: {error}"))?;
            search_start_event_index.push(Some(search.start_event_index));
            search_end_event_index_exclusive.push(Some(search.end_event_index_exclusive));
            search_candidate_event_count.push(Some(search.candidate_event_count));
            search_candidate_chain_digest
                .append_value(search.candidate_chain_digest.as_bytes())
                .map_err(|error| format!("encode lineage search candidate digest: {error}"))?;
        }
    }
    let mut metadata = HashMap::new();
    metadata.insert(
        "protocolVersion".to_string(),
        ROW_LINEAGE_PROTOCOL.to_string(),
    );
    metadata.insert(
        "claimBoundary".to_string(),
        "direct value sources are kept separate from exact ordered event ranges searched to select a stop or establish that none qualified"
            .to_string(),
    );
    let schema = Arc::new(Schema::new_with_metadata(
        vec![
            Field::new("output_kind", dictionary_type(), false),
            Field::new("output_row_index", DataType::UInt32, false),
            Field::new("relationship_kind", dictionary_type(), false),
            Field::new("source_data_row_first", DataType::UInt32, true),
            Field::new("source_data_row_last", DataType::UInt32, true),
            Field::new("source_input_digest", dictionary_type(), false),
            Field::new("terminal_logical_node", dictionary_type(), false),
            Field::new("dependency_precision", dictionary_type(), false),
            Field::new("search_protocol_version", dictionary_type(), true),
            Field::new("search_index_space", dictionary_type(), true),
            Field::new("search_reason", dictionary_type(), true),
            Field::new("search_start_participant_id", dictionary_type(), true),
            Field::new("search_start_event_index", DataType::UInt32, true),
            Field::new("search_end_event_index_exclusive", DataType::UInt32, true),
            Field::new("search_candidate_event_count", DataType::UInt32, true),
            Field::new(
                "search_candidate_chain_digest",
                DataType::FixedSizeBinary(32),
                true,
            ),
        ],
        metadata,
    ));
    let arrays: Vec<ArrayRef> = vec![
        Arc::new(output_kind.finish()),
        Arc::new(UInt32Array::from(output_row_index)),
        Arc::new(relationship_kind.finish()),
        Arc::new(UInt32Array::from(source_data_row_first)),
        Arc::new(UInt32Array::from(source_data_row_last)),
        Arc::new(source_digest.finish()),
        Arc::new(terminal_logical_node.finish()),
        Arc::new(dependency_precision.finish()),
        Arc::new(search_protocol_version.finish()),
        Arc::new(search_index_space.finish()),
        Arc::new(search_reason.finish()),
        Arc::new(search_start_participant_id.finish()),
        Arc::new(UInt32Array::from(search_start_event_index)),
        Arc::new(UInt32Array::from(search_end_event_index_exclusive)),
        Arc::new(UInt32Array::from(search_candidate_event_count)),
        Arc::new(search_candidate_chain_digest.finish()),
    ];
    let batch = RecordBatch::try_new(schema.clone(), arrays)
        .map_err(|error| format!("build lineage Arrow record batch: {error}"))?;
    let mut output = Cursor::new(Vec::new());
    {
        let write_options = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|error| format!("configure row-lineage compression: {error}"))?;
        let mut writer = FileWriter::try_new_with_options(&mut output, &schema, write_options)
            .map_err(|error| format!("create lineage Arrow writer: {error}"))?;
        writer
            .write(&batch)
            .map_err(|error| format!("write lineage Arrow batch: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("finish lineage Arrow file: {error}"))?;
    }
    Ok(output.into_inner())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ColumnKind {
    String,
    Int32,
    Double,
    Boolean,
}

pub struct CsvTable {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

/// `binary_exports` is a private module, so `pub` here is crate-internal: it
/// only lets `append_binary_exports` parse a canonical CSV once and hand the
/// same table to both the Parquet and the SPSS writer.
pub fn parse_csv(bytes: &[u8]) -> Result<CsvTable, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|error| format!("read export CSV header: {error}"))?
        .iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let rows = reader
        .records()
        .map(|record| {
            record
                .map_err(|error| format!("read export CSV row: {error}"))
                .map(|record| record.iter().map(str::to_string).collect())
        })
        .collect::<Result<Vec<Vec<String>>, String>>()?;
    Ok(CsvTable { headers, rows })
}

const APP_DOUBLE_COLUMNS: &[&str] = &[
    "duration_seconds",
    "duration_minutes",
    "data_time_gap_hours",
    "valid_app_usage_time_gap_hours",
    "any_app_usage_time_gap_hours",
];
const APP_INT_COLUMNS: &[&str] = &[
    "day",
    "weekdayMF",
    "weekdayMTh",
    "weekdaySuTh",
    "hour",
    "quarter",
    "valid_app_new_engage_30s",
    "valid_app_switched_app",
    "any_app_new_engage_30s",
    "any_app_switched_app",
];
const SCREEN_DOUBLE_COLUMNS: &[&str] = &[
    "duration_seconds",
    "duration_minutes",
    "screen_usage_end_reason_confidence",
    "screen_usage_tail_gap_seconds",
    "data_time_gap_hours",
];
const SCREEN_INT_COLUMNS: &[&str] = &[
    "day",
    "weekdayMF",
    "weekdayMTh",
    "weekdaySuTh",
    "hour",
    "quarter",
];

fn column_kind(name: &str, screen: bool) -> ColumnKind {
    if screen {
        if SCREEN_DOUBLE_COLUMNS.contains(&name) {
            ColumnKind::Double
        } else if SCREEN_INT_COLUMNS.contains(&name) {
            ColumnKind::Int32
        } else if name == "screen_usage_lock_screen_only" {
            ColumnKind::Boolean
        } else {
            ColumnKind::String
        }
    } else if APP_DOUBLE_COLUMNS.contains(&name) {
        ColumnKind::Double
    } else if APP_INT_COLUMNS.contains(&name)
        || name.starts_with("valid_app_new_engage_custom_")
        || name.starts_with("any_app_new_engage_custom_")
    {
        ColumnKind::Int32
    } else {
        ColumnKind::String
    }
}

fn optional(row: &[String], index: usize) -> Option<&str> {
    row.get(index)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
}

fn parse_i32(value: Option<&str>, column: &str) -> Result<Option<i32>, String> {
    value
        .map(|value| {
            value
                .parse::<i32>()
                .map_err(|error| format!("invalid INT32 value for {column}: {error}"))
        })
        .transpose()
}

fn parse_f64(value: Option<&str>, column: &str) -> Result<Option<f64>, String> {
    value
        .map(|value| {
            value
                .parse::<f64>()
                .map_err(|error| format!("invalid DOUBLE value for {column}: {error}"))
        })
        .transpose()
}

fn parse_bool(value: Option<&str>, column: &str) -> Result<Option<bool>, String> {
    value
        .map(|value| match value {
            "true" | "1" => Ok(true),
            "false" | "0" => Ok(false),
            _ => Err(format!("invalid BOOLEAN value for {column}")),
        })
        .transpose()
}

/// Parse a canonical CSV and encode it as Parquet in one call. The product no
/// longer uses this — `append_binary_exports` parses each CSV family once and
/// feeds `parquet_from_table` and `sav_from_table` from the same table — so it
/// is test-only, and it is kept because the byte-identity test needs an
/// independently reparsed reference to compare the shared table against.
#[cfg(test)]
pub fn parquet_from_csv(csv_bytes: &[u8], screen: bool) -> Result<Vec<u8>, String> {
    parquet_from_table(&parse_csv(csv_bytes)?, screen)
}

pub fn parquet_from_table(table: &CsvTable, screen: bool) -> Result<Vec<u8>, String> {
    let fields = table
        .headers
        .iter()
        .map(|name| {
            let kind = column_kind(name, screen);
            let mut builder = ParquetType::primitive_type_builder(
                name,
                match kind {
                    ColumnKind::String => PhysicalType::BYTE_ARRAY,
                    ColumnKind::Int32 => PhysicalType::INT32,
                    ColumnKind::Double => PhysicalType::DOUBLE,
                    ColumnKind::Boolean => PhysicalType::BOOLEAN,
                },
            )
            .with_repetition(Repetition::OPTIONAL);
            if kind == ColumnKind::String {
                builder = builder.with_converted_type(ConvertedType::UTF8);
            }
            builder
                .build()
                .map(Arc::new)
                .map_err(|error| format!("build Parquet field {name}: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let schema = Arc::new(
        ParquetType::group_type_builder("chronicle_preprocessing")
            .with_fields(fields)
            .build()
            .map_err(|error| format!("build Parquet schema: {error}"))?,
    );
    let properties = WriterProperties::builder()
        .set_created_by("chronicle-preprocessing-runtime/0.1.0".into())
        .build();
    let mut output = Vec::new();
    {
        let mut writer = SerializedFileWriter::new(&mut output, schema, Arc::new(properties))
            .map_err(|error| format!("create Parquet writer: {error}"))?;
        let mut row_group = writer
            .next_row_group()
            .map_err(|error| format!("create Parquet row group: {error}"))?;
        for (index, name) in table.headers.iter().enumerate() {
            let kind = column_kind(name, screen);
            let mut column = row_group
                .next_column()
                .map_err(|error| format!("create Parquet column {name}: {error}"))?
                .ok_or_else(|| format!("missing Parquet writer for column {name}"))?;
            match kind {
                ColumnKind::String => {
                    let values = table
                        .rows
                        .iter()
                        .map(|row| ByteArray::from(row.get(index).map_or("", String::as_str)))
                        .collect::<Vec<_>>();
                    let definition_levels = vec![1_i16; table.rows.len()];
                    column
                        .typed::<ByteArrayType>()
                        .write_batch(&values, Some(&definition_levels), None)
                        .map_err(|error| format!("write Parquet string column {name}: {error}"))?;
                }
                ColumnKind::Int32 => {
                    let parsed = table
                        .rows
                        .iter()
                        .map(|row| parse_i32(optional(row, index), name))
                        .collect::<Result<Vec<_>, _>>()?;
                    let definition_levels = parsed
                        .iter()
                        .map(|value| i16::from(value.is_some()))
                        .collect::<Vec<_>>();
                    let values = parsed.into_iter().flatten().collect::<Vec<_>>();
                    column
                        .typed::<ParquetInt32Type>()
                        .write_batch(&values, Some(&definition_levels), None)
                        .map_err(|error| format!("write Parquet INT32 column {name}: {error}"))?;
                }
                ColumnKind::Double => {
                    let parsed = table
                        .rows
                        .iter()
                        .map(|row| parse_f64(optional(row, index), name))
                        .collect::<Result<Vec<_>, _>>()?;
                    let definition_levels = parsed
                        .iter()
                        .map(|value| i16::from(value.is_some()))
                        .collect::<Vec<_>>();
                    let values = parsed.into_iter().flatten().collect::<Vec<_>>();
                    column
                        .typed::<DoubleType>()
                        .write_batch(&values, Some(&definition_levels), None)
                        .map_err(|error| format!("write Parquet DOUBLE column {name}: {error}"))?;
                }
                ColumnKind::Boolean => {
                    let parsed = table
                        .rows
                        .iter()
                        .map(|row| parse_bool(optional(row, index), name))
                        .collect::<Result<Vec<_>, _>>()?;
                    let definition_levels = parsed
                        .iter()
                        .map(|value| i16::from(value.is_some()))
                        .collect::<Vec<_>>();
                    let values = parsed.into_iter().flatten().collect::<Vec<_>>();
                    column
                        .typed::<BoolType>()
                        .write_batch(&values, Some(&definition_levels), None)
                        .map_err(|error| format!("write Parquet BOOLEAN column {name}: {error}"))?;
                }
            }
            column
                .close()
                .map_err(|error| format!("close Parquet column {name}: {error}"))?;
        }
        if row_group
            .next_column()
            .map_err(|error| format!("finish Parquet columns: {error}"))?
            .is_some()
        {
            return Err("Parquet writer exposed more columns than the Chronicle schema".into());
        }
        row_group
            .close()
            .map_err(|error| format!("close Parquet row group: {error}"))?;
        writer
            .close()
            .map_err(|error| format!("close Parquet writer: {error}"))?;
    }
    Ok(output)
}

struct ByteSink {
    bytes: Vec<u8>,
}

impl ByteSink {
    fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn f64(&mut self, value: f64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn raw(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    fn fixed_utf8(&mut self, value: &str, width: usize, padding: u8) {
        let mut bytes = vec![padding; width];
        let encoded = value.as_bytes();
        bytes[..encoded.len().min(width)].copy_from_slice(&encoded[..encoded.len().min(width)]);
        self.raw(&bytes);
    }
}

struct SavVariable {
    name: String,
    kind: ColumnKind,
    string_width: usize,
    decimals: u8,
}

fn sav_variables(table: &CsvTable, screen: bool) -> Vec<SavVariable> {
    table
        .headers
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let kind = column_kind(name, screen);
            let string_width = if kind == ColumnKind::String {
                table
                    .rows
                    .iter()
                    .map(|row| row.get(index).map_or(0, |value| value.len()))
                    .max()
                    .unwrap_or(0)
                    .clamp(1, 255)
            } else {
                0
            };
            SavVariable {
                name: name.clone(),
                kind,
                string_width,
                decimals: if kind == ColumnKind::Double { 2 } else { 0 },
            }
        })
        .collect()
}

fn slot_count(variable: &SavVariable) -> usize {
    if variable.kind == ColumnKind::String {
        variable.string_width.div_ceil(8).max(1)
    } else {
        1
    }
}

fn pack_format(format_type: i32, width: usize, decimals: u8) -> i32 {
    let format_type = u8::try_from(format_type).expect("SAV format type fits one byte");
    let width = u8::try_from(width).expect("SAV display width fits one byte");
    i32::from_be_bytes([0, format_type, width, decimals])
}

fn write_label(sink: &mut ByteSink, label: &str) {
    let bytes = label.as_bytes();
    sink.i32(bytes.len() as i32);
    let padded = bytes.len().div_ceil(4) * 4;
    let mut value = vec![b' '; padded];
    value[..bytes.len()].copy_from_slice(bytes);
    sink.raw(&value);
}

fn truncated_utf8_len(bytes: &[u8], max_len: usize) -> usize {
    if bytes.len() <= max_len {
        return bytes.len();
    }
    std::str::from_utf8(&bytes[..max_len]).map_or_else(|error| error.valid_up_to(), str::len)
}

struct SavCommands {
    commands: Vec<u8>,
    literals: Vec<Vec<u8>>,
}

impl SavCommands {
    fn new() -> Self {
        Self {
            commands: Vec::with_capacity(8),
            literals: Vec::new(),
        }
    }

    fn emit(&mut self, sink: &mut ByteSink, code: u8, literal: Option<Vec<u8>>) {
        self.commands.push(code);
        if let Some(literal) = literal {
            self.literals.push(literal);
        }
        if self.commands.len() == 8 {
            self.flush(sink);
        }
    }

    fn flush(&mut self, sink: &mut ByteSink) {
        if self.commands.is_empty() {
            return;
        }
        self.commands.resize(8, 0);
        sink.raw(&self.commands);
        for literal in &self.literals {
            sink.raw(literal);
        }
        self.commands.clear();
        self.literals.clear();
    }
}

/// Test-only for the same reason as `parquet_from_csv`: it is the independently
/// reparsed reference the byte-identity test compares the shared table against.
#[cfg(test)]
pub fn sav_from_csv(csv_bytes: &[u8], screen: bool) -> Result<Vec<u8>, String> {
    sav_from_table(&parse_csv(csv_bytes)?, screen)
}

pub fn sav_from_table(table: &CsvTable, screen: bool) -> Result<Vec<u8>, String> {
    let variables = sav_variables(table, screen);
    let mut sink = ByteSink::new();
    sink.fixed_utf8("$FL2", 4, b' ');
    sink.fixed_utf8(
        "@(#) SPSS DATA FILE - Chronicle local preprocessor",
        60,
        b' ',
    );
    sink.i32(2);
    sink.i32(variables.iter().map(slot_count).sum::<usize>() as i32);
    sink.i32(1);
    sink.i32(0);
    sink.i32(table.rows.len() as i32);
    sink.f64(100.0);
    sink.fixed_utf8("01 Jan 25", 9, b' ');
    sink.fixed_utf8("00:00:00", 8, b' ');
    sink.fixed_utf8("Chronicle preprocessed output", 64, b' ');
    sink.raw(&[0; 3]);

    for (index, variable) in variables.iter().enumerate() {
        let short_name = format!("V{}", index + 1);
        if variable.kind == ColumnKind::String {
            let format = pack_format(1, variable.string_width, 0);
            sink.i32(2);
            sink.i32(variable.string_width as i32);
            sink.i32(1);
            sink.i32(0);
            sink.i32(format);
            sink.i32(format);
            sink.fixed_utf8(&short_name, 8, b' ');
            write_label(&mut sink, &variable.name);
            for _ in 1..slot_count(variable) {
                sink.i32(2);
                sink.i32(-1);
                sink.i32(0);
                sink.i32(0);
                sink.i32(0);
                sink.i32(0);
                sink.fixed_utf8("", 8, b' ');
            }
        } else {
            let numeric_width = usize::max(8, usize::from(variable.decimals) + 11);
            let format = pack_format(5, numeric_width, variable.decimals);
            sink.i32(2);
            sink.i32(0);
            sink.i32(1);
            sink.i32(0);
            sink.i32(format);
            sink.i32(format);
            sink.fixed_utf8(&short_name, 8, b' ');
            write_label(&mut sink, &variable.name);
        }
    }

    sink.i32(7);
    sink.i32(3);
    sink.i32(4);
    sink.i32(8);
    for value in [1, 0, 0, -1, 1, 1, 2, 65001] {
        sink.i32(value);
    }
    sink.i32(7);
    sink.i32(4);
    sink.i32(8);
    sink.i32(3);
    sink.f64(-f64::MAX);
    sink.f64(f64::MAX);
    sink.f64(-1.797_693_134_862_315_5e308);

    let long_names = variables
        .iter()
        .enumerate()
        .map(|(index, variable)| format!("V{}={}", index + 1, variable.name))
        .collect::<Vec<_>>()
        .join("\t");
    sink.i32(7);
    sink.i32(13);
    sink.i32(1);
    sink.i32(long_names.len() as i32);
    sink.raw(long_names.as_bytes());
    sink.i32(7);
    sink.i32(20);
    sink.i32(1);
    sink.i32(5);
    sink.raw(b"UTF-8");
    sink.i32(999);
    sink.i32(0);

    let mut commands = SavCommands::new();
    for row in &table.rows {
        for (index, variable) in variables.iter().enumerate() {
            let value = row.get(index).map(String::as_str).unwrap_or("");
            if variable.kind == ColumnKind::String {
                let slot_width = slot_count(variable) * 8;
                let mut padded = vec![b' '; slot_width];
                let bytes = value.as_bytes();
                let keep = truncated_utf8_len(bytes, variable.string_width);
                padded[..keep].copy_from_slice(&bytes[..keep]);
                for segment in padded.chunks_exact(8) {
                    if segment.iter().all(|byte| *byte == b' ') {
                        commands.emit(&mut sink, 254, None);
                    } else {
                        commands.emit(&mut sink, 253, Some(segment.to_vec()));
                    }
                }
            } else if value.is_empty() {
                commands.emit(&mut sink, 255, None);
            } else {
                let numeric = match variable.kind {
                    ColumnKind::Boolean => match value {
                        "true" | "1" => 1.0,
                        "false" | "0" => 0.0,
                        _ => {
                            return Err(format!(
                                "invalid SAV boolean for {}: {value}",
                                variable.name
                            ))
                        }
                    },
                    _ => value.parse::<f64>().map_err(|error| {
                        format!(
                            "invalid SAV numeric for {}: {value}: {error}",
                            variable.name
                        )
                    })?,
                };
                let biased = numeric + 100.0;
                if numeric.fract() == 0.0 && (1.0..=251.0).contains(&biased) {
                    commands.emit(&mut sink, biased as u8, None);
                } else {
                    commands.emit(&mut sink, 253, Some(numeric.to_le_bytes().to_vec()));
                }
            }
        }
    }
    commands.flush(&mut sink);
    Ok(sink.bytes)
}

/// `#[ignore]`d measurement harness for the recorded Parquet/SPSS reparse debt.
/// It lives here so it can time the private `parse_csv` against the public
/// export paths without widening their visibility.
#[cfg(test)]
mod perf_measurement;

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::{Array, DictionaryArray, FixedSizeBinaryArray};
    use arrow_ipc::reader::FileReader;
    use bytes::Bytes;
    use parquet::{
        file::reader::{FileReader as ParquetFileReader, SerializedFileReader},
        record::{Field as ParquetField, RowAccessor},
    };
    use std::collections::BTreeSet;

    #[test]
    fn cloned_sha256_prefixes_are_byte_exact_with_the_full_reference_messages() {
        assert_eq!(
            sha256_array(b"exact-value"),
            <[u8; 32]>::from(Sha256::digest(b"exact-value"))
        );
        assert_ne!(sha256_array(b"exact-value"), [0; 32]);
        assert_ne!(sha256_array(b"exact-value"), [1; 32]);
        assert_eq!(json_pointer_escape("a/b~c"), "a~1b~0c");
        let canonical_value = serde_json::json!({"unicode":"é", "nested":[1, true, null]});
        assert_eq!(
            canonical_json_value_digest(&canonical_value).unwrap(),
            sha256_array(&serde_jcs::to_vec(&canonical_value).unwrap()),
        );
        let source = CanonicalSource {
            role_id: "raw_chronicle_csv",
            source_artifact_digest:
                "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            source_media_type: "text/csv",
            coordinate_media_type: "text/csv",
            normalization: "identity-csv",
            bytes: b"column\nvalue\n",
        };
        let prefix = source_coordinate_prefix(&source);
        for (address_kind, record_index, selector, value) in [
            ("csv-cell", Some(1), "event_timestamp", b"123".as_slice()),
            ("csv-cell", Some(u32::MAX), "timezone", b"UTC".as_slice()),
            ("csv-shape", None, "/shape/columns", b"[]".as_slice()),
        ] {
            let value_digest = sha256_array(value);
            let mut reference = Sha256::new();
            for field in [
                SOURCE_COORDINATE_PROTOCOL.as_bytes(),
                source.role_id.as_bytes(),
                source.source_artifact_digest.as_bytes(),
                source.source_media_type.as_bytes(),
                source.coordinate_media_type.as_bytes(),
                source.normalization.as_bytes(),
                address_kind.as_bytes(),
                selector.as_bytes(),
            ] {
                reference.update((field.len() as u64).to_le_bytes());
                reference.update(field);
            }
            match record_index {
                Some(index) => {
                    reference.update([1]);
                    reference.update(index.to_le_bytes());
                }
                None => reference.update([0]),
            }
            reference.update(value_digest);
            assert_eq!(
                source_coordinate_id(&prefix, address_kind, record_index, selector, &value_digest,),
                <[u8; 32]>::from(reference.finalize()),
            );
        }

        for (kind, selector, node) in [
            ("app-csv", "duration_minutes", "outputs"),
            (
                "visualization-data-json",
                "/appRows/999/broadAppCategory",
                "outputs",
            ),
        ] {
            let mut reference = Sha256::new();
            for field in [RESULT_CELL_CORRESPONDENCE_PROTOCOL, kind, selector, node] {
                reference.update((field.len() as u64).to_le_bytes());
                reference.update(field.as_bytes());
            }
            assert_eq!(
                dependency_spec_digest_from_prefix(&dependency_spec_prefix(kind), selector, node,),
                <[u8; 32]>::from(reference.finalize()),
            );
            assert_eq!(
                dependency_spec_digest(kind, selector, node),
                dependency_spec_digest_from_prefix(&dependency_spec_prefix(kind), selector, node,)
            );
            assert_ne!(dependency_spec_digest(kind, selector, node), [0; 32]);
            assert_ne!(dependency_spec_digest(kind, selector, node), [1; 32]);
        }
    }

    #[test]
    fn bounded_value_digest_cache_is_exact_and_disables_on_high_cardinality() {
        let mut cache = BoundedValueDigestCache::default();
        for index in 0..=VALUE_DIGEST_CACHE_MAX_ENTRIES {
            let value = format!("value-{index}");
            assert_eq!(
                cache.digest(value.as_bytes()),
                sha256_array(value.as_bytes())
            );
        }
        assert!(cache.values.is_none());
        assert_eq!(cache.digest(b"value-1"), sha256_array(b"value-1"));

        let mut repeated = BoundedValueDigestCache::default();
        for _ in 0..10_000 {
            assert_eq!(repeated.digest(b"UTC"), sha256_array(b"UTC"));
        }
        assert_eq!(repeated.values.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn streaming_dictionary_and_empty_batch_boundaries_are_explicit() {
        let seeded = StringArray::from(vec!["alpha", "beta"]);
        let mut builder = RunCachedStringDictionaryBuilder::with_dictionary(&seeded, 4).unwrap();
        for value in ["alpha", "alpha", "beta", "gamma", "alpha"] {
            builder.append(value).unwrap();
        }
        builder.append_null();
        let dictionary = builder.finish().unwrap();
        assert_eq!(dictionary.len(), 6);
        assert_eq!(dictionary.values().len(), 3);
        assert!(dictionary.is_null(5));

        let nullable_seed = StringArray::from(vec![Some("valid"), None]);
        let nullable_error = RunCachedStringDictionaryBuilder::with_dictionary(&nullable_seed, 2)
            .err()
            .unwrap_or_default();
        assert!(nullable_error.contains("must not contain null"));

        let malformed = RecordBatch::try_from_iter(vec![(
            "plain-string",
            Arc::new(StringArray::from(vec!["not-a-dictionary"])) as ArrayRef,
        )])
        .unwrap();
        let source_error = SourceCoordinateDictionaries::from_batch(&malformed)
            .err()
            .unwrap_or_default();
        assert!(source_error.contains("source-coordinate column 0"));
        let result_error = ResultCellDictionaries::from_batch(&malformed)
            .err()
            .unwrap_or_default();
        assert!(result_error.contains("result-cell column 0"));

        let mut valid_dictionary = RunCachedStringDictionaryBuilder::new();
        valid_dictionary.append("dictionary-value").unwrap();
        let malformed_second = RecordBatch::try_from_iter(vec![
            (
                "dictionary",
                Arc::new(valid_dictionary.finish().unwrap()) as ArrayRef,
            ),
            (
                "plain-string",
                Arc::new(StringArray::from(vec!["not-a-dictionary"])) as ArrayRef,
            ),
        ])
        .unwrap();
        let source_second_error = SourceCoordinateDictionaries::from_batch(&malformed_second)
            .err()
            .unwrap_or_default();
        assert!(source_second_error.contains("source-coordinate column 1"));
        let result_second_error = ResultCellDictionaries::from_batch(&malformed_second)
            .err()
            .unwrap_or_default();
        assert!(result_second_error.contains("result-cell column 1"));

        let mut source_writer = SourceCoordinateBatchWriter::new().unwrap();
        source_writer.flush().unwrap();
        let (source_bytes, source_rows) = source_writer.finish().unwrap();
        assert_eq!(source_rows, 0);
        assert!(!source_bytes.is_empty());

        let mut result_writer = ResultCellBatchWriter::new().unwrap();
        result_writer.flush().unwrap();
        let (result_bytes, result_rows) = result_writer.finish().unwrap();
        assert_eq!(result_rows, 0);
        assert!(!result_bytes.is_empty());
    }

    #[test]
    fn parquet_and_sav_exports_are_nonempty_and_deterministic() {
        let csv = b"participant_id,duration_minutes,day,screen_usage_lock_screen_only\nP01,1.5,2,true\nP02,,3,\n";
        let parquet = parquet_from_csv(csv, true).unwrap();
        assert!(parquet.starts_with(b"PAR1"));
        assert!(parquet.ends_with(b"PAR1"));
        assert_eq!(parquet, parquet_from_csv(csv, true).unwrap());
        let reader = SerializedFileReader::new(Bytes::from(parquet)).unwrap();
        assert_eq!(reader.metadata().file_metadata().num_rows(), 2);
        let columns = reader
            .metadata()
            .file_metadata()
            .schema_descr()
            .columns()
            .iter()
            .map(|column| column.name().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            columns,
            [
                "participant_id",
                "duration_minutes",
                "day",
                "screen_usage_lock_screen_only"
            ]
        );
        let mut rows = reader.get_row_iter(None).unwrap();
        let first_row = rows.next().unwrap().unwrap();
        assert_eq!(first_row.get_string(0).unwrap(), "P01");
        assert_eq!(first_row.get_double(1).unwrap(), 1.5);
        assert_eq!(first_row.get_int(2).unwrap(), 2);
        assert!(first_row.get_bool(3).unwrap());
        let second_row = rows.next().unwrap().unwrap();
        assert_eq!(second_row.get_string(0).unwrap(), "P02");
        assert!(matches!(
            second_row.get_column_iter().nth(1).unwrap().1,
            ParquetField::Null
        ));
        assert_eq!(second_row.get_int(2).unwrap(), 3);
        assert!(matches!(
            second_row.get_column_iter().nth(3).unwrap().1,
            ParquetField::Null
        ));
        assert!(rows.next().is_none());
        let first = sav_from_csv(csv, true).unwrap();
        let second = sav_from_csv(csv, true).unwrap();
        assert!(first.starts_with(b"$FL2"));
        assert_eq!(first, second);
        assert_eq!(
            crate::sha256(&first),
            "sha256:cb92b99d81a40778e6e2705209a485f9494d93efc5c07edbcc6992989d6615db"
        );
    }

    #[test]
    fn lineage_is_a_normalized_deterministic_arrow_range_table() {
        let lineages = vec![PipelineRowLineage {
            output_kind: Arc::new("app-csv".to_string()),
            output_row_index: 0,
            source_data_row_ranges: vec![
                chronicle_chrono_kernel_wasm::pipeline_v2::SourceDataRowRange { first: 1, last: 1 },
                chronicle_chrono_kernel_wasm::pipeline_v2::SourceDataRowRange { first: 3, last: 4 },
            ],
            source_data_row_count: 3,
            searches: vec![
                chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchEvidence {
                    protocol_version: Arc::new("chronicle-lineage-search/v1".to_string()),
                    reason: Arc::new("no-qualifying-stop".to_string()),
                    index_space: Arc::new("pipeline-event-order".to_string()),
                    start_participant_id: Arc::new("P01".to_string()),
                    start_event_index: 2,
                    end_event_index_exclusive: 5,
                    candidate_event_count: 2,
                    candidate_chain_digest:
                        chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchDigest::parse(
                            &format!("blake3:{}", "b".repeat(64)),
                        )
                        .unwrap(),
                },
            ],
            terminal_logical_node: Arc::new("outputs".to_string()),
        }];
        let digest = format!("sha256:{}", "a".repeat(64));
        let first = row_lineage_arrow(&lineages, &digest).unwrap();
        let second = row_lineage_arrow(&lineages, &digest).unwrap();
        assert_eq!(first, second);
        let mut reader = FileReader::try_new(Cursor::new(first), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        assert_eq!(batch.num_rows(), 3);
        assert_eq!(
            batch.schema().metadata()["protocolVersion"],
            ROW_LINEAGE_PROTOCOL
        );
        assert_eq!(batch.schema().field(2).name(), "relationship_kind");
        assert_eq!(batch.schema().field(3).name(), "source_data_row_first");
        assert_eq!(batch.schema().field(4).name(), "source_data_row_last");
        let source_first = batch
            .column(3)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let source_last = batch
            .column(4)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        assert_eq!((source_first.value(0), source_last.value(0)), (1, 1));
        assert_eq!((source_first.value(1), source_last.value(1)), (3, 4));
        assert!(source_first.is_null(2));
        assert!(source_last.is_null(2));
        let search_start = batch
            .column(12)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let search_end = batch
            .column(13)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let search_count = batch
            .column(14)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        assert!(search_start.is_null(0));
        assert_eq!(search_start.value(2), 2);
        assert_eq!(search_end.value(2), 5);
        assert_eq!(search_count.value(2), 2);
        let search_digest = batch
            .column(15)
            .as_any()
            .downcast_ref::<FixedSizeBinaryArray>()
            .unwrap();
        assert!(search_digest.is_null(0));
        assert_eq!(search_digest.value(2), &[0xbb; 32]);
        assert!(reader.next().is_none());
    }

    #[test]
    fn source_coordinates_are_exact_stable_endpoints_without_claiming_contribution() {
        let raw_digest = format!("sha256:{}", "a".repeat(64));
        let options_digest = format!("sha256:{}", "b".repeat(64));
        let raw =
            b"participant_id,event_timestamp\nP01,2026-01-01 00:00:00\nP02,2026-01-01 00:01:00\n";
        let options = br#"{"mode":"selected","values":[{"a/b~c":1},2]}"#;
        let sources = [
            CanonicalSource {
                role_id: "raw_chronicle_csv",
                source_artifact_digest: &raw_digest,
                source_media_type: "text/csv",
                coordinate_media_type: "text/csv",
                normalization: "identity-csv",
                bytes: raw,
            },
            CanonicalSource {
                role_id: "processing_options",
                source_artifact_digest: &options_digest,
                source_media_type: "application/json",
                coordinate_media_type: "application/json",
                normalization: "canonical-json",
                bytes: options,
            },
        ];
        let (first, row_count) = source_coordinate_index_arrow(&sources).unwrap();
        let (second, second_count) = source_coordinate_index_arrow(&sources).unwrap();
        assert_eq!(first, second);
        assert_eq!((row_count, second_count), (9, 9));

        let mut reader = FileReader::try_new(Cursor::new(first.clone()), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        assert_eq!(batch.num_rows(), 9);
        assert_eq!(
            batch.schema().metadata()["protocolVersion"],
            SOURCE_COORDINATE_PROTOCOL
        );
        assert!(batch.schema().metadata()["claimBoundary"]
            .contains("output contribution is not implied"));
        assert!(batch.schema().metadata()["coordinateIdentityDerivation"].starts_with("sha256("));
        assert_eq!(batch.num_columns(), 9);
        assert_eq!(batch.schema().field(6).name(), "source_record_index");
        assert_eq!(batch.schema().field(8).name(), "value_sha256");
        let record_indexes = batch
            .column(6)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let observed_record_indexes = (0..record_indexes.len())
            .filter(|index| record_indexes.is_valid(*index))
            .map(|index| record_indexes.value(index))
            .collect::<BTreeSet<_>>();
        assert_eq!(observed_record_indexes, BTreeSet::from([1, 2]));
        let selectors = batch
            .column(7)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let selector_values = selectors
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let observed_selectors = (0..selectors.len())
            .map(|index| selector_values.value(selectors.keys().value(index) as usize))
            .collect::<BTreeSet<_>>();
        assert!(observed_selectors.contains("/values/0/a~1b~0c"));
        assert!(observed_selectors.contains("/values/1"));
        assert!(reader.next().is_none());

        let changed_raw =
            b"participant_id,event_timestamp\nP01,2026-01-01 00:00:00\nP02,2026-01-01 00:02:00\n";
        let changed_digest = format!("sha256:{}", "c".repeat(64));
        let changed_sources = [CanonicalSource {
            role_id: "raw_chronicle_csv",
            source_artifact_digest: &changed_digest,
            source_media_type: "text/csv",
            coordinate_media_type: "text/csv",
            normalization: "identity-csv",
            bytes: changed_raw,
        }];
        let (changed, _) = source_coordinate_index_arrow(&changed_sources).unwrap();
        assert_ne!(first, changed);

        assert!(source_coordinate_index_arrow(&[CanonicalSource {
            role_id: "processing_options",
            source_artifact_digest: &options_digest,
            source_media_type: "application/json",
            coordinate_media_type: "application/json",
            normalization: "canonical-json",
            bytes: b"{",
        }])
        .unwrap_err()
        .contains("parse processing_options source JSON coordinates"));
    }

    #[test]
    fn influence_hashes_and_graph_closure_are_exact_and_nonconstant() {
        assert_eq!(
            hex::encode(sha256_array(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(sha256_array(b"abc"), sha256_array(b"abd"));

        let first_spec = dependency_spec_digest("app-csv", "duration", "outputs");
        let second_spec = dependency_spec_digest("app-csv", "participant", "outputs");
        assert_ne!(first_spec, [0; 32]);
        assert_ne!(first_spec, [1; 32]);
        assert_ne!(first_spec, second_spec);

        let plan = crate::embedded_plan();
        let closure =
            downstream_closure(&plan, BTreeSet::from(["normalize_timezones".to_string()]));
        assert_eq!(closure.len(), 14);
        assert!(closure.contains("normalize_timezones"));
        assert!(closure.contains("outputs"));
        assert!(!closure.contains("parse_events"));

        let options_digest = format!("sha256:{}", "b".repeat(64));
        let options = br#"{"timezone_handling":"selected-filter"}"#;
        let scopes = source_scopes(
            &[CanonicalSource {
                role_id: "processing_options",
                source_artifact_digest: &options_digest,
                source_media_type: "application/json",
                coordinate_media_type: "application/json",
                normalization: "canonical-json",
                bytes: options,
            }],
            &plan,
        )
        .unwrap();
        assert_eq!(scopes.len(), 1);
        assert_eq!(
            scopes[0].selector_prefix.as_deref(),
            Some("/timezone_handling")
        );
        assert_eq!(scopes[0].reached_nodes, closure);

        let renamed_options =
            br#"{"timezone":"America/Chicago","usage_session_mode":"app_and_screen_usage"}"#;
        let renamed_scopes = source_scopes(
            &[CanonicalSource {
                role_id: "processing_options",
                source_artifact_digest: &options_digest,
                source_media_type: "application/json",
                coordinate_media_type: "application/json",
                normalization: "canonical-json",
                bytes: renamed_options,
            }],
            &plan,
        )
        .unwrap();
        assert_eq!(renamed_scopes.len(), 2);
        let timezone_scope = renamed_scopes
            .iter()
            .find(|scope| scope.selector_prefix.as_deref() == Some("/timezone"))
            .unwrap();
        assert!(timezone_scope.reached_nodes.contains("parse_events"));
        assert!(timezone_scope.reached_nodes.contains("normalize_timezones"));
        assert!(timezone_scope.reached_nodes.contains("outputs"));
        let mode_scope = renamed_scopes
            .iter()
            .find(|scope| scope.selector_prefix.as_deref() == Some("/usage_session_mode"))
            .unwrap();
        assert!(mode_scope.reached_nodes.contains("device_state_timeline"));
        assert!(mode_scope.reached_nodes.contains("reconstruct_episodes"));

        let context = InfluenceContext {
            implementation_digest: "implementation-a",
            plan_digest: "plan-a",
            profile_lock_digest: "lock-a",
            dependency_certificate_digest: "certificate-a",
        };
        let first_evidence =
            influence_evidence_digest(&context, "source-a", "result", "target-a", "may", b"x");
        let second_evidence =
            influence_evidence_digest(&context, "source-a", "result", "target-b", "may", b"x");
        assert_ne!(first_evidence, [0; 32]);
        assert_ne!(first_evidence, [1; 32]);
        assert_ne!(first_evidence, second_evidence);
    }

    #[test]
    fn source_coordinate_streaming_writes_and_reads_every_deterministic_batch() {
        let data_rows = SOURCE_COORDINATE_BATCH_ROWS + 5;
        let mut csv = String::with_capacity(data_rows * 8);
        csv.push_str("value\n");
        for index in 0..data_rows {
            csv.push_str(&index.to_string());
            csv.push('\n');
        }
        let digest = format!("sha256:{}", "a".repeat(64));
        let sources = [CanonicalSource {
            role_id: "raw_chronicle_csv",
            source_artifact_digest: &digest,
            source_media_type: "text/csv",
            coordinate_media_type: "text/csv",
            normalization: "identity-csv",
            bytes: csv.as_bytes(),
        }];

        let (first, row_count) = source_coordinate_index_arrow(&sources).unwrap();
        let (second, second_count) = source_coordinate_index_arrow(&sources).unwrap();
        assert_eq!(first, second);
        assert_eq!(row_count, second_count);
        assert_eq!(row_count as usize, data_rows + 2);

        let reader = FileReader::try_new(Cursor::new(first), None).unwrap();
        let batches = reader.collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(
            batches.iter().map(RecordBatch::num_rows).sum::<usize>(),
            data_rows + 2
        );
        assert_eq!(
            batches[0].schema().metadata()["recordBatchRows"],
            SOURCE_COORDINATE_BATCH_ROWS.to_string()
        );
    }

    #[test]
    fn empty_json_and_invalid_binary_export_branches_are_explicit() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let empty_object = [CanonicalSource {
            role_id: "processing_options",
            source_artifact_digest: &digest,
            source_media_type: "application/json",
            coordinate_media_type: "application/json",
            normalization: "canonical-json",
            bytes: b"{}",
        }];
        let (_, source_rows) = source_coordinate_index_arrow(&empty_object).unwrap();
        assert_eq!(source_rows, 1);
        assert!(source_coordinate_index_arrow(&[CanonicalSource {
            role_id: "unsupported",
            source_artifact_digest: &digest,
            source_media_type: "application/octet-stream",
            coordinate_media_type: "application/octet-stream",
            normalization: "identity",
            bytes: b"x",
        }])
        .unwrap_err()
        .contains("unsupported source coordinate media type"));

        let empty_json_outputs = [
            CanonicalOutput {
                kind: "empty-array-json",
                media_type: "application/json",
                bytes: b"[]",
                terminal_logical_node: "outputs",
            },
            CanonicalOutput {
                kind: "empty-object-json",
                media_type: "application/json",
                bytes: b"{}",
                terminal_logical_node: "outputs",
            },
        ];
        let (_, result_rows) = result_cell_correspondence_arrow(&empty_json_outputs, &[]).unwrap();
        assert_eq!(result_rows, 2);
        assert!(result_cell_correspondence_arrow(
            &[CanonicalOutput {
                kind: "unsupported",
                media_type: "application/octet-stream",
                bytes: b"x",
                terminal_logical_node: "outputs",
            }],
            &[],
        )
        .unwrap_err()
        .contains("unsupported canonical cell media type"));

        assert!(
            chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchDigest::parse(&format!(
                "blake3:{}",
                "z".repeat(64)
            ))
            .unwrap_err()
            .contains("decode lineage search digest")
        );
    }

    #[test]
    fn result_cells_are_exact_addressed_deterministic_and_joinable() {
        let app_csv = b"study_name,duration_seconds\nStudy,1.5\n";
        let review_json = br#"{"participants":[{"a/b~c":"P01"}],"count":1}"#;
        let outputs = [
            CanonicalOutput {
                kind: "app-csv",
                media_type: "text/csv",
                bytes: app_csv,
                terminal_logical_node: "outputs",
            },
            CanonicalOutput {
                kind: "review-summary-json",
                media_type: "application/json",
                bytes: review_json,
                terminal_logical_node: "outputs",
            },
        ];
        let lineages = [PipelineRowLineage {
            output_kind: Arc::new("app-csv".to_string()),
            output_row_index: 0,
            source_data_row_ranges: vec![
                chronicle_chrono_kernel_wasm::pipeline_v2::SourceDataRowRange { first: 1, last: 1 },
                chronicle_chrono_kernel_wasm::pipeline_v2::SourceDataRowRange { first: 3, last: 3 },
            ],
            source_data_row_count: 2,
            searches: Vec::new(),
            terminal_logical_node: Arc::new("outputs".to_string()),
        }];

        let (first, row_count) = result_cell_correspondence_arrow(&outputs, &lineages).unwrap();
        let (second, second_count) = result_cell_correspondence_arrow(&outputs, &lineages).unwrap();
        assert_eq!(first, second);
        assert_eq!((row_count, second_count), (6, 6));

        let mut reader = FileReader::try_new(Cursor::new(first), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        assert_eq!(batch.num_rows(), 6);
        assert_eq!(
            batch.schema().metadata()["protocolVersion"],
            RESULT_CELL_CORRESPONDENCE_PROTOCOL
        );
        assert_eq!(batch.schema().field(3).name(), "selector");
        assert_eq!(batch.schema().field(3).data_type(), &dictionary_type());
        assert_eq!(batch.schema().field(4).name(), "cell_value_sha256");
        assert_eq!(batch.schema().field(7).name(), "row_lineage_row_index");
        assert_eq!(batch.num_columns(), 8);
        assert!(batch.schema().metadata()["dependencyIdentityDerivation"].starts_with("sha256("));
        assert_eq!(
            batch.schema().metadata()["semanticDependencyPrecision"],
            "declared-transitive"
        );
        assert!(
            batch.schema().metadata()["rowCorrespondencePrecisionDerivation"]
                .contains("output_row_index present => unresolved")
        );

        let output_kinds = batch
            .column(0)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let output_kind_values = output_kinds
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let row_indexes = batch
            .column(2)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let lineage_indexes = batch
            .column(7)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let selectors = batch
            .column(3)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let selector_values = selectors
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let observed_selectors = (0..selectors.len())
            .map(|index| selector_values.value(selectors.keys().value(index) as usize))
            .collect::<BTreeSet<_>>();
        assert!(observed_selectors.contains("/participants/0/a~1b~0c"));
        let joined_app_cells = (0..batch.num_rows())
            .filter(|index| {
                let key = output_kinds.keys().value(*index) as usize;
                output_kind_values.value(key) == "app-csv"
                    && row_indexes.is_valid(*index)
                    && lineage_indexes.is_valid(*index)
            })
            .count();
        assert_eq!(joined_app_cells, 2);
        assert!(reader.next().is_none());

        assert!(result_cell_correspondence_arrow(
            &[CanonicalOutput {
                kind: "review-summary-json",
                media_type: "application/json",
                bytes: b"{",
                terminal_logical_node: "outputs",
            }],
            &[],
        )
        .unwrap_err()
        .contains("parse review-summary-json JSON cells"));
    }

    #[test]
    fn source_result_influence_is_joinable_conservative_and_gap_explicit() {
        let raw_digest = format!("sha256:{}", "a".repeat(64));
        let options_digest = format!("sha256:{}", "b".repeat(64));
        let raw = b"participant_id,event_timestamp\nP01,2026-01-01 00:00:00\n";
        let options = br#"{"interaction_type_remap":true}"#;
        let sources = [
            CanonicalSource {
                role_id: "raw_chronicle_csv",
                source_artifact_digest: &raw_digest,
                source_media_type: "text/csv",
                coordinate_media_type: "text/csv",
                normalization: "identity-csv",
                bytes: raw,
            },
            CanonicalSource {
                role_id: "processing_options",
                source_artifact_digest: &options_digest,
                source_media_type: "application/json",
                coordinate_media_type: "application/json",
                normalization: "canonical-json",
                bytes: options,
            },
        ];
        let app_csv = b"participant_id,duration_seconds\nP01,60\n";
        let outputs = [CanonicalOutput {
            kind: "app-csv",
            media_type: "text/csv",
            bytes: app_csv,
            terminal_logical_node: "outputs",
        }];
        let lineages = [PipelineRowLineage {
            output_kind: Arc::new("app-csv".to_string()),
            output_row_index: 0,
            source_data_row_ranges: vec![
                chronicle_chrono_kernel_wasm::pipeline_v2::SourceDataRowRange { first: 1, last: 1 },
            ],
            source_data_row_count: 1,
            searches: Vec::new(),
            terminal_logical_node: Arc::new("outputs".to_string()),
        }];
        let plan = crate::embedded_plan();
        let checkpoints = plan
            .nodes
            .iter()
            .map(|node| {
                let digest = format!(
                    "sha256:{}",
                    hex::encode(Sha256::digest(node.node_id.as_bytes()))
                );
                (
                    node.node_id.clone(),
                    LogicalStageCheckpoint {
                        protocol_version: "chronicle-logical-stage-checkpoint/v7".into(),
                        node_id: node.node_id.clone(),
                        row_membership_digest: digest.clone(),
                        row_order_digest: digest.clone(),
                        temporal_state_digest: digest.clone(),
                        classification_digest: digest.clone(),
                        payload_digest: digest.clone(),
                        schema_digest: digest.clone(),
                        terminal_digest: digest,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        let context = InfluenceContext {
            implementation_digest: crate::IMPLEMENTATION_BUILD_DIGEST,
            plan_digest: crate::EMBEDDED_PLAN_SHA256,
            profile_lock_digest: crate::EMBEDDED_PROFILE_LOCK_SHA256,
            dependency_certificate_digest: crate::EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        };

        let (first, row_count) = source_result_influence_witness_arrow(
            &sources,
            &outputs,
            &lineages,
            &plan,
            &checkpoints,
            &context,
        )
        .unwrap();
        let (second, second_count) = source_result_influence_witness_arrow(
            &sources,
            &outputs,
            &lineages,
            &plan,
            &checkpoints,
            &context,
        )
        .unwrap();
        assert_eq!(first, second);
        assert_eq!(row_count, second_count);
        assert!(row_count > 4);

        let mut reader = FileReader::try_new(Cursor::new(first), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        assert_eq!(batch.num_rows(), row_count as usize);
        assert_eq!(
            batch.schema().metadata()["protocolVersion"],
            SOURCE_RESULT_INFLUENCE_PROTOCOL
        );
        assert!(batch.schema().metadata()["claimBoundary"]
            .contains("Absence of a row is never a non-influence claim"));
        assert_eq!(
            batch
                .schema()
                .fields()
                .iter()
                .map(|field| field.name().as_str())
                .collect::<Vec<_>>(),
            vec![
                "source_key_kind",
                "source_role_id",
                "source_selector_prefix",
                "source_field",
                "source_record_index",
                "source_record_last",
                "source_index_space",
                "target_kind",
                "target_id",
                "target_logical_node",
                "target_output_kind",
                "target_output_row_index",
                "target_output_column",
                "relation",
                "precision",
                "evidence_kind",
                "evidence_sha256",
            ]
        );

        let dictionary_values = |column: usize| {
            let dictionary = batch
                .column(column)
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .unwrap();
            let values = dictionary
                .values()
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            (0..dictionary.len())
                .map(|index| {
                    values
                        .value(dictionary.keys().value(index) as usize)
                        .to_string()
                })
                .collect::<BTreeSet<_>>()
        };
        // `app-csv` is the only output here and it carries row lineage, so the
        // column-granular declared scope does not apply and the unresolved gap
        // survives for the option selector prefixes that reach it.
        assert_eq!(
            dictionary_values(13),
            BTreeSet::from([
                "cell-contribution-unresolved".to_string(),
                "exact-field-contribution".to_string(),
                "may-affect-checkpoint".to_string(),
                "may-contribute-via-row-lineage".to_string(),
            ])
        );
        assert_eq!(
            dictionary_values(14),
            BTreeSet::from([
                "conservative-row-lineage".to_string(),
                "declared-transitive".to_string(),
                "exact-field".to_string(),
                "unresolved".to_string(),
            ])
        );

        assert_eq!(
            dictionary_values(0),
            BTreeSet::from([
                "raw-row".to_string(),
                "role-scope".to_string(),
                "selector-prefix".to_string(),
                "source-column-record".to_string(),
            ])
        );
        let source_rows = batch
            .column(4)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let source_last_rows = batch
            .column(5)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let target_rows = batch
            .column(11)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        assert!((0..batch.num_rows())
            .any(|index| source_rows.is_valid(index) && target_rows.is_valid(index)));
        assert!((0..batch.num_rows()).any(|index| !target_rows.is_valid(index)));
        assert!((0..batch.num_rows()).all(|index| {
            source_rows.is_valid(index) == source_last_rows.is_valid(index)
                && (!source_rows.is_valid(index)
                    || source_rows.value(index) <= source_last_rows.value(index))
        }));
        assert!((0..batch.num_rows()).any(|index| {
            source_rows.is_valid(index)
                && (source_rows.value(index), source_last_rows.value(index)) == (1, 1)
        }));
        let source_roles = batch
            .column(1)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let source_role_values = source_roles
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let relations = batch
            .column(13)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let relation_values = relations
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert!(!(0..batch.num_rows()).any(|index| {
            source_role_values.value(source_roles.keys().value(index) as usize)
                == "raw_chronicle_csv"
                && relation_values.value(relations.keys().value(index) as usize)
                    == "cell-contribution-unresolved"
        }));

        // The exact-field class must never appear on a cell the field contract
        // does not name as a verbatim single-source copy. `duration_seconds`
        // is the negative control: it is an app-csv column of the same row,
        // the row lineage is a single raw record, and it still must not be
        // claimed exact because the pipeline computes it.
        let precision_column = batch
            .column(14)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let precision_values = precision_column
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let read_dictionary = |column: usize, index: usize| {
            let dictionary = batch
                .column(column)
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .unwrap();
            if !dictionary.is_valid(index) {
                return None;
            }
            let values = dictionary
                .values()
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            Some(values.value(dictionary.keys().value(index) as usize).to_string())
        };
        let exact_rows = (0..batch.num_rows())
            .filter(|index| {
                precision_values.value(precision_column.keys().value(*index) as usize)
                    == "exact-field"
            })
            .map(|index| {
                (
                    read_dictionary(3, index),
                    read_dictionary(10, index),
                    read_dictionary(12, index),
                    source_rows.value(index),
                    target_rows.value(index),
                )
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(
            exact_rows,
            BTreeSet::from([
                (
                    Some("raw_chronicle_csv.participant_id".to_string()),
                    Some("app-csv".to_string()),
                    Some("participant_id".to_string()),
                    1,
                    0,
                ),
                (
                    Some("raw_chronicle_csv.study_id".to_string()),
                    Some("app-csv".to_string()),
                    Some("study_id".to_string()),
                    1,
                    0,
                ),
            ])
        );
        assert!(
            !exact_rows
                .iter()
                .any(|(_, _, column, _, _)| column.as_deref() == Some("duration_seconds")),
            "a computed column must never carry the exact-field precision class"
        );

        // Every exact-field row must name both coordinates; every row that is
        // not exact-field must leave `source_field` null unless it is the
        // column-granular declared scope.
        for index in 0..batch.num_rows() {
            let precision =
                precision_values.value(precision_column.keys().value(index) as usize);
            let has_source_field = read_dictionary(3, index).is_some();
            let has_target_column = read_dictionary(12, index).is_some();
            match precision {
                "exact-field" => assert!(has_source_field && has_target_column),
                "declared-column-scope" => {
                    assert!(has_source_field && has_target_column);
                    assert!(!target_rows.is_valid(index));
                }
                _ => assert!(!has_source_field && !has_target_column),
            }
        }
        assert!(reader.next().is_none());
    }

    /// The stop-event search window is real lineage the row ranges do not
    /// carry, and a result family with no row lineage must still be resolved
    /// to named output columns rather than reported as one unresolved gap.
    #[test]
    fn search_windows_and_row_lineage_free_outputs_both_carry_witness_rows() {
        let raw_digest = format!("sha256:{}", "a".repeat(64));
        let sources = [CanonicalSource {
            role_id: "raw_chronicle_csv",
            source_artifact_digest: &raw_digest,
            source_media_type: "text/csv",
            coordinate_media_type: "text/csv",
            normalization: "identity-csv",
            bytes: b"participant_id\nP01\n",
        }];
        let outputs = [
            CanonicalOutput {
                kind: "app-csv",
                media_type: "text/csv",
                bytes: b"participant_id\nP01\n",
                terminal_logical_node: "outputs",
            },
            CanonicalOutput {
                kind: "compliance-csv",
                media_type: "text/csv",
                bytes: b"participant_id\nP01\n",
                terminal_logical_node: "outputs",
            },
        ];
        let lineages = [PipelineRowLineage {
            output_kind: Arc::new("app-csv".to_string()),
            output_row_index: 0,
            source_data_row_ranges: vec![
                chronicle_chrono_kernel_wasm::pipeline_v2::SourceDataRowRange { first: 1, last: 1 },
            ],
            source_data_row_count: 1,
            searches: vec![
                chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchEvidence {
                    protocol_version: Arc::new("chronicle-lineage-search/v1".to_string()),
                    reason: Arc::new("no-qualifying-stop".to_string()),
                    index_space: Arc::new("pipeline-event-order".to_string()),
                    start_participant_id: Arc::new("P01".to_string()),
                    start_event_index: 1,
                    end_event_index_exclusive: 4,
                    candidate_event_count: 3,
                    candidate_chain_digest:
                        chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchDigest::parse(
                            &format!("blake3:{}", "c".repeat(64)),
                        )
                        .unwrap(),
                },
                // The screen-credit window counts per-participant source
                // events from zero — the shape the checked-in
                // `row_lineage.json` carries. Index 0 is not a record at all
                // in the one-based data-row space, so this is the case that
                // proves the search bounds are never published as raw records.
                chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchEvidence {
                    protocol_version: Arc::new("chronicle-lineage-search/v1".to_string()),
                    reason: Arc::new("screen-credit-liveness-window".to_string()),
                    index_space: Arc::new("participant-source-event-order".to_string()),
                    start_participant_id: Arc::new("P01".to_string()),
                    start_event_index: 0,
                    end_event_index_exclusive: 3,
                    candidate_event_count: 3,
                    candidate_chain_digest:
                        chronicle_chrono_kernel_wasm::pipeline_v2::LineageSearchDigest::parse(
                            &format!("blake3:{}", "d".repeat(64)),
                        )
                        .unwrap(),
                },
            ],
            terminal_logical_node: Arc::new("outputs".to_string()),
        }];
        let plan = crate::embedded_plan();
        let checkpoints = BTreeMap::new();
        let context = InfluenceContext {
            implementation_digest: crate::IMPLEMENTATION_BUILD_DIGEST,
            plan_digest: crate::EMBEDDED_PLAN_SHA256,
            profile_lock_digest: crate::EMBEDDED_PROFILE_LOCK_SHA256,
            dependency_certificate_digest: crate::EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256,
        };
        let (bytes, _rows) = source_result_influence_witness_arrow(
            &sources,
            &outputs,
            &lineages,
            &plan,
            &checkpoints,
            &context,
        )
        .unwrap();
        let mut reader = FileReader::try_new(Cursor::new(bytes), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        let text = |column: usize, index: usize| {
            let dictionary = batch
                .column(column)
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .unwrap();
            if !dictionary.is_valid(index) {
                return None;
            }
            let values = dictionary
                .values()
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            Some(values.value(dictionary.keys().value(index) as usize).to_string())
        };
        let source_rows = batch
            .column(4)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        let source_last_rows = batch
            .column(5)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();

        // The searches channel carries its scanned range under its own key
        // kind, in its own named index space — not as a raw-record range.
        let search_rows = (0..batch.num_rows())
            .filter(|index| text(14, *index).as_deref() == Some("conservative-search-window"))
            .map(|index| {
                (
                    text(0, index),
                    text(6, index),
                    source_rows.value(index),
                    source_last_rows.value(index),
                )
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(
            search_rows,
            BTreeSet::from([
                (
                    Some(LINEAGE_SEARCH_SOURCE_KEY_KIND.to_string()),
                    Some("participant-source-event-order".to_string()),
                    0,
                    2,
                ),
                (
                    Some(LINEAGE_SEARCH_SOURCE_KEY_KIND.to_string()),
                    Some("pipeline-event-order".to_string()),
                    1,
                    3,
                ),
            ])
        );
        // No search window is published in the raw-record key space, and no
        // row outside that channel claims a non-default index space.
        assert!(!(0..batch.num_rows()).any(|index| {
            text(0, index).as_deref() == Some("raw-row")
                && text(14, index).as_deref() == Some("conservative-search-window")
        }));
        for index in 0..batch.num_rows() {
            assert_eq!(
                text(6, index).is_some(),
                text(0, index).as_deref() == Some(LINEAGE_SEARCH_SOURCE_KEY_KIND),
                "source_index_space is non-null exactly on lineage-search rows"
            );
        }
        // The join the witness publishes must not invite a raw-record join on
        // those rows.
        let metadata = batch.schema().metadata().clone();
        assert!(
            metadata["sourceCoordinateJoin"].contains("source_key_kind <> 'lineage-search-window'")
        );
        assert!(metadata["sourceIndexSpace"].contains(SOURCE_COORDINATE_RECORD_INDEX_BASE));
        // A row whose lineage carries a search is not claimed exact.
        assert!(
            !(0..batch.num_rows()).any(|index| text(14, index).as_deref() == Some("exact-field"))
        );
        // compliance-csv has no row lineage and is still resolved to columns.
        let compliance_columns = (0..batch.num_rows())
            .filter(|index| {
                text(10, *index).as_deref() == Some("compliance-csv")
                    && text(14, *index).as_deref() == Some("declared-column-scope")
            })
            .filter_map(|index| text(12, index))
            .collect::<BTreeSet<_>>();
        assert!(compliance_columns.contains("compliance_percent"));
        assert!(compliance_columns.contains("expected_device_count"));
        // No unresolved gap survives for a scope the column reach resolved.
        assert!(!(0..batch.num_rows()).any(|index| {
            text(10, index).as_deref() == Some("compliance-csv")
                && text(14, index).as_deref() == Some("unresolved")
        }));
    }

    #[test]
    fn result_cell_streaming_writes_and_reads_every_deterministic_batch() {
        let data_rows = RESULT_CELL_BATCH_ROWS + 5;
        let mut csv = String::with_capacity(data_rows * 8);
        csv.push_str("value\n");
        for index in 0..data_rows {
            csv.push_str(&index.to_string());
            csv.push('\n');
        }
        let outputs = [CanonicalOutput {
            kind: "app-csv",
            media_type: "text/csv",
            bytes: csv.as_bytes(),
            terminal_logical_node: "outputs",
        }];

        let (first, row_count) = result_cell_correspondence_arrow(&outputs, &[]).unwrap();
        let (second, second_count) = result_cell_correspondence_arrow(&outputs, &[]).unwrap();
        assert_eq!(first, second);
        assert_eq!(row_count, second_count);
        assert_eq!(row_count as usize, data_rows + 2);

        let reader = FileReader::try_new(Cursor::new(first), None).unwrap();
        let batches = reader.collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(
            batches.iter().map(RecordBatch::num_rows).sum::<usize>(),
            data_rows + 2
        );
        let observed_row_indexes = batches
            .iter()
            .flat_map(|batch| {
                let indexes = batch
                    .column(2)
                    .as_any()
                    .downcast_ref::<UInt32Array>()
                    .unwrap();
                (0..indexes.len())
                    .filter(|index| indexes.is_valid(*index))
                    .map(|index| indexes.value(index))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        assert_eq!(observed_row_indexes.len(), data_rows);
        assert_eq!(observed_row_indexes.first(), Some(&0));
        assert_eq!(
            observed_row_indexes.last(),
            Some(&u32::try_from(data_rows - 1).unwrap())
        );
        assert_eq!(
            batches[0].schema().metadata()["recordBatchRows"],
            RESULT_CELL_BATCH_ROWS.to_string()
        );
    }

    #[test]
    fn app_export_types_long_strings_and_invalid_scalars_are_pinned() {
        let long = format!("{}é", "x".repeat(255));
        let csv = format!(
            "participant_id,duration_minutes,day,valid_app_new_engage_custom_30,free_text\nP01,1.25,2,3,{long}\nP02,,,,\n"
        );
        let parquet = parquet_from_csv(csv.as_bytes(), false).unwrap();
        assert!(parquet.starts_with(b"PAR1"));
        let sav = sav_from_csv(csv.as_bytes(), false).unwrap();
        assert!(sav.starts_with(b"$FL2"));
        assert_eq!(
            crate::sha256(&sav),
            "sha256:bb9a7b02facf5454cb1168e80c11e7ee53ddf591c71ebe47011fb28911add95b"
        );

        assert!(parquet_from_csv(b"day\nnot-int\n", false)
            .unwrap_err()
            .contains("invalid INT32"));
        assert!(parquet_from_csv(b"duration_minutes\nnot-double\n", false)
            .unwrap_err()
            .contains("invalid DOUBLE"));
        assert!(
            parquet_from_csv(b"screen_usage_lock_screen_only\nmaybe\n", true)
                .unwrap_err()
                .contains("invalid BOOLEAN")
        );
        assert!(sav_from_csv(b"day\nnot-int\n", false)
            .unwrap_err()
            .contains("invalid SAV numeric"));
        assert!(
            sav_from_csv(b"screen_usage_lock_screen_only\nmaybe\n", true)
                .unwrap_err()
                .contains("invalid SAV boolean")
        );
    }

    /// `append_binary_exports` parses each canonical CSV once and hands the
    /// same `CsvTable` to the Parquet writer and then to the SPSS writer. That
    /// sharing is only allowed to be a performance change, so both writers must
    /// produce exactly the bytes an independent reparse produced, and the
    /// second writer must not be affected by the first having read the table.
    #[test]
    fn shared_export_table_is_byte_identical_to_independent_reparse() {
        let long = format!("{}é", "x".repeat(255));
        let app_csv = format!(
            "participant_id,duration_minutes,day,valid_app_new_engage_custom_30,free_text\nP01,1.25,2,3,{long}\nP02,,,,\n"
        );
        let screen_csv =
            "participant_id,duration_seconds,hour,screen_usage_lock_screen_only,free_text\n\
             P01,12.5,3,true,ok\nP02,,,,\n";
        for (bytes, screen) in [(app_csv.as_bytes(), false), (screen_csv.as_bytes(), true)] {
            let independent_parquet = parquet_from_csv(bytes, screen).unwrap();
            let independent_sav = sav_from_csv(bytes, screen).unwrap();
            let shared = parse_csv(bytes).unwrap();
            let shared_parquet = parquet_from_table(&shared, screen).unwrap();
            let shared_sav = sav_from_table(&shared, screen).unwrap();
            assert_eq!(shared_parquet, independent_parquet);
            assert_eq!(shared_sav, independent_sav);
            // Reusing the table a third time still yields the same bytes.
            assert_eq!(parquet_from_table(&shared, screen).unwrap(), shared_parquet);
        }
    }

    #[test]
    fn sav_primitive_encoding_and_type_rules_are_exact() {
        assert_eq!(
            column_kind("any_app_new_engage_custom_45", false),
            ColumnKind::Int32
        );
        assert_eq!(column_kind("free_text", false), ColumnKind::String);
        assert_eq!(column_kind("duration_minutes", false), ColumnKind::Double);
        assert_eq!(
            column_kind("screen_usage_lock_screen_only", true),
            ColumnKind::Boolean
        );

        let table = parse_csv(b"free_text,duration_minutes,day\nlonger,1.25,2\nx,,\n").unwrap();
        let variables = sav_variables(&table, false);
        assert_eq!(variables.len(), 3);
        assert_eq!(variables[0].kind, ColumnKind::String);
        assert_eq!(variables[0].string_width, 6);
        assert_eq!(variables[0].decimals, 0);
        assert_eq!(variables[1].kind, ColumnKind::Double);
        assert_eq!(variables[1].string_width, 0);
        assert_eq!(variables[1].decimals, 2);
        assert_eq!(variables[2].kind, ColumnKind::Int32);
        assert_eq!(slot_count(&variables[0]), 1);

        let mut sink = ByteSink::new();
        sink.i32(0x0102_0304);
        sink.f64(1.5);
        assert_eq!(&sink.bytes[..4], &0x0102_0304_i32.to_le_bytes());
        assert_eq!(&sink.bytes[4..], &1.5_f64.to_le_bytes());

        assert_eq!(pack_format(5, 13, 2), 0x0005_0d02);
        let mut label = ByteSink::new();
        write_label(&mut label, "abcde");
        assert_eq!(&label.bytes[..4], &5_i32.to_le_bytes());
        assert_eq!(&label.bytes[4..], b"abcde   ");

        assert_eq!(truncated_utf8_len(b"abc", 5), 3);
        assert_eq!(truncated_utf8_len(b"abcdef", 3), 3);
        assert_eq!(truncated_utf8_len("éé".as_bytes(), 3), 2);
        assert_eq!(truncated_utf8_len("éé".as_bytes(), 1), 0);
        assert_eq!(truncated_utf8_len("éé".as_bytes(), 4), 4);

        let mut commands = SavCommands::new();
        let mut encoded = ByteSink::new();
        for code in 1..=7 {
            commands.emit(&mut encoded, code, None);
        }
        assert!(encoded.bytes.is_empty());
        commands.emit(&mut encoded, 253, Some(1.5_f64.to_le_bytes().to_vec()));
        assert_eq!(&encoded.bytes[..8], &[1, 2, 3, 4, 5, 6, 7, 253]);
        assert_eq!(&encoded.bytes[8..], &1.5_f64.to_le_bytes());
        assert!(commands.commands.is_empty());
        commands.emit(&mut encoded, 254, None);
        commands.flush(&mut encoded);
        assert_eq!(&encoded.bytes[16..24], &[254, 0, 0, 0, 0, 0, 0, 0]);
    }
}
