#!/usr/bin/env python3
"""Build #30 APK byte verification.

Confirms the artifact URL from `eas build:view` serves a real
APK: a live range GET expecting HTTP 206 + a PK zip header.
(NOTE: in builds #23-#29 this check was BLOCKED from this VM —
Cloudflare 403 / error 1010 on expo.dev artifact URLs, on both
the public and the authenticated endpoint. If it 403s again,
report that honestly: the build:view FINISHED + artifact URL
stand on EAS's own record; the byte check stays unverified.)

Usage: verify_build_build30.py <apk-url>
"""
import sys
import urllib.request


def main() -> int:
    url = sys.argv[1]
    req = urllib.request.Request(url, headers={"Range": "bytes=0-3"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            head = resp.read(4)
            print(f"HTTP {resp.status} first-bytes={head!r}")
            ok = resp.status == 206 and head[:2] == b"PK"
            print("VERIFIED" if ok else "NOT VERIFIED")
            return 0 if ok else 1
    except Exception as exc:  # noqa: BLE001 — report, don't crash
        print(f"BLOCKED/FAILED: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
