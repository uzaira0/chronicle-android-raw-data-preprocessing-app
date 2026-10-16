# Rewrite a synthetic export (UTC "YYYY-MM-DD HH:MM:SS.ffffff") into the layout of a real
# Chronicle download: study_id,participant_id,app_package_name,interaction_type,event_type,
# event_timestamp (local ISO with offset),timezone,username,application_label,uploaded_at
import sys, csv, datetime as dt
from zoneinfo import ZoneInfo
src, out = sys.argv[1], sys.argv[2]
utc, chicago = dt.timezone.utc, ZoneInfo("America/Chicago")
with open(src, newline="") as f, open(out, "w", newline="") as o:
    r = csv.reader(f); h = next(r); i = {k: n for n, k in enumerate(h)}
    w = csv.writer(o, lineterminator="\n")
    w.writerow(["study_id","participant_id","app_package_name","interaction_type","event_type","event_timestamp","timezone","username","application_label","uploaded_at"])
    for c in r:
        t = dt.datetime.strptime(c[i["event_timestamp"]], "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=utc).astimezone(chicago)
        ts = t.isoformat(timespec="milliseconds")
        w.writerow([c[i["study_id"]], c[i["participant_id"]], c[i["app_package_name"]], c[i["interaction_type"]], "", ts, c[i["timezone"]], "", c[i["application_label"]], ""])
