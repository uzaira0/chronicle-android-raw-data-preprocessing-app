use arrow_array::{
    builder::{FixedSizeBinaryBuilder, FixedSizeBinaryDictionaryBuilder, StringDictionaryBuilder},
    types::Int32Type,
    ArrayRef, BooleanArray, Float64Array, Int32Array, RecordBatch, StringArray, UInt32Array,
};
use arrow_ipc::{
    writer::{FileWriter, IpcWriteOptions},
    CompressionType,
};
use arrow_schema::{DataType, Field, Schema};
use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineRowLineage;
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

const RESULT_CELL_CORRESPONDENCE_PROTOCOL: &str = "chronicle-result-cell-correspondence/v1";
const SOURCE_COORDINATE_PROTOCOL: &str = "chronicle-source-coordinate-index/v1";

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

#[derive(Clone, Debug, PartialEq, Eq)]
struct SourceCoordinateRecord {
    role_id: String,
    source_artifact_digest: String,
    source_media_type: String,
    coordinate_media_type: String,
    normalization: String,
    address_kind: &'static str,
    source_record_index: Option<u32>,
    selector: String,
    value_digest: [u8; 32],
    coordinate_id: [u8; 32],
}

fn source_coordinate_id(
    source: &CanonicalSource<'_>,
    address_kind: &str,
    source_record_index: Option<u32>,
    selector: &str,
    value_digest: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
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

fn push_source_coordinate(
    records: &mut Vec<SourceCoordinateRecord>,
    source: &CanonicalSource<'_>,
    address_kind: &'static str,
    source_record_index: Option<u32>,
    selector: String,
    value_bytes: &[u8],
) {
    let value_digest = sha256_array(value_bytes);
    records.push(SourceCoordinateRecord {
        role_id: source.role_id.to_string(),
        source_artifact_digest: source.source_artifact_digest.to_string(),
        source_media_type: source.source_media_type.to_string(),
        coordinate_media_type: source.coordinate_media_type.to_string(),
        normalization: source.normalization.to_string(),
        address_kind,
        source_record_index,
        coordinate_id: source_coordinate_id(
            source,
            address_kind,
            source_record_index,
            &selector,
            &value_digest,
        ),
        selector,
        value_digest,
    });
}

fn append_source_json_coordinates(
    records: &mut Vec<SourceCoordinateRecord>,
    source: &CanonicalSource<'_>,
    path: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    match value {
        serde_json::Value::Array(values) => {
            if values.is_empty() {
                push_source_coordinate(records, source, "json-leaf", None, path.into(), b"[]");
            }
            for (index, value) in values.iter().enumerate() {
                append_source_json_coordinates(records, source, &format!("{path}/{index}"), value)?;
            }
        }
        serde_json::Value::Object(values) => {
            if values.is_empty() {
                push_source_coordinate(records, source, "json-leaf", None, path.into(), b"{}");
            }
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                append_source_json_coordinates(
                    records,
                    source,
                    &format!("{path}/{}", json_pointer_escape(key)),
                    &values[key],
                )?;
            }
        }
        _ => {
            let encoded = serde_jcs::to_vec(value)
                .map_err(|error| format!("canonicalize source JSON coordinate {path}: {error}"))?;
            push_source_coordinate(records, source, "json-leaf", None, path.into(), &encoded);
        }
    }
    Ok(())
}

fn append_source_csv_coordinates(
    records: &mut Vec<SourceCoordinateRecord>,
    source: &CanonicalSource<'_>,
) -> Result<(), String> {
    let table = parse_csv(source.bytes)?;
    for (zero_based_index, row) in table.rows.iter().enumerate() {
        let source_record_index = u32::try_from(zero_based_index + 1)
            .map_err(|_| format!("{} source row index exceeds u32", source.role_id))?;
        for (column_index, column) in table.headers.iter().enumerate() {
            push_source_coordinate(
                records,
                source,
                "csv-cell",
                Some(source_record_index),
                column.clone(),
                row.get(column_index)
                    .map(String::as_bytes)
                    .unwrap_or_default(),
            );
        }
    }
    let headers = serde_jcs::to_vec(&table.headers)
        .map_err(|error| format!("canonicalize {} source columns: {error}", source.role_id))?;
    push_source_coordinate(
        records,
        source,
        "csv-shape",
        None,
        "/shape/columns".into(),
        &headers,
    );
    push_source_coordinate(
        records,
        source,
        "csv-shape",
        None,
        "/shape/rows".into(),
        table.rows.len().to_string().as_bytes(),
    );
    Ok(())
}

struct ResultCellRecord {
    output_kind: String,
    address_kind: &'static str,
    output_row_index: Option<u32>,
    selector: String,
    cell_value_digest: [u8; 32],
    terminal_logical_node: String,
    row_lineage_output_kind: Option<String>,
    row_lineage_row_index: Option<u32>,
    row_correspondence_precision: &'static str,
    semantic_dependency_precision: &'static str,
    dependency_spec_digest: [u8; 32],
}

fn sha256_array(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn dependency_spec_digest(output_kind: &str, selector: &str, terminal_node: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for field in [
        RESULT_CELL_CORRESPONDENCE_PROTOCOL,
        output_kind,
        selector,
        terminal_node,
    ] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field.as_bytes());
    }
    hasher.finalize().into()
}

fn push_cell(
    records: &mut Vec<ResultCellRecord>,
    output: &CanonicalOutput<'_>,
    address_kind: &'static str,
    output_row_index: Option<u32>,
    selector: String,
    value_bytes: &[u8],
    row_lineage: Option<&PipelineRowLineage>,
) {
    let row_correspondence_precision = if row_lineage.is_some() {
        "conservative"
    } else if output_row_index.is_some() {
        "unresolved"
    } else {
        "not-applicable"
    };
    records.push(ResultCellRecord {
        output_kind: output.kind.to_string(),
        address_kind,
        output_row_index,
        selector: selector.clone(),
        cell_value_digest: sha256_array(value_bytes),
        terminal_logical_node: output.terminal_logical_node.to_string(),
        row_lineage_output_kind: row_lineage.map(|lineage| lineage.output_kind.to_string()),
        row_lineage_row_index: row_lineage.map(|lineage| lineage.output_row_index),
        row_correspondence_precision,
        semantic_dependency_precision: "declared-transitive",
        dependency_spec_digest: dependency_spec_digest(
            output.kind,
            &selector,
            output.terminal_logical_node,
        ),
    });
}

fn json_pointer_escape(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn append_json_cells(
    records: &mut Vec<ResultCellRecord>,
    output: &CanonicalOutput<'_>,
    path: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    match value {
        serde_json::Value::Array(values) => {
            if values.is_empty() {
                push_cell(
                    records,
                    output,
                    "json-leaf",
                    None,
                    path.to_string(),
                    b"[]",
                    None,
                );
            }
            for (index, value) in values.iter().enumerate() {
                append_json_cells(records, output, &format!("{path}/{index}"), value)?;
            }
        }
        serde_json::Value::Object(values) => {
            if values.is_empty() {
                push_cell(
                    records,
                    output,
                    "json-leaf",
                    None,
                    path.to_string(),
                    b"{}",
                    None,
                );
            }
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                append_json_cells(
                    records,
                    output,
                    &format!("{path}/{}", json_pointer_escape(key)),
                    &values[key],
                )?;
            }
        }
        _ => {
            let encoded = serde_jcs::to_vec(value)
                .map_err(|error| format!("canonicalize JSON result cell {path}: {error}"))?;
            push_cell(
                records,
                output,
                "json-leaf",
                None,
                path.to_string(),
                &encoded,
                None,
            );
        }
    }
    Ok(())
}

fn append_csv_cells(
    records: &mut Vec<ResultCellRecord>,
    output: &CanonicalOutput<'_>,
    lineages: &HashMap<(&str, u32), &PipelineRowLineage>,
) -> Result<(), String> {
    let table = parse_csv(output.bytes)?;
    for (row_index, row) in table.rows.iter().enumerate() {
        let row_index = u32::try_from(row_index)
            .map_err(|_| format!("{} row index exceeds u32", output.kind))?;
        let lineage = lineages.get(&(output.kind, row_index)).copied();
        for (column_index, column) in table.headers.iter().enumerate() {
            push_cell(
                records,
                output,
                "csv-cell",
                Some(row_index),
                column.clone(),
                row.get(column_index)
                    .map(String::as_bytes)
                    .unwrap_or_default(),
                lineage,
            );
        }
    }
    push_cell(
        records,
        output,
        "csv-shape",
        None,
        "/shape/rows".into(),
        table.rows.len().to_string().as_bytes(),
        None,
    );
    let columns = serde_jcs::to_vec(&table.headers)
        .map_err(|error| format!("canonicalize {} columns: {error}", output.kind))?;
    push_cell(
        records,
        output,
        "csv-shape",
        None,
        "/shape/columns".into(),
        &columns,
        None,
    );
    Ok(())
}

fn dictionary_type() -> DataType {
    DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8))
}

fn digest_dictionary_type() -> DataType {
    DataType::Dictionary(
        Box::new(DataType::Int32),
        Box::new(DataType::FixedSizeBinary(32)),
    )
}

/// Stable exact coordinates for every state-bearing ingress CSV cell or JSON
/// leaf. These are dependency-witness endpoints, not claims that a coordinate
/// affected a particular output. The source artifact digest preserves byte
/// identity while `normalization` makes decoded/normalized coordinate spaces
/// explicit.
pub fn source_coordinate_index_arrow(
    sources: &[CanonicalSource<'_>],
) -> Result<(Vec<u8>, u32), String> {
    let mut records = Vec::new();
    for source in sources {
        match source.coordinate_media_type {
            "text/csv" => append_source_csv_coordinates(&mut records, source)?,
            "application/json" => {
                let value: serde_json::Value =
                    serde_json::from_slice(source.bytes).map_err(|error| {
                        format!("parse {} source JSON coordinates: {error}", source.role_id)
                    })?;
                append_source_json_coordinates(&mut records, source, "", &value)?;
            }
            other => {
                return Err(format!(
                    "unsupported source coordinate media type {other} for {}",
                    source.role_id
                ));
            }
        }
    }
    records.sort_by(|left, right| {
        (
            left.role_id.as_str(),
            left.source_record_index,
            left.selector.as_str(),
        )
            .cmp(&(
                right.role_id.as_str(),
                right.source_record_index,
                right.selector.as_str(),
            ))
    });
    let row_count = u32::try_from(records.len())
        .map_err(|_| "source coordinate index exceeds u32 rows".to_string())?;

    let mut role_id = StringDictionaryBuilder::<Int32Type>::new();
    let mut source_artifact_digest = StringDictionaryBuilder::<Int32Type>::new();
    let mut source_media_type = StringDictionaryBuilder::<Int32Type>::new();
    let mut coordinate_media_type = StringDictionaryBuilder::<Int32Type>::new();
    let mut normalization = StringDictionaryBuilder::<Int32Type>::new();
    let mut address_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut selector = StringDictionaryBuilder::<Int32Type>::new();
    let mut value_digest = FixedSizeBinaryBuilder::with_capacity(records.len(), 32);
    let mut coordinate_id = FixedSizeBinaryBuilder::with_capacity(records.len(), 32);
    let source_record_index = UInt32Array::from(
        records
            .iter()
            .map(|record| record.source_record_index)
            .collect::<Vec<_>>(),
    );
    for record in &records {
        role_id
            .append(&record.role_id)
            .map_err(|error| error.to_string())?;
        source_artifact_digest
            .append(&record.source_artifact_digest)
            .map_err(|error| error.to_string())?;
        source_media_type
            .append(&record.source_media_type)
            .map_err(|error| error.to_string())?;
        coordinate_media_type
            .append(&record.coordinate_media_type)
            .map_err(|error| error.to_string())?;
        normalization
            .append(&record.normalization)
            .map_err(|error| error.to_string())?;
        address_kind
            .append(record.address_kind)
            .map_err(|error| error.to_string())?;
        selector
            .append(&record.selector)
            .map_err(|error| error.to_string())?;
        value_digest
            .append_value(record.value_digest)
            .map_err(|error| error.to_string())?;
        coordinate_id
            .append_value(record.coordinate_id)
            .map_err(|error| error.to_string())?;
    }

    let mut metadata = HashMap::new();
    metadata.insert("protocolVersion".into(), SOURCE_COORDINATE_PROTOCOL.into());
    metadata.insert(
        "claimBoundary".into(),
        "Exact role-bound source coordinates and value identities. Coordinates are dependency-witness endpoints; output contribution is not implied without a separate witness edge.".into(),
    );
    metadata.insert("recordIndexBase".into(), "one-based-data-row".into());
    metadata.insert("recordBatchCompression".into(), "lz4-frame".into());
    let schema = Arc::new(Schema::new_with_metadata(
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
            Field::new("coordinate_sha256", DataType::FixedSizeBinary(32), false),
        ],
        metadata,
    ));
    let arrays: Vec<ArrayRef> = vec![
        Arc::new(role_id.finish()),
        Arc::new(source_artifact_digest.finish()),
        Arc::new(source_media_type.finish()),
        Arc::new(coordinate_media_type.finish()),
        Arc::new(normalization.finish()),
        Arc::new(address_kind.finish()),
        Arc::new(source_record_index),
        Arc::new(selector.finish()),
        Arc::new(value_digest.finish()),
        Arc::new(coordinate_id.finish()),
    ];
    let batch = RecordBatch::try_new(schema.clone(), arrays)
        .map_err(|error| format!("build source coordinate Arrow batch: {error}"))?;
    let mut output = Cursor::new(Vec::new());
    {
        let write_options = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|error| format!("configure source coordinate compression: {error}"))?;
        let mut writer = FileWriter::try_new_with_options(&mut output, &schema, write_options)
            .map_err(|error| format!("create source coordinate writer: {error}"))?;
        writer
            .write(&batch)
            .map_err(|error| format!("write source coordinate batch: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("finish source coordinate file: {error}"))?;
    }
    Ok((output.into_inner(), row_count))
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
    let lineages = row_lineages
        .iter()
        .map(|lineage| ((lineage.output_kind, lineage.output_row_index), lineage))
        .collect::<HashMap<_, _>>();
    let mut records = Vec::new();
    for output in outputs {
        match output.media_type {
            "text/csv" => append_csv_cells(&mut records, output, &lineages)?,
            "application/json" => {
                let value: serde_json::Value = serde_json::from_slice(output.bytes)
                    .map_err(|error| format!("parse {} JSON cells: {error}", output.kind))?;
                append_json_cells(&mut records, output, "", &value)?;
            }
            other => return Err(format!("unsupported canonical cell media type {other}")),
        }
    }
    records.sort_by(|left, right| {
        (
            left.output_kind.as_str(),
            left.output_row_index,
            left.selector.as_str(),
        )
            .cmp(&(
                right.output_kind.as_str(),
                right.output_row_index,
                right.selector.as_str(),
            ))
    });
    let row_count = u32::try_from(records.len())
        .map_err(|_| "result cell correspondence exceeds u32 rows".to_string())?;

    let mut output_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut address_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut selector = StringDictionaryBuilder::<Int32Type>::new();
    let mut cell_value_digest = FixedSizeBinaryBuilder::with_capacity(records.len(), 32);
    let mut terminal_logical_node = StringDictionaryBuilder::<Int32Type>::new();
    let mut row_lineage_output_kind = StringDictionaryBuilder::<Int32Type>::new();
    let mut row_correspondence_precision = StringDictionaryBuilder::<Int32Type>::new();
    let mut semantic_dependency_precision = StringDictionaryBuilder::<Int32Type>::new();
    let mut dependency_spec_digest =
        FixedSizeBinaryDictionaryBuilder::<Int32Type>::with_capacity(records.len(), 256, 32);
    let output_row_index = UInt32Array::from(
        records
            .iter()
            .map(|record| record.output_row_index)
            .collect::<Vec<_>>(),
    );
    let row_lineage_row_index = UInt32Array::from(
        records
            .iter()
            .map(|record| record.row_lineage_row_index)
            .collect::<Vec<_>>(),
    );
    for record in &records {
        output_kind
            .append(&record.output_kind)
            .map_err(|error| error.to_string())?;
        address_kind
            .append(record.address_kind)
            .map_err(|error| error.to_string())?;
        selector
            .append(&record.selector)
            .map_err(|error| error.to_string())?;
        cell_value_digest
            .append_value(record.cell_value_digest)
            .map_err(|error| error.to_string())?;
        terminal_logical_node
            .append(&record.terminal_logical_node)
            .map_err(|error| error.to_string())?;
        if let Some(kind) = &record.row_lineage_output_kind {
            row_lineage_output_kind
                .append(kind)
                .map_err(|error| error.to_string())?;
        } else {
            row_lineage_output_kind.append_null();
        }
        row_correspondence_precision
            .append(record.row_correspondence_precision)
            .map_err(|error| error.to_string())?;
        semantic_dependency_precision
            .append(record.semantic_dependency_precision)
            .map_err(|error| error.to_string())?;
        dependency_spec_digest
            .append(record.dependency_spec_digest)
            .map_err(|error| error.to_string())?;
    }

    let mut metadata = HashMap::new();
    metadata.insert(
        "protocolVersion".into(),
        RESULT_CELL_CORRESPONDENCE_PROTOCOL.into(),
    );
    metadata.insert(
        "claimBoundary".into(),
        "Exact canonical CSV/JSON cell coordinates and value digests; exact joins to output-row lineage keys; raw-row contributors remain conservative and semantic dependencies remain declared-transitive.".into(),
    );
    metadata.insert("recordBatchCompression".into(), "lz4-frame".into());
    let schema = Arc::new(Schema::new_with_metadata(
        vec![
            Field::new("output_kind", dictionary_type(), false),
            Field::new("address_kind", dictionary_type(), false),
            Field::new("output_row_index", DataType::UInt32, true),
            Field::new("selector", dictionary_type(), false),
            Field::new("cell_value_sha256", DataType::FixedSizeBinary(32), false),
            Field::new("terminal_logical_node", dictionary_type(), false),
            Field::new("row_lineage_output_kind", dictionary_type(), true),
            Field::new("row_lineage_row_index", DataType::UInt32, true),
            Field::new("row_correspondence_precision", dictionary_type(), false),
            Field::new("semantic_dependency_precision", dictionary_type(), false),
            Field::new("dependency_spec_sha256", digest_dictionary_type(), false),
        ],
        metadata,
    ));
    let arrays: Vec<ArrayRef> = vec![
        Arc::new(output_kind.finish()),
        Arc::new(address_kind.finish()),
        Arc::new(output_row_index),
        Arc::new(selector.finish()),
        Arc::new(cell_value_digest.finish()),
        Arc::new(terminal_logical_node.finish()),
        Arc::new(row_lineage_output_kind.finish()),
        Arc::new(row_lineage_row_index),
        Arc::new(row_correspondence_precision.finish()),
        Arc::new(semantic_dependency_precision.finish()),
        Arc::new(dependency_spec_digest.finish()),
    ];
    let batch = RecordBatch::try_new(schema.clone(), arrays)
        .map_err(|error| format!("build result-cell correspondence Arrow batch: {error}"))?;
    let mut output = Cursor::new(Vec::new());
    {
        let write_options = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|error| format!("configure result-cell compression: {error}"))?;
        let mut writer = FileWriter::try_new_with_options(&mut output, &schema, write_options)
            .map_err(|error| format!("create result-cell correspondence writer: {error}"))?;
        writer
            .write(&batch)
            .map_err(|error| format!("write result-cell correspondence batch: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("finish result-cell correspondence file: {error}"))?;
    }
    Ok((output.into_inner(), row_count))
}

pub fn row_lineage_arrow(
    lineages: &[PipelineRowLineage],
    source_input_digest: &str,
) -> Result<Vec<u8>, String> {
    let mut output_kind = Vec::new();
    let mut output_row_index = Vec::new();
    let mut source_data_row_number = Vec::new();
    let mut source_digest = Vec::new();
    let mut terminal_logical_node = Vec::new();
    let mut dependency_precision = Vec::new();
    for lineage in lineages {
        for source_row in &lineage.source_data_rows {
            output_kind.push(lineage.output_kind);
            output_row_index.push(lineage.output_row_index);
            source_data_row_number.push(*source_row);
            source_digest.push(source_input_digest);
            terminal_logical_node.push(lineage.terminal_logical_node);
            dependency_precision.push("conservative");
        }
    }
    let schema = Arc::new(Schema::new(vec![
        Field::new("output_kind", DataType::Utf8, false),
        Field::new("output_row_index", DataType::UInt32, false),
        Field::new("source_data_row_number", DataType::UInt32, false),
        Field::new("source_input_digest", DataType::Utf8, false),
        Field::new("terminal_logical_node", DataType::Utf8, false),
        Field::new("dependency_precision", DataType::Utf8, false),
    ]));
    let arrays: Vec<ArrayRef> = vec![
        Arc::new(StringArray::from(output_kind)),
        Arc::new(UInt32Array::from(output_row_index)),
        Arc::new(UInt32Array::from(source_data_row_number)),
        Arc::new(StringArray::from(source_digest)),
        Arc::new(StringArray::from(terminal_logical_node)),
        Arc::new(StringArray::from(dependency_precision)),
    ];
    let batch = RecordBatch::try_new(schema.clone(), arrays)
        .map_err(|error| format!("build lineage Arrow record batch: {error}"))?;
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = FileWriter::try_new(&mut output, &schema)
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

struct CsvTable {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

fn parse_csv(bytes: &[u8]) -> Result<CsvTable, String> {
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
                .map_err(|error| format!("invalid INT32 value for {column}: {value}: {error}"))
        })
        .transpose()
}

fn parse_f64(value: Option<&str>, column: &str) -> Result<Option<f64>, String> {
    value
        .map(|value| {
            value
                .parse::<f64>()
                .map_err(|error| format!("invalid DOUBLE value for {column}: {value}: {error}"))
        })
        .transpose()
}

fn parse_bool(value: Option<&str>, column: &str) -> Result<Option<bool>, String> {
    value
        .map(|value| match value {
            "true" | "1" => Ok(true),
            "false" | "0" => Ok(false),
            _ => Err(format!("invalid BOOLEAN value for {column}: {value}")),
        })
        .transpose()
}

pub fn parquet_from_csv(csv_bytes: &[u8], screen: bool) -> Result<Vec<u8>, String> {
    let table = parse_csv(csv_bytes)?;
    let mut fields = Vec::with_capacity(table.headers.len());
    let mut arrays = Vec::<ArrayRef>::with_capacity(table.headers.len());
    for (index, name) in table.headers.iter().enumerate() {
        let kind = column_kind(name, screen);
        let (data_type, array): (DataType, ArrayRef) = match kind {
            ColumnKind::String => (
                DataType::Utf8,
                Arc::new(StringArray::from_iter(table.rows.iter().map(|row| {
                    Some(row.get(index).map(String::as_str).unwrap_or(""))
                }))),
            ),
            ColumnKind::Int32 => {
                let values = table
                    .rows
                    .iter()
                    .map(|row| parse_i32(optional(row, index), name))
                    .collect::<Result<Vec<_>, _>>()?;
                (DataType::Int32, Arc::new(Int32Array::from(values)))
            }
            ColumnKind::Double => {
                let values = table
                    .rows
                    .iter()
                    .map(|row| parse_f64(optional(row, index), name))
                    .collect::<Result<Vec<_>, _>>()?;
                (DataType::Float64, Arc::new(Float64Array::from(values)))
            }
            ColumnKind::Boolean => {
                let values = table
                    .rows
                    .iter()
                    .map(|row| parse_bool(optional(row, index), name))
                    .collect::<Result<Vec<_>, _>>()?;
                (DataType::Boolean, Arc::new(BooleanArray::from(values)))
            }
        };
        fields.push(Field::new(name, data_type, true));
        arrays.push(array);
    }
    let schema = Arc::new(Schema::new(fields));
    let batch = RecordBatch::try_new(schema.clone(), arrays)
        .map_err(|error| format!("build Arrow record batch: {error}"))?;
    let properties = WriterProperties::builder()
        .set_created_by("chronicle-preprocessing-runtime/0.1.0".into())
        .build();
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ArrowWriter::try_new(&mut output, schema, Some(properties))
            .map_err(|error| format!("create Parquet writer: {error}"))?;
        writer
            .write(&batch)
            .map_err(|error| format!("write Parquet record batch: {error}"))?;
        writer
            .close()
            .map_err(|error| format!("close Parquet writer: {error}"))?;
    }
    Ok(output.into_inner())
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

pub fn sav_from_csv(csv_bytes: &[u8], screen: bool) -> Result<Vec<u8>, String> {
    let table = parse_csv(csv_bytes)?;
    let variables = sav_variables(&table, screen);
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

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::{Array, DictionaryArray, FixedSizeBinaryArray};
    use arrow_ipc::reader::FileReader;

    #[test]
    fn parquet_and_sav_exports_are_nonempty_and_deterministic() {
        let csv = b"participant_id,duration_minutes,day,screen_usage_lock_screen_only\nP01,1.5,2,true\nP02,,3,\n";
        let parquet = parquet_from_csv(csv, true).unwrap();
        assert!(parquet.starts_with(b"PAR1"));
        assert!(parquet.ends_with(b"PAR1"));
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
    fn lineage_is_a_normalized_deterministic_arrow_edge_table() {
        let lineages = vec![PipelineRowLineage {
            output_kind: "app-csv",
            output_row_index: 0,
            source_data_rows: vec![1, 3],
            terminal_logical_node: "outputs",
        }];
        let digest = format!("sha256:{}", "a".repeat(64));
        let first = row_lineage_arrow(&lineages, &digest).unwrap();
        let second = row_lineage_arrow(&lineages, &digest).unwrap();
        assert_eq!(first, second);
        let mut reader = FileReader::try_new(Cursor::new(first), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        assert_eq!(batch.num_rows(), 2);
        assert_eq!(batch.schema().field(2).name(), "source_data_row_number");
        let source_rows = batch
            .column(2)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        assert_eq!((source_rows.value(0), source_rows.value(1)), (1, 3));
        assert!(reader.next().is_none());
    }

    #[test]
    fn source_coordinates_are_exact_stable_endpoints_without_claiming_contribution() {
        let raw_digest = format!("sha256:{}", "a".repeat(64));
        let options_digest = format!("sha256:{}", "b".repeat(64));
        let raw =
            b"participant_id,event_timestamp\nP01,2026-01-01 00:00:00\nP02,2026-01-01 00:01:00\n";
        let options = br#"{"mode":"selected","values":[]}"#;
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
        assert_eq!((row_count, second_count), (8, 8));

        let mut reader = FileReader::try_new(Cursor::new(first.clone()), None).unwrap();
        let batch = reader.next().unwrap().unwrap();
        assert_eq!(batch.num_rows(), 8);
        assert_eq!(
            batch.schema().metadata()["protocolVersion"],
            SOURCE_COORDINATE_PROTOCOL
        );
        assert!(batch.schema().metadata()["claimBoundary"]
            .contains("output contribution is not implied"));
        assert_eq!(batch.schema().field(6).name(), "source_record_index");
        assert_eq!(batch.schema().field(8).name(), "value_sha256");
        assert_eq!(batch.schema().field(9).name(), "coordinate_sha256");
        let coordinate_ids = batch
            .column(9)
            .as_any()
            .downcast_ref::<FixedSizeBinaryArray>()
            .unwrap();
        let distinct_ids = (0..coordinate_ids.len())
            .map(|index| coordinate_ids.value(index).to_vec())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(distinct_ids.len(), batch.num_rows());
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
    fn result_cells_are_exact_addressed_deterministic_and_joinable() {
        let app_csv = b"study_name,duration_seconds\nStudy,1.5\n";
        let review_json = br#"{"participants":[],"count":1}"#;
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
            output_kind: "app-csv",
            output_row_index: 0,
            source_data_rows: vec![1, 3],
            terminal_logical_node: "outputs",
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
        assert_eq!(batch.schema().field(4).name(), "cell_value_sha256");
        assert_eq!(batch.schema().field(7).name(), "row_lineage_row_index");
        assert_eq!(batch.schema().field(10).name(), "dependency_spec_sha256");

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
