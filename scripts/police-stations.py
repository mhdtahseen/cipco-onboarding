#!/usr/bin/env python3
"""Download India's police stations, state by state, from the Passport Seva "Know your police station" page
(https://www.passportindia.gov.in/psp/Police). That page loads its lists from three calls, used here the same way:
  getStateList -> getDistrictList (stateId) -> locatePoliceStation (stateId, districtId)

Output (in OUT_DIR, default ./police-stations):
  <State>.csv   one file per state: state, district, police station, plus any other fields the service returns
  all.csv       everything in one file
Gentle on purpose: one request at a time with a pause between them. Re-running skips states already saved.
Usage: python3 scripts/police-stations.py [OUT_DIR]
"""
import csv, json, os, re, sys, time, urllib.request

API = "https://api1.passportindia.gov.in/v1/master/"
PAUSE = 1.0  # seconds between requests
OUT = sys.argv[1] if len(sys.argv) > 1 else "police-stations"
HEAD = {"Content-Type": "application/json", "Origin": "https://www.passportindia.gov.in", "Referer": "https://www.passportindia.gov.in/psp/Police", "User-Agent": "Mozilla/5.0 (CIPCO police-station list)"}


def call(name, params, tries=3):
    body = json.dumps({"requestResponseMap": params}).encode()
    for n in range(tries):
        try:
            req = urllib.request.Request(API + name, data=body, headers=HEAD, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            time.sleep(PAUSE)
            return data
        except Exception as e:  # network hiccup or a refused request: wait longer, then try again
            print(f"  {name} {params}: {e} (try {n + 1}/{tries})", file=sys.stderr)
            time.sleep(PAUSE * 5 * (n + 1))
    return None


def pick(d, *keys):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return ""


def main():
    os.makedirs(OUT, exist_ok=True)
    states = ((call("getStateList", {}) or {}).get("requestResponseMap") or {}).get("stateList") or []
    if not states:
        sys.exit("No states came back; the service may have changed or refused the request.")
    print(f"{len(states)} states")
    every = []
    for s in sorted(states, key=lambda x: str(pick(x, "STATE_NAME"))):
        sid, sname = str(pick(s, "STATE_ID_PK", "STATE_ID")), str(pick(s, "STATE_NAME")).strip()
        path = os.path.join(OUT, re.sub(r"[^A-Za-z0-9 &()-]+", "_", sname) + ".csv")
        if os.path.exists(path):  # saved on an earlier run
            with open(path, encoding="utf-8") as f:
                every += list(csv.DictReader(f))
            print(f"{sname}: already saved")
            continue
        dists = ((call("getDistrictList", {"stateId": sid}) or {}).get("requestResponseMap") or {}).get("districtList") or []
        rows = []
        for d in dists:
            did, dname = str(pick(d, "DISTRICT_ID_PK", "DISTRICT_ID")), str(pick(d, "DISTRICT_NAME")).strip()
            got = call("locatePoliceStation", {"stateId": sid, "districtId": did}) or {}
            for p in (got.get("requestResponseMap") or {}).get("psList") or []:
                extra = {k: v for k, v in p.items() if not isinstance(v, (dict, list))}
                rows.append({"state": sname, "district": dname, "police_station": str(pick(p, "POLICE_STATION_NAME", "PS_NAME", "NAME")).strip(), **extra})
        keys = ["state", "district", "police_station"] + sorted({k for r in rows for k in r} - {"state", "district", "police_station"})
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
        every += rows
        print(f"{sname}: {len(dists)} districts, {len(rows)} police stations")
    keys = ["state", "district", "police_station"] + sorted({k for r in every for k in r} - {"state", "district", "police_station"})
    with open(os.path.join(OUT, "all.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore"); w.writeheader(); w.writerows(every)
    print(f"Done: {len(every)} police stations in {OUT}/all.csv")


if __name__ == "__main__":
    main()
