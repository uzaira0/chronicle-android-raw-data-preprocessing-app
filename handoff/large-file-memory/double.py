import sys, csv, datetime as dt
src, out, shift_days = sys.argv[1], sys.argv[2], int(sys.argv[3])
shift = dt.timedelta(days=shift_days)
with open(src, newline="") as f:
    rows = list(csv.reader(f))
with open(out, "w", newline="") as o:
    w = csv.writer(o, lineterminator="\n")
    w.writerows(rows)
    for r in rows[1:]:
        r[7] = (dt.datetime.strptime(r[7], "%Y-%m-%d %H:%M:%S.%f") + shift).strftime("%Y-%m-%d %H:%M:%S.%f")
        w.writerow(r)
