#!/usr/bin/env python3
import os
import sys
import json
import argparse
import datetime
from pathlib import Path

try:
    import garth
    from garminconnect import Garmin
except ImportError:
    print("Error: garminconnect or garth not installed. Run: pip3 install garminconnect", file=sys.stderr)
    sys.exit(1)

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BASE_DIR / ".env"
TOKEN_DIR = BASE_DIR / ".garmin_tokens"
CACHE_JSON = BASE_DIR / "garmin_scraped_sleep.json"

STAGE_MAP = {
    0.0: "deep",
    1.0: "light",
    2.0: "rem",
    3.0: "awake"
}

def load_env():
    """Load key-value pairs from .env without extra dependencies."""
    env_vars = {}
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("\"'")
    return env_vars

def get_garmin_client(email=None, password=None, interactive=False):
    env_vars = load_env()
    email = email or os.getenv("GARMIN_EMAIL") or env_vars.get("GARMIN_EMAIL")
    password = password or os.getenv("GARMIN_PASSWORD") or env_vars.get("GARMIN_PASSWORD")

    garmin = Garmin()
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Try loading existing saved tokens
    token_files = list(TOKEN_DIR.glob("*.json"))
    if token_files:
        try:
            garmin.login(tokenstore=str(TOKEN_DIR))
            _ = garmin.display_name
            return garmin
        except Exception as e:
            print(f"[GarminSync] Stored token login failed: {e}. Attempting full login...", file=sys.stderr)

    # 2. Perform fresh login using credentials
    if not email or not password:
        if interactive:
            email = input("Garmin Email: ").strip()
            password = input("Garmin Password: ").strip()
        else:
            raise ValueError("GARMIN_EMAIL and GARMIN_PASSWORD not found in .env or environment")

    garmin.garth.login(email, password)
    garmin.garth.dump(str(TOKEN_DIR))
    garmin.login(tokenstore=str(TOKEN_DIR))
    print(f"[GarminSync] Logged in as {garmin.display_name}. Tokens saved to {TOKEN_DIR}", file=sys.stderr)
    return garmin

def fetch_sleep_daily_stats(garmin, start_date, end_date):
    """Fetches high-level stats from sleep-service/stats/sleep/daily."""
    url = f"/sleep-service/stats/sleep/daily/{start_date}/{end_date}"
    return garmin.connectapi(url)

def extract_granular_sleep(garmin, date_str):
    """Fetches granular sleepLevels hypnogram and sleepHeartRate for a single date."""
    try:
        detailed = garmin.get_sleep_data(date_str)
        stages = []
        for lvl in detailed.get("sleepLevels", []):
            stage = STAGE_MAP.get(lvl.get("activityLevel"))
            if stage is None:
                # Unmeasurable / unknown levels must not be counted as light sleep
                continue
            try:
                s_str = lvl["startGMT"]
                e_str = lvl["endGMT"]
                s_dt = datetime.datetime.strptime(s_str, "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=datetime.timezone.utc)
                e_dt = datetime.datetime.strptime(e_str, "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=datetime.timezone.utc)
                stages.append({
                    "stage": stage,
                    "startTime": s_dt.isoformat(),
                    "endTime": e_dt.isoformat(),
                    "durationSecs": int((e_dt - s_dt).total_seconds())
                })
            except Exception as parse_err:
                continue

        hr_samples = []
        for s in detailed.get("sleepHeartRate", []):
            ts = s.get("startGMT")
            val = s.get("value")
            if ts and val is not None:
                hr_samples.append({
                    "timestamp": datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).isoformat(),
                    "bpm": int(val),
                    "context": "sleep"
                })

        return stages, hr_samples
    except Exception as e:
        print(f"[GarminSync] Could not fetch detailed stages for {date_str}: {e}", file=sys.stderr)
        return [], []

def main():
    parser = argparse.ArgumentParser(description="Garmin Connect Sleep Sync via OAuth")
    parser.add_argument("--login", action="store_true", help="Perform interactive login and save tokens")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD), default: 2 days ago")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD), default: today")
    parser.add_argument("--out", type=str, help="Output file path, default: garmin_scraped_sleep.json")
    args = parser.parse_args()

    if args.login:
        client = get_garmin_client(interactive=True)
        print("Login successful! Saved tokens to:", TOKEN_DIR)
        return

    today = datetime.date.today()
    start_date = args.start or (today - datetime.timedelta(days=2)).isoformat()
    end_date = args.end or today.isoformat()
    out_path = Path(args.out) if args.out else CACHE_JSON

    client = get_garmin_client()
    print(f"[GarminSync] Fetching sleep stats from {start_date} to {end_date}...", file=sys.stderr)
    stats = fetch_sleep_daily_stats(client, start_date, end_date)

    # Enrich each individualStats item with granular sleepLevels & sleepHeartRate
    individual = stats.get("individualStats", [])
    for item in individual:
        cal_date = item.get("calendarDate")
        if cal_date:
            stages, hr = extract_granular_sleep(client, cal_date)
            item["sleepStages"] = stages
            item["sleepHeartRate"] = hr
            print(f"[GarminSync] {cal_date}: extracted {len(stages)} granular stages, {len(hr)} HR samples", file=sys.stderr)

    try:
        client.garth.dump(str(TOKEN_DIR))
    except Exception as dump_err:
        print(f"[GarminSync] Warning persisting tokens: {dump_err}", file=sys.stderr)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)

    print(f"[GarminSync] Saved {len(individual)} sleep records with granular stages to {out_path}", file=sys.stderr)
    print(json.dumps({
        "success": True,
        "count": len(individual),
        "range": {"start": start_date, "end": end_date}
    }))

if __name__ == "__main__":
    main()
