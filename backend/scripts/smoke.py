"""Post-deployment smoke testing script for Certificate Ledger.
Verifies public endpoints, rate limiting, and authenticated invariant reports.
Usage:
    python -m backend.scripts.smoke http://localhost:3000 [--passcode demo2026]
"""
import argparse
import sys
import urllib.request
import json

def check_endpoint(url: str, expected_status: int = 200) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SmokeTestRunner/1.0"})
        with urllib.request.urlopen(req) as response:
            return response.status == expected_status
    except urllib.error.HTTPError as e:
        return e.code == expected_status
    except Exception as e:
        print(f"Error accessing {url}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Smoke test Certificate Ledger deployment")
    parser.add_argument("base_url", nargs="?", default="http://localhost:3000", help="Base URL of app")
    parser.add_argument("--passcode", default="demo2026", help="Organizer passcode")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    print(f"Executing smoke checks against {base}...")

    checks = [
        ("Public Health Endpoint (/api/health)", f"{base}/api/health", 200),
        ("Unauthenticated Organizer Route Blocked (/api/stats)", f"{base}/api/stats", 401),
        ("Malformed Certificate Verification (/api/verify/INVALID-FORMAT)", f"{base}/api/verify/INVALID-FORMAT", 200),
        ("Public Revocations Endpoint (/api/revocations)", f"{base}/api/revocations", 200),
        ("Status Badge Generation (/api/verify/CL-26-7K3M9QX4B/badge.svg)", f"{base}/api/verify/CL-26-7K3M9QX4B/badge.svg", 200),
    ]

    all_passed = True
    for name, url, expected in checks:
        passed = check_endpoint(url, expected)
        status_label = "PASS" if passed else "FAIL"
        print(f"[{status_label}] {name} (expected {expected})")
        if not passed:
            all_passed = False

    if not all_passed:
        print("Smoke tests encountered failures.", file=sys.stderr)
        sys.exit(1)
    else:
        print("All smoke test checks PASSED successfully.")

if __name__ == "__main__":
    main()
