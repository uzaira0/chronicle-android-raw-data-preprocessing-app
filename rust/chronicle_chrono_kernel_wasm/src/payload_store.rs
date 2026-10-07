//! Immutable payload handles with independently budgeted residency.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::any::Any;
use std::collections::{BTreeMap, HashMap};
use std::ops::Deref;
use std::sync::{Arc, Mutex, Weak};

pub trait SpillBackend: Send + Sync {
    fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String>;
    fn get(&self, id: u64) -> Result<Vec<u8>, String>;
    fn remove(&self, id: u64);
}

#[derive(Default)]
pub struct MemorySpillBackend(Mutex<BTreeMap<u64, Vec<u8>>>);
impl SpillBackend for MemorySpillBackend {
    fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
        self.0.lock().unwrap().insert(id, bytes.to_vec());
        Ok(())
    }
    fn get(&self, id: u64) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("missing payload {id}"))
    }
    fn remove(&self, id: u64) {
        self.0.lock().unwrap().remove(&id);
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct FileSpillBackend {
    directory: Mutex<Option<std::path::PathBuf>>,
}
#[cfg(not(target_arch = "wasm32"))]
impl FileSpillBackend {
    fn directory(&self) -> Result<std::path::PathBuf, String> {
        let mut directory = self.directory.lock().unwrap();
        if let Some(path) = directory.as_ref() {
            return Ok(path.clone());
        }
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        loop {
            let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("chronicle-payload-{}-{id}", std::process::id()));
            let mut builder = std::fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&path) {
                Ok(()) => {
                    *directory = Some(path.clone());
                    return Ok(path);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("create payload spill directory: {error}")),
            }
        }
    }
}
#[cfg(not(target_arch = "wasm32"))]
impl SpillBackend for FileSpillBackend {
    fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
        std::fs::write(self.directory()?.join(id.to_string()), bytes)
            .map_err(|error| format!("spill payload {id}: {error}"))
    }
    fn get(&self, id: u64) -> Result<Vec<u8>, String> {
        std::fs::read(self.directory()?.join(id.to_string()))
            .map_err(|error| format!("reload payload {id}: {error}"))
    }
    fn remove(&self, id: u64) {
        if let Some(directory) = self.directory.lock().unwrap().as_ref() {
            let _ = std::fs::remove_file(directory.join(id.to_string()));
        }
    }
}
#[cfg(not(target_arch = "wasm32"))]
impl Drop for FileSpillBackend {
    fn drop(&mut self) {
        if let Some(directory) = self.directory.get_mut().unwrap().as_ref() {
            let _ = std::fs::remove_dir_all(directory);
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PayloadStats {
    pub resident_bytes: u64,
    pub spilled_count: u64,
    pub reload_count: u64,
    /// Publishes that reused an existing entry for the same allocation.
    pub dedupe_count: u64,
    /// Backend or decode failures on a spill or reload. A tracked query that
    /// saw one has memoized its error; the runtime rebuilds the engine when
    /// this moved during a failed execution.
    pub failure_count: u64,
}

/// Residency of one payload type: what the store holds, what it could still
/// evict, and how often that type has crossed the spill boundary.
#[derive(Clone, Debug)]
pub struct PayloadTypeStats {
    pub type_name: &'static str,
    /// Source location that published these entries.
    pub published_at: &'static std::panic::Location<'static>,
    pub entries: u64,
    pub resident_entries: u64,
    pub resident_bytes: u64,
    /// Resident bytes whose value is also held outside the store, so a pass
    /// cannot evict them.
    pub pinned_bytes: u64,
    /// Strong references beyond the store's own, summed over pinned entries.
    pub pinned_extra_refs: u64,
    pub spilled_count: u64,
    pub reload_count: u64,
}
impl PayloadTypeStats {
    fn new(type_name: &'static str, published_at: &'static std::panic::Location<'static>) -> Self {
        Self {
            type_name,
            published_at,
            entries: 0,
            resident_entries: 0,
            resident_bytes: 0,
            pinned_bytes: 0,
            pinned_extra_refs: 0,
            spilled_count: 0,
            reload_count: 0,
        }
    }
}

fn next_payload_id() -> u64 {
    static NEXT_ID: Mutex<u64> = Mutex::new(0);
    let mut next = NEXT_ID.lock().unwrap();
    let id = *next;
    *next = next.checked_add(1).expect("payload identity exhausted");
    id
}

fn next_payload_touch() -> u64 {
    static NEXT_TOUCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT_TOUCH.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

type Resident = Arc<dyn Any + Send + Sync>;
type EncodePayload = dyn Fn(&Resident) -> Result<Vec<u8>, String> + Send + Sync;
type DecodePayload = dyn Fn(&[u8]) -> Result<Resident, String> + Send + Sync;
struct Entry {
    id: u64,
    type_name: &'static str,
    published_at: &'static std::panic::Location<'static>,
    /// Address of the resident allocation; a reload changes it.
    address: std::sync::atomic::AtomicUsize,
    last_used: std::sync::atomic::AtomicU64,
    bytes: u64,
    row_footprint: Mutex<Option<crate::pipeline_v2::RowTableFootprint>>,
    resident: Mutex<Option<Resident>>,
    encode: Box<EncodePayload>,
    decode: Box<DecodePayload>,
    backend: Arc<dyn SpillBackend>,
    integrity: Mutex<Option<blake3::Hash>>,
    drop_queue: Arc<Mutex<Vec<DroppedResident>>>,
}
impl Drop for Entry {
    fn drop(&mut self) {
        let resident = self.resident.lock().unwrap().take();
        if let Some(resident) = resident {
            let row_footprint = self.row_footprint.lock().unwrap().take();
            // Row allocations stay alive until their addresses leave shared
            // accounting under the store lock; other payloads free here.
            let resident = row_footprint.is_some().then_some(resident);
            self.drop_queue.lock().unwrap().push(DroppedResident {
                bytes: self.bytes,
                row_footprint,
                _resident: resident,
            });
        }
        self.backend.remove(self.id);
    }
}
const PRUNE_FLOOR: usize = 1024;

struct StoreState {
    budget: u64,
    entries: Vec<Weak<Entry>>,
    /// Resident allocation address -> entry, so a value published twice keeps one entry.
    by_address: HashMap<usize, Weak<Entry>>,
    /// Upper bound on resident bytes; exact after every eviction pass.
    resident_bytes: u64,
    /// Resident `RowInner` allocations shared by multiple row-table memos.
    /// This map charges each immutable allocation once instead of once per
    /// table, without weakening the total payload budget.
    shared_rows: HashMap<usize, (u32, u64)>,
    drop_queue: Arc<Mutex<Vec<DroppedResident>>>,
    /// Resident bytes after a pass that found nothing more to evict. Until
    /// residency grows past it or a lease is released, another pass is futile.
    stalled_at: Option<u64>,
    spilled_count: u64,
    reload_count: u64,
    dedupe_count: u64,
    failure_count: u64,
    /// Entry count at which the next pass prunes dead slots regardless of
    /// the budget; doubles after each prune.
    prune_at: usize,
    /// Spill and reload counts per (payload type, publishing call site).
    crossings: HashMap<(&'static str, &'static std::panic::Location<'static>), (u64, u64)>,
    error: Option<String>,
}

struct DroppedResident {
    bytes: u64,
    row_footprint: Option<crate::pipeline_v2::RowTableFootprint>,
    _resident: Option<Resident>,
}

fn drain_dropped_residents(state: &mut StoreState) {
    let dropped = std::mem::take(&mut *state.drop_queue.lock().unwrap());
    if !dropped.is_empty() {
        // Releasing a pinned entry changes which survivors can be evicted
        // even when the aggregate resident charge only decreases.
        state.stalled_at = None;
    }
    for entry in dropped {
        let released = entry.row_footprint.as_ref()
            .map(|footprint| remove_row_footprint(state, footprint))
            .unwrap_or(entry.bytes);
        state.resident_bytes = state.resident_bytes.saturating_sub(released);
    }
}

// Account the hash-table bucket and node overhead in addition to the row
// allocation. The exact allocator capacity varies; 64 bytes per live key is
// a conservative charge for this small bookkeeping structure.
const SHARED_ROW_MAP_BYTES: u64 = 64;

fn add_row_footprint(state: &mut StoreState, footprint: &crate::pipeline_v2::RowTableFootprint) -> u64 {
    let mut charged = footprint.table_bytes;
    for &(address, bytes) in &footprint.rows {
        if let Some((references, previous_bytes)) = state.shared_rows.get_mut(&address) {
            debug_assert_eq!(*previous_bytes, bytes);
            *references = references.checked_add(1).expect("shared row count overflow");
        } else {
            state.shared_rows.insert(address, (1, bytes));
            charged += bytes + SHARED_ROW_MAP_BYTES;
        }
    }
    charged
}

fn remove_row_footprint(state: &mut StoreState, footprint: &crate::pipeline_v2::RowTableFootprint) -> u64 {
    let mut released = footprint.table_bytes;
    for &(address, bytes) in &footprint.rows {
        let (references, previous_bytes) = state.shared_rows.get_mut(&address)
            .expect("resident row absent from shared accounting");
        debug_assert_eq!(*previous_bytes, bytes);
        *references -= 1;
        if *references == 0 {
            state.shared_rows.remove(&address);
            released += bytes + SHARED_ROW_MAP_BYTES;
        }
    }
    if state.shared_rows.capacity() > 1024
        && state.shared_rows.capacity() > state.shared_rows.len().saturating_mul(2)
    {
        state.shared_rows.shrink_to_fit();
    }
    released
}
#[derive(Clone)]
pub struct PayloadStore {
    state: Arc<Mutex<StoreState>>,
    backend: Arc<dyn SpillBackend>,
}
impl PayloadStore {
    pub fn same_store(&self, other: &Self) -> bool { Arc::ptr_eq(&self.state, &other.state) }

    pub fn new(budget_bytes: u64, backend: Arc<dyn SpillBackend>) -> Self {
        let drop_queue = Arc::new(Mutex::new(Vec::new()));
        Self {
            state: Arc::new(Mutex::new(StoreState {
                budget: budget_bytes,
                entries: Vec::new(),
                by_address: HashMap::new(),
                resident_bytes: 0,
                shared_rows: HashMap::new(),
                drop_queue,
                stalled_at: None,
                spilled_count: 0,
                reload_count: 0,
                dedupe_count: 0,
                failure_count: 0,
                prune_at: PRUNE_FLOOR,
                crossings: HashMap::new(),
                error: None,
            })),
            backend,
        }
    }
    pub fn set_budget_bytes(&self, bytes: u64) -> Result<(), String> {
        {
            let mut state = self.state.lock().unwrap();
            state.budget = bytes;
            state.stalled_at = None;
        }
        self.trim(false)
    }
    /// `resident_bytes` is a logical heap charge supplied by the producer.
    /// Cloned handles share one charge; row tables additionally share charges
    /// for identical immutable row allocations. Active leases remain charged
    /// even when they exceed the budget.
    #[track_caller]
    pub fn publish<T: Serialize + DeserializeOwned + Send + Sync + 'static>(
        &self,
        value: Arc<T>,
        resident_bytes: u64,
    ) -> PayloadHandle<T> {
        self.publish_with_codec(
            value,
            resident_bytes,
            |value| postcard::to_allocvec(value).map_err(|error| error.to_string()),
            |bytes| {
                let mut value = postcard::from_bytes(bytes).map_err(|error| error.to_string())?;
                crate::pipeline_v2::compact_deserialized_row_payload(&mut value);
                Ok(value)
            },
        )
    }

    #[track_caller]
    pub fn publish_with_codec<T: Send + Sync + 'static>(
        &self,
        value: Arc<T>,
        resident_bytes: u64,
        encode: fn(&T) -> Result<Vec<u8>, String>,
        decode: fn(&[u8]) -> Result<T, String>,
    ) -> PayloadHandle<T> {
        let address = Arc::as_ptr(&value) as *const u8 as usize;
        let mut state = self.state.lock().unwrap();
        drain_dropped_residents(&mut state);
        // Legacy Arc consumers can publish the same allocation again. Reuse
        // its entry so two store-owned Arcs cannot pin one another forever.
        let existing = state
            .by_address
            .get(&address)
            .and_then(Weak::upgrade)
            .filter(|entry| {
                entry.resident.lock().unwrap().as_ref().is_some_and(|resident| {
                    resident
                        .downcast_ref::<T>()
                        .is_some_and(|existing| std::ptr::eq(existing, &*value))
                })
            });
        if let Some(entry) = existing {
            state.dedupe_count += 1;
            drop(state);
            drop(value);
            let handle = PayloadHandle {
                count: None,
                resident: None,
                stored: Some((self.clone(), entry)),
                marker: std::marker::PhantomData,
            };
            self.trim_on_drop();
            return handle;
        }
        let row_footprint = (&*value as &dyn Any)
            .downcast_ref::<Vec<crate::pipeline_v2::Row>>()
            .map(crate::pipeline_v2::row_table_footprint);
        let charge = row_footprint.as_ref()
            .map(|footprint| add_row_footprint(&mut state, footprint))
            .unwrap_or(resident_bytes);
        let entry = Arc::new(Entry {
            id: next_payload_id(),
            type_name: std::any::type_name::<T>(),
            published_at: std::panic::Location::caller(),
            address: std::sync::atomic::AtomicUsize::new(address),
            last_used: std::sync::atomic::AtomicU64::new(next_payload_touch()),
            bytes: resident_bytes,
            row_footprint: Mutex::new(row_footprint),
            resident: Mutex::new(Some(value)),
            encode: Box::new(move |value| {
                crate::pipeline_v2::with_serialized_row_string_table(|| {
                    encode(value.downcast_ref::<T>().expect("payload type"))
                })
            }),
            decode: Box::new(move |bytes| {
                // Byte chunks can be read by a typed loader while its row
                // interner is active. They contain no rows or string ids.
                let value = if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Vec<u8>>() {
                    decode(bytes)
                } else {
                    crate::pipeline_v2::with_deserialized_row_string_pool(|| decode(bytes))
                };
                value.map(|value| Arc::new(value) as Resident)
            }),
            backend: Arc::clone(&self.backend),
            integrity: Mutex::new(None),
            drop_queue: Arc::clone(&state.drop_queue),
        });
        state.entries.push(Arc::downgrade(&entry));
        state.by_address.insert(address, Arc::downgrade(&entry));
        state.resident_bytes += charge;
        drop(state);
        let handle = PayloadHandle {
            count: None,
            resident: None,
            stored: Some((self.clone(), entry)),
            marker: std::marker::PhantomData,
        };
        self.trim_on_drop();
        handle
    }

    pub fn lease<T: Send + Sync + 'static>(
        &self,
        handle: &PayloadHandle<T>,
    ) -> Result<PayloadLease<T>, String> {
        if let Some((owner, _)) = &handle.stored {
            if !Arc::ptr_eq(&self.state, &owner.state) {
                return Err("payload belongs to another store".into());
            }
        }
        handle.lease()
    }
    /// Enforce the budget after a legacy shared-Arc consumer releases its value.
    pub fn enforce_budget(&self) -> Result<(), String> {
        // A failure recorded by an earlier pass is reported here, but this
        // pass still runs: the failed entry kept its value, and the caller
        // that reads the error must not also inherit a full store. Only this
        // entry point consumes the latch; the counted error stays pending for
        // `lease()` until a caller that returns a `Result` takes it.
        let pending = {
            let mut state = self.state.lock().unwrap();
            state.stalled_at = None;
            state.error.take()
        };
        match (pending, self.trim(false)) {
            (Some(error), Ok(())) => Err(error),
            (_, outcome) => outcome,
        }
    }

    /// Unlimited residency deliberately makes compaction a no-op.
    pub fn evict_unpinned(&self) -> Result<(), String> {
        let result = self.trim(true);
        if let Err(error) = &result {
            let mut state = self.state.lock().unwrap();
            state.failure_count += 1;
            state.error = Some(error.clone());
        }
        result
    }
    pub fn stats(&self) -> PayloadStats {
        let mut state = self.state.lock().unwrap();
        drain_dropped_residents(&mut state);
        PayloadStats {
            resident_bytes: state.resident_bytes,
            spilled_count: state.spilled_count,
            reload_count: state.reload_count,
            dedupe_count: state.dedupe_count,
            failure_count: state.failure_count,
        }
    }
    /// Residency per (type, publishing call site), largest resident footprint first.
    #[cfg(test)]
    fn entry_slots(&self) -> usize {
        self.state.lock().unwrap().entries.len()
    }

    pub fn stats_by_type(&self) -> Vec<PayloadTypeStats> {
        let mut state = self.state.lock().unwrap();
        drain_dropped_residents(&mut state);
        let mut by_type: HashMap<(&'static str, &'static std::panic::Location<'static>), PayloadTypeStats> =
            HashMap::new();
        for entry in state.entries.iter().filter_map(Weak::upgrade) {
            let stats = by_type
                .entry((entry.type_name, entry.published_at))
                .or_insert_with(|| PayloadTypeStats::new(entry.type_name, entry.published_at));
            stats.entries += 1;
            if let Some(value) = entry.resident.lock().unwrap().as_ref() {
                stats.resident_entries += 1;
                stats.resident_bytes += entry.bytes;
                let strong = Arc::strong_count(value);
                if strong != 1 {
                    stats.pinned_bytes += entry.bytes;
                    stats.pinned_extra_refs += strong as u64 - 1;
                }
            }
        }
        for ((type_name, published_at), (spilled, reloaded)) in &state.crossings {
            let stats = by_type
                .entry((type_name, published_at))
                .or_insert_with(|| PayloadTypeStats::new(type_name, published_at));
            stats.spilled_count = *spilled;
            stats.reload_count = *reloaded;
        }
        let mut stats: Vec<_> = by_type.into_values().collect();
        stats.sort_by(|a, b| {
            b.resident_bytes
                .cmp(&a.resident_bytes)
                .then(a.type_name.cmp(b.type_name))
                .then(a.published_at.line().cmp(&b.published_at.line()))
        });
        stats
    }
    fn trim(&self, all: bool) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        // Only this pass's own outcome is reported: a failure latched by an
        // earlier pass is already counted, and re-reporting it here would make
        // every later publish and lease drop count it again.
        self.trim_locked(&mut state, all)
    }

    fn trim_locked(&self, state: &mut StoreState, all: bool) -> Result<(), String> {
        drain_dropped_residents(state);
        // The eviction walk below prunes dead slots, but an unlimited or
        // under-budget store never reaches it, and a worker that keeps its
        // store for many files would hold one weak slot and one address
        // key per payload it ever published. Prune once the table doubles.
        if state.entries.len() >= state.prune_at {
            state.entries.retain(|entry| entry.strong_count() != 0);
            state.by_address.retain(|_, entry| entry.strong_count() != 0);
            state.prune_at = (state.entries.len() * 2).max(PRUNE_FLOOR);
        }
        if state.budget == 0 {
            return Ok(());
        }
        if !all {
            if state.resident_bytes <= state.budget {
                return Ok(());
            }
            if state
                .stalled_at
                .is_some_and(|stalled| state.resident_bytes <= stalled)
            {
                return Ok(());
            }
        }
        // One pass costs a walk over every entry; the bookkeeping above keeps
        // it off the per-publish and per-lease path unless residency grew.
        state.entries.retain(|entry| entry.strong_count() != 0);
        state.by_address.retain(|_, entry| entry.strong_count() != 0);
        let budget = state.budget;
        let mut resident = state.resident_bytes;
        let mut candidates = state.entries.iter().filter_map(Weak::upgrade).collect::<Vec<_>>();
        candidates.sort_unstable_by_key(|entry| {
            entry.last_used.load(std::sync::atomic::Ordering::Relaxed)
        });
        let mut outcome = Ok(());
        // Keep values just produced or read by the active computation. The
        // prior clock hand could evict a newly published row table, forcing
        // the next tracked step to decode it immediately. The store already
        // scans every entry when over budget.
        for entry in candidates {
            if !all && resident <= budget {
                break;
            }
            let mut slot = entry.resident.lock().unwrap();
            let Some(value) = slot.as_ref() else {
                continue;
            };
            if Arc::strong_count(value) != 1 {
                continue;
            }
            // Payloads are immutable: a spill written by an earlier eviction
            // is still valid, so a reloaded entry drops without re-encoding.
            if entry.integrity.lock().unwrap().is_none() {
                let encoded = (entry.encode)(value).and_then(|bytes| {
                    entry.backend.put(entry.id, &bytes)?;
                    Ok(blake3::hash(&bytes))
                });
                match encoded {
                    Ok(hash) => *entry.integrity.lock().unwrap() = Some(hash),
                    Err(error) => {
                        outcome = Err(error);
                        break;
                    }
                }
            }
            let released = entry.row_footprint.lock().unwrap().take()
                .as_ref()
                .map(|footprint| remove_row_footprint(state, footprint))
                .unwrap_or(entry.bytes);
            *slot = None;
            state
                .by_address
                .remove(&entry.address.load(std::sync::atomic::Ordering::Relaxed));
            resident = resident.saturating_sub(released);
            state.spilled_count += 1;
            state
                .crossings
                .entry((entry.type_name, entry.published_at))
                .or_default()
                .0 += 1;
        }
        state.resident_bytes = resident;
        state.stalled_at = (!all && resident > budget).then_some(resident);
        outcome
    }
    fn trim_on_drop(&self) {
        if let Err(error) = self.trim(false) {
            let mut state = self.state.lock().unwrap();
            state.failure_count += 1;
            state.error = Some(error);
        }
    }
}

/// Cloning a handle does not pin its payload or perform storage/Salsa reads.
pub struct PayloadHandle<T> {
    count: Option<usize>,
    resident: Option<Arc<T>>,
    stored: Option<(PayloadStore, Arc<Entry>)>,
    marker: std::marker::PhantomData<T>,
}
impl<T> std::fmt::Debug for PayloadHandle<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PayloadHandle")
            .field("count", &self.count)
            .finish_non_exhaustive()
    }
}

impl<T: PartialEq + Send + Sync + 'static> PartialEq<Arc<T>> for PayloadHandle<T> {
    fn eq(&self, other: &Arc<T>) -> bool {
        self.lease().is_ok_and(|lease| *lease == **other)
    }
}

impl<T> Clone for PayloadHandle<T> {
    fn clone(&self) -> Self {
        Self {
            count: self.count,
            resident: self.resident.clone(),
            stored: self.stored.clone(),
            marker: std::marker::PhantomData,
        }
    }
}
impl<T> PayloadHandle<T> {
    /// Both handles name one payload allocation.
    pub fn same_payload(&self, other: &Self) -> bool {
        match (&self.stored, &other.stored, &self.resident, &other.resident) {
            (Some((_, a)), Some((_, b)), _, _) => Arc::ptr_eq(a, b),
            (None, None, Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        }
    }
    /// Make this payload the first to spill: it is read once per request, so
    /// it should not push out the row tables the next computation reads.
    pub fn mark_cold(&self) {
        if let Some((_, entry)) = &self.stored {
            entry.last_used.store(0, std::sync::atomic::Ordering::Relaxed);
        }
    }

    pub fn is_resident(&self) -> bool {
        self.resident.is_some()
            || self
                .stored
                .as_ref()
                .is_some_and(|(_, entry)| entry.resident.lock().unwrap().is_some())
    }

    pub(crate) fn with_len(mut self, count: usize) -> Self {
        self.count = Some(count);
        self
    }
    pub fn resident(value: Arc<T>) -> Self {
        Self {
            count: None,
            resident: Some(value),
            stored: None,
            marker: std::marker::PhantomData,
        }
    }
    pub(crate) fn cast<U>(self) -> PayloadHandle<U> {
        assert!(self.resident.is_none());
        PayloadHandle {
            count: self.count,
            resident: None,
            stored: self.stored,
            marker: std::marker::PhantomData,
        }
    }
}
impl<T> PayloadHandle<Vec<T>> {
    pub fn len(&self) -> usize {
        self.count
            .unwrap_or_else(|| self.resident.as_ref().expect("vector count").len())
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
impl<T: Send + Sync + 'static> PayloadHandle<T> {
    /// Inspect a resident value without bringing a spilled payload back into
    /// memory. Callers may use this for an optional fast path, but must still
    /// compute from their own input when it returns None.
    pub(crate) fn lease_if_resident(&self) -> Result<Option<PayloadLease<T>>, String> {
        if let Some(value) = &self.resident {
            return Ok(Some(PayloadLease {
                entry: None,
                value: Some(Arc::clone(value)),
                store: None,
            }));
        }
        let Some((store, entry)) = self.stored.as_ref() else {
            return Ok(None);
        };
        if let Some(error) = store.state.lock().unwrap().error.take() {
            return Err(error);
        }
        let value = entry.resident.lock().unwrap().as_ref().cloned();
        let Some(value) = value else {
            return Ok(None);
        };
        let value = value.downcast::<T>().map_err(|_| "payload type mismatch".to_string())?;
        entry.last_used.store(next_payload_touch(), std::sync::atomic::Ordering::Relaxed);
        Ok(Some(PayloadLease {
            entry: Some(Arc::clone(entry)),
            value: Some(value),
            store: Some(store.clone()),
        }))
    }

    pub fn lease(&self) -> Result<PayloadLease<T>, String> {
        if let Some(value) = &self.resident {
            return Ok(PayloadLease {
                entry: None,
                value: Some(Arc::clone(value)),
                store: None,
            });
        }
        let (store, entry) = self.stored.as_ref().expect("payload backing");
        if let Some(error) = store.state.lock().unwrap().error.take() {
            return Err(error);
        }
        let existing = entry.resident.lock().unwrap().clone();
        let resident = if let Some(value) = existing {
            value
        } else {
            let reloaded = entry.backend.get(entry.id).and_then(|bytes| {
                if Some(blake3::hash(&bytes)) != *entry.integrity.lock().unwrap() {
                    return Err(format!("payload {} integrity mismatch", entry.id));
                }
                (entry.decode)(&bytes)
            });
            let value = match reloaded {
                Ok(value) => value,
                Err(error) => {
                    store.state.lock().unwrap().failure_count += 1;
                    return Err(error);
                }
            };
            let mut state = store.state.lock().unwrap();
            drain_dropped_residents(&mut state);
            let mut slot = entry.resident.lock().unwrap();
            if let Some(value) = slot.as_ref() {
                // Populated meanwhile by another lease of the same entry.
                Arc::clone(value)
            } else {
                *slot = Some(Arc::clone(&value));
                // The reloaded allocation has a new address; a later publish
                // of this same Arc must still find this entry, or two entries
                // end up holding one allocation and pin each other forever.
                let address = Arc::as_ptr(&value) as *const u8 as usize;
                let previous = entry
                    .address
                    .swap(address, std::sync::atomic::Ordering::Relaxed);
                // The old address may since have been handed to another
                // entry's allocation (the eviction freed it); only this
                // entry's own stale mapping goes.
                if state
                    .by_address
                    .get(&previous)
                    .is_some_and(|mapped| mapped.as_ptr() == Arc::as_ptr(entry))
                {
                    state.by_address.remove(&previous);
                }
                state.by_address.insert(address, Arc::downgrade(entry));
                let row_footprint = value.downcast_ref::<Vec<crate::pipeline_v2::Row>>()
                    .map(crate::pipeline_v2::row_table_footprint);
                let charge = row_footprint.as_ref()
                    .map(|footprint| add_row_footprint(&mut state, footprint))
                    .unwrap_or(entry.bytes);
                *entry.row_footprint.lock().unwrap() = row_footprint;
                state.resident_bytes += charge;
                state.reload_count += 1;
                state
                    .crossings
                    .entry((entry.type_name, entry.published_at))
                    .or_default()
                    .1 += 1;
                value
            }
        };
        let value = resident
            .downcast::<T>()
            .map_err(|_| "payload type mismatch".to_string())?;
        entry.last_used.store(next_payload_touch(), std::sync::atomic::Ordering::Relaxed);
        Ok(PayloadLease {
            entry: Some(Arc::clone(entry)),
            value: Some(value),
            store: Some(store.clone()),
        })
    }
}
impl<T: Serialize + Send + Sync + 'static> Serialize for PayloadHandle<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.lease()
            .map_err(serde::ser::Error::custom)?
            .serialize(serializer)
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for PayloadHandle<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(|value| Self::resident(Arc::new(value)))
    }
}
/// The shared Arc also protects values temporarily passed to legacy Arc consumers.
pub struct PayloadLease<T> {
    entry: Option<Arc<Entry>>,
    value: Option<Arc<T>>,
    store: Option<PayloadStore>,
}
impl<T> PayloadLease<T> {
    pub fn shared(&self) -> Arc<T> {
        Arc::clone(self.value.as_ref().unwrap())
    }
}
impl<T> Deref for PayloadLease<T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.value.as_ref().unwrap()
    }
}
impl<T> Drop for PayloadLease<T> {
    fn drop(&mut self) {
        self.value.take();
        self.entry.take();
        if let Some(store) = &self.store {
            store.state.lock().unwrap().stalled_at = None;
            store.trim_on_drop();
        }
    }
}

/// Artifact bytes are kept in independently leased chunks. A memo owns only
/// this receipt; publishing never needs a complete artifact-sized buffer.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PayloadBytes {
    chunks: Vec<PayloadHandle<Vec<u8>>>,
    len: usize,
}

impl PartialEq<[u8]> for PayloadBytes {
    fn eq(&self, other: &[u8]) -> bool {
        if self.len != other.len() {
            return false;
        }
        let mut offset = 0;
        let mut equal = true;
        self.for_each_chunk(|bytes| {
            equal &= bytes == &other[offset..offset + bytes.len()];
            offset += bytes.len();
        })
        .is_ok()
            && equal
    }
}
impl PartialEq<Vec<u8>> for PayloadBytes {
    fn eq(&self, other: &Vec<u8>) -> bool {
        self == other.as_slice()
    }
}
impl PartialEq<Arc<Vec<u8>>> for PayloadBytes {
    fn eq(&self, other: &Arc<Vec<u8>>) -> bool {
        self == other.as_slice()
    }
}
impl PartialEq for PayloadBytes {
    fn eq(&self, other: &Self) -> bool {
        self.len == other.len && other.materialize().is_ok_and(|other| *self == *other)
    }
}
impl Eq for PayloadBytes {}

impl PayloadBytes {
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn resident_bytes(&self) -> usize {
        self.chunks
            .iter()
            .filter(|chunk| chunk.is_resident())
            .map(PayloadHandle::len)
            .sum()
    }

    #[track_caller]
    pub fn from_vec(bytes: Vec<u8>) -> Self {
        Self::from_vec_with_store(bytes, &current_store())
    }

    #[track_caller]
    pub fn from_vec_with_store(bytes: Vec<u8>, store: &PayloadStore) -> Self {
        if bytes.is_empty() {
            return Self::default();
        }
        let len = bytes.len();
        Self {
            chunks: vec![store
                .publish(Arc::new(bytes), len as u64)
                .with_len(len)],
            len,
        }
    }

    pub fn for_each_chunk(&self, mut visit: impl FnMut(&[u8])) -> Result<(), String> {
        for chunk in &self.chunks {
            let lease = chunk.lease()?;
            visit(&lease);
        }
        Ok(())
    }

    /// Contiguous copy for consumers that need a slice; streaming readers
    /// should use [`Self::reader`] or [`Self::for_each_chunk`] instead.
    /// Panics if a chunk cannot be reloaded: a short copy would be a wrong
    /// value, and the fallible readers exist for callers that can report it.
    pub fn to_vec(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.len);
        self.for_each_chunk(|chunk| bytes.extend_from_slice(chunk))
            .expect("payload chunk readable");
        bytes
    }

    /// Reads the chunks in order, leasing one at a time.
    pub fn reader(&self) -> PayloadBytesReader<'_> {
        PayloadBytesReader {
            chunks: self.chunks.iter(),
            current: None,
            offset: 0,
        }
    }

    /// Owned contiguous bytes. A single chunk nobody else holds is moved
    /// out without a copy; anything else is concatenated once.
    pub fn into_vec(self) -> Result<Vec<u8>, String> {
        if self.chunks.len() != 1 {
            return self.materialize().map(Arc::unwrap_or_clone);
        }
        let bytes = self.chunks[0].lease()?.shared();
        // Dropping the last handle releases the store's own reference.
        drop(self);
        Ok(Arc::unwrap_or_clone(bytes))
    }

    pub fn materialize(&self) -> Result<Arc<Vec<u8>>, String> {
        if self.chunks.len() == 1 {
            return Ok(self.chunks[0].lease()?.shared());
        }
        let mut bytes = Vec::with_capacity(self.len);
        self.for_each_chunk(|chunk| bytes.extend_from_slice(chunk))?;
        Ok(Arc::new(bytes))
    }
}

pub struct PayloadBytesReader<'a> {
    chunks: std::slice::Iter<'a, PayloadHandle<Vec<u8>>>,
    current: Option<PayloadLease<Vec<u8>>>,
    offset: usize,
}

impl std::io::Read for PayloadBytesReader<'_> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            if let Some(bytes) = &self.current {
                let count = output.len().min(bytes.len() - self.offset);
                if count != 0 {
                    output[..count].copy_from_slice(&bytes[self.offset..self.offset + count]);
                    self.offset += count;
                    return Ok(count);
                }
            }
            self.current.take();
            let Some(chunk) = self.chunks.next() else {
                return Ok(0);
            };
            self.current = Some(chunk.lease().map_err(std::io::Error::other)?);
            self.offset = 0;
        }
    }
}

pub struct PayloadByteWriter {
    store: PayloadStore,
    output: PayloadBytes,
    buffer: Vec<u8>,
}

impl Default for PayloadByteWriter {
    fn default() -> Self { Self::with_store(current_store()) }
}

impl PayloadByteWriter {
    pub fn with_store(store: PayloadStore) -> Self {
        Self { store, output: PayloadBytes::default(), buffer: Vec::new() }
    }

    // The browser's 512 MiB store spills cold Salsa outputs. At 100k rows,
    // 64 KiB chunks caused thousands of OPFS crossings for one output pass.
    // Larger chunks keep the same bytes while amortizing each bridge call.
    const CHUNK_BYTES: usize = 1024 * 1024;

    fn publish_buffer(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let buffer = std::mem::take(&mut self.buffer);
        let len = buffer.len();
        self.output.chunks.push(
            self.store
                .publish(Arc::new(buffer), len as u64)
                .with_len(len),
        );
    }

    pub fn finish(mut self) -> PayloadBytes {
        self.publish_buffer();
        self.output
    }
}

impl std::io::Write for PayloadByteWriter {
    fn write(&mut self, mut bytes: &[u8]) -> std::io::Result<usize> {
        let len = bytes.len();
        self.output.len += len;
        while !bytes.is_empty() {
            let take = bytes.len().min(Self::CHUNK_BYTES - self.buffer.len());
            self.buffer.extend_from_slice(&bytes[..take]);
            bytes = &bytes[take..];
            if self.buffer.len() == Self::CHUNK_BYTES {
                self.publish_buffer();
            }
        }
        Ok(len)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

thread_local! {
    static CURRENT: std::cell::RefCell<PayloadStore> = std::cell::RefCell::new({
        #[cfg(not(target_arch = "wasm32"))]
        let backend = Arc::new(FileSpillBackend::default());
        #[cfg(target_arch = "wasm32")]
        let backend = Arc::new(MemorySpillBackend::default());
        PayloadStore::new(0, backend)
    });
}
pub fn current_store() -> PayloadStore {
    CURRENT.with(|store| store.borrow().clone())
}
/// Configure before constructing an engine; existing handles keep their original store.
pub fn replace_current_store(store: PayloadStore) -> PayloadStore {
    CURRENT.with(|current| current.replace(store))
}
pub fn set_payload_budget_bytes(bytes: u64) -> Result<(), String> {
    current_store().set_budget_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_pinned_resident_does_not_stall_the_next_eviction() {
        let store = PayloadStore::new(100, Arc::new(MemorySpillBackend::default()));
        let external = Arc::new(vec![1_u8]);
        let pinned = store.publish(Arc::clone(&external), 200);
        assert_eq!(store.state.lock().unwrap().stalled_at, Some(200));
        drop(external);
        drop(pinned);

        let next = store.publish(Arc::new(vec![2_u8]), 150);
        assert!(!next.is_resident());
        assert_eq!(store.stats().resident_bytes, 0);
    }

    #[test]
    fn dropped_non_row_payload_is_freed_before_the_drain() {
        let store = PayloadStore::new(0, Arc::new(MemorySpillBackend::default()));
        let value = Arc::new(vec![1_u8]);
        let weak = Arc::downgrade(&value);
        let handle = store.publish(value, 150);
        drop(handle);

        assert!(weak.upgrade().is_none(), "no shared accounting holds a byte payload");
        assert_eq!(store.stats().resident_bytes, 0);
    }

    #[test]
    fn budget_keeps_the_recently_read_payload_for_its_next_consumer() {
        let store = PayloadStore::new(128, Arc::new(MemorySpillBackend::default()));
        let first = store.publish(Arc::new(vec![1_u32]), 64);
        let second = store.publish(Arc::new(vec![2_u32]), 64);
        drop(first.lease().unwrap());
        let third = store.publish(Arc::new(vec![3_u32]), 64);
        assert!(first.is_resident());
        assert!(!second.is_resident());
        assert!(third.is_resident());
    }

    #[test]
    fn a_cold_payload_spills_before_older_ones() {
        let store = PayloadStore::new(100, Arc::new(MemorySpillBackend::default()));
        let older = store.publish(Arc::new(vec![1_u8]), 60);
        let cold = store.publish(Arc::new(vec![2_u8]), 30);
        cold.mark_cold();
        let newest = store.publish(Arc::new(vec![3_u8]), 30);
        assert!(!cold.is_resident());
        assert!(older.is_resident());
        assert!(newest.is_resident());
    }

    #[test]
    fn republishing_a_reloaded_allocation_reuses_its_entry() {
        let store = PayloadStore::new(1, Arc::new(MemorySpillBackend::default()));
        let handle = store.publish(Arc::new(vec![1_u32, 2, 3]), 64);
        assert_eq!(store.stats().spilled_count, 1, "a 1-byte budget evicts at once");
        let reloaded = handle.lease().unwrap().shared();
        assert_eq!(store.stats().reload_count, 1);
        let again = store.publish(Arc::clone(&reloaded), 64);
        assert!(again.same_payload(&handle), "the reloaded allocation maps to its entry");
        assert_eq!(store.stats().dedupe_count, 1);
        drop(reloaded);
        drop(again);
        store.enforce_budget().unwrap();
        assert_eq!(store.stats().resident_bytes, 0, "one entry, evictable again");
        let by_type = store.stats_by_type();
        assert_eq!(by_type.len(), 1);
        assert_eq!(by_type[0].entries, 1);
    }

    /// A backend that fails one reload on request, then serves normally.
    #[derive(Default)]
    struct FlakyBackend {
        inner: MemorySpillBackend,
        fail_next_get: std::sync::atomic::AtomicBool,
        fail_next_put: std::sync::atomic::AtomicBool,
    }

    impl SpillBackend for FlakyBackend {
        fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
            if self
                .fail_next_put
                .swap(false, std::sync::atomic::Ordering::Relaxed)
            {
                return Err("storage unavailable".into());
            }
            self.inner.put(id, bytes)
        }
        fn get(&self, id: u64) -> Result<Vec<u8>, String> {
            if self
                .fail_next_get
                .swap(false, std::sync::atomic::Ordering::Relaxed)
            {
                return Err("storage unavailable".into());
            }
            self.inner.get(id)
        }
        fn remove(&self, id: u64) {
            self.inner.remove(id)
        }
    }

    #[test]
    fn a_failed_reload_is_counted_and_the_next_lease_reloads() {
        let backend = Arc::new(FlakyBackend::default());
        let store = PayloadStore::new(1, backend.clone());
        let handle = store.publish(Arc::new(vec![7_u32, 8, 9]), 64);
        assert_eq!(store.stats().spilled_count, 1);
        backend
            .fail_next_get
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let error = handle.lease().err().expect("the failed reload surfaces");
        assert!(error.contains("storage unavailable"), "{error}");
        assert_eq!(store.stats().failure_count, 1);
        assert_eq!(store.stats().reload_count, 0);
        assert_eq!(*handle.lease().unwrap().shared(), vec![7_u32, 8, 9]);
        assert_eq!(store.stats().failure_count, 1, "a successful reload adds nothing");
        assert_eq!(store.stats().reload_count, 1);
    }

    /// A backend that serves one reload out of a neighbouring payload's
    /// region, the way first-fit region reuse in the browser bridge can.
    #[derive(Default)]
    struct RegionConfusedBackend {
        inner: MemorySpillBackend,
        other_region: Mutex<Option<Vec<u8>>>,
    }

    impl SpillBackend for RegionConfusedBackend {
        fn put(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
            self.inner.put(id, bytes)
        }
        fn get(&self, id: u64) -> Result<Vec<u8>, String> {
            if let Some(bytes) = self.other_region.lock().unwrap().take() {
                return Ok(bytes);
            }
            self.inner.get(id)
        }
        fn remove(&self, id: u64) {
            self.inner.remove(id)
        }
    }

    #[test]
    fn a_corrupted_reload_is_rejected_and_counted() {
        let backend = Arc::new(RegionConfusedBackend::default());
        let store = PayloadStore::new(1, backend.clone());
        let first = store.publish(Arc::new(vec![1_u32, 2, 3]), 64);
        let second = store.publish(Arc::new(vec![4_u32, 5, 6]), 64);
        assert_eq!(store.stats().spilled_count, 2, "a 1-byte budget evicts both");
        // The neighbouring region decodes cleanly, so only the recorded hash
        // separates it from this payload's own bytes.
        *backend.other_region.lock().unwrap() =
            Some(postcard::to_allocvec(&vec![1_u32, 2, 3]).unwrap());
        let error = second.lease().err().expect("the wrong region is rejected");
        assert!(error.contains("integrity mismatch"), "{error}");
        assert_eq!(store.stats().failure_count, 1);
        assert_eq!(store.stats().reload_count, 0);
        // The entry keeps its own region: the next lease reloads normally.
        assert_eq!(*second.lease().unwrap().shared(), vec![4_u32, 5, 6]);
        assert_eq!(store.stats().failure_count, 1, "a sound reload adds nothing");
        assert_eq!(store.stats().reload_count, 1);
        drop(first);
    }

    #[test]
    fn an_unlimited_store_prunes_dead_entries() {
        let store = PayloadStore::new(0, Arc::new(MemorySpillBackend::default()));
        for round in 0..3 {
            let handles = (0..PRUNE_FLOOR)
                .map(|index| store.publish(Arc::new(vec![index as u32]), 64))
                .collect::<Vec<_>>();
            drop(handles);
            // The next publish runs a pass; the table must not keep one slot
            // per payload the store ever saw.
            let _keep = store.publish(Arc::new(vec![u32::MAX]), 64);
            assert!(
                store.entry_slots() <= PRUNE_FLOOR + 1,
                "round {round}: {} slots for one live entry",
                store.entry_slots()
            );
        }
    }

    #[test]
    fn a_latched_spill_failure_is_counted_once() {
        let backend = Arc::new(FlakyBackend::default());
        let store = PayloadStore::new(1, backend.clone());
        backend
            .fail_next_put
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let first = store.publish(Arc::new(vec![1_u32]), 64);
        assert_eq!(store.stats().failure_count, 1, "the failed spill is counted");
        // Storage recovers: later trims must not re-count the latched error.
        let second = store.publish(Arc::new(vec![2_u32]), 64);
        let third = store.publish(Arc::new(vec![3_u32]), 64);
        assert_eq!(store.stats().failure_count, 1, "one failure, counted once");
        // The latch is still live for the next lease of a stored payload.
        let error = second.lease().err().expect("the latched failure surfaces");
        assert!(error.contains("storage unavailable"), "{error}");
        assert_eq!(store.stats().failure_count, 1, "reporting the latch adds nothing");
        drop(first);
        drop(third);
    }
}
