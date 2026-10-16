# Append the first N data rows again, shifted forward by D days, until the file reaches the target size.
import sys, csv, datetime as dt
path, target, days = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
with open(path, newline="") as f:
    rows = list(csv.reader(f))[1:]
import os
with open(path, "a", newline="") as o:
    w = csv.writer(o, lineterminator="\n")
    for r in rows:
        if os.fstat(o.fileno()).st_size >= target: break
        r[5] = (dt.datetime.fromisoformat(r[5]) + dt.timedelta(days=days)).isoformat(timespec="milliseconds")
        w.writerow(r); o.flush() if False else None
