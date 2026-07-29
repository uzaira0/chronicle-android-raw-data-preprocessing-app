use _rust_app_usage_matcher::split_overlapping_sessions;
use std::hint::black_box;
use std::time::Instant;

fn parse_sessions() -> Result<usize, String> {
    let mut sessions = 20_000_usize;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--sessions" => {
                sessions = args
                    .next()
                    .ok_or_else(|| "--sessions requires a value".to_string())?
                    .parse()
                    .map_err(|error| format!("invalid --sessions value: {error}"))?;
                if sessions == 0 {
                    return Err("--sessions must be greater than zero".into());
                }
            }
            "--help" | "-h" => {
                println!("usage: profile_overlap_split [--sessions N]");
                std::process::exit(0);
            }
            _ => return Err(format!("unknown argument {flag:?}")),
        }
    }
    Ok(sessions)
}

fn main() -> Result<(), String> {
    let sessions = parse_sessions()?;
    let starts = (0..sessions)
        .map(|index| i64::try_from(index).expect("session count fits i64"))
        .collect::<Vec<_>>();
    let stop = i64::try_from(sessions.saturating_mul(2)).expect("session count fits i64");
    let stops = vec![stop; sessions];

    let started = Instant::now();
    let output = split_overlapping_sessions(black_box(&starts), black_box(&stops))
        .map_err(|error| error.to_string())?;
    let elapsed = started.elapsed();
    let checksum = output.iter().fold(0_u64, |state, interval| {
        state
            .wrapping_mul(1_099_511_628_211)
            .wrapping_add(interval.session_index as u64)
            .wrapping_add(interval.start_ns as u64)
            .wrapping_add(interval.stop_ns as u64)
    });
    black_box(&output);
    println!(
        "sessions={} intervals={} elapsed_ns={} elapsed_ms={:.3} checksum={checksum}",
        sessions,
        output.len(),
        elapsed.as_nanos(),
        elapsed.as_secs_f64() * 1_000.0,
    );
    Ok(())
}
