import base64
import hmac
import hashlib
import re
import secrets
from typing import Optional, Tuple
from backend.app.config import settings

CROCKFORD_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def compute_check_char(str8: str) -> str:
    total = 0
    for i, c in enumerate(str8):
        idx = CROCKFORD_CHARS.find(c)
        val = idx if idx >= 0 else 0
        total += val * (i + 1)
    return CROCKFORD_CHARS[total % len(CROCKFORD_CHARS)]


def validate_cert_id(cert_id: str) -> Tuple[bool, bool]:
    if not cert_id or not isinstance(cert_id, str):
        return False, True
    clean = cert_id.strip().upper()
    match = re.match(r"^CL-(\d{2})-([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8})([23456789ABCDEFGHJKMNPQRSTUVWXYZ])$", clean)
    if not match:
        return False, True
    body, check = match.group(2), match.group(3)
    if check != compute_check_char(body):
        return False, True
    return True, False


def generate_cert_id(year_yy: str = "26") -> str:
    body = "".join(secrets.choice(CROCKFORD_CHARS) for _ in range(8))
    check = compute_check_char(body)
    return f"CL-{year_yy}-{body}{check}"


def base64url_nopad(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def sign_cert_id(cert_id: str, key_override: Optional[bytes] = None) -> str:
    key = key_override or settings.k_cert
    tag = hmac.new(key, f"v1|{cert_id}".encode("utf-8"), hashlib.sha256).digest()[:12]
    return base64url_nopad(tag)


def verify_sig(cert_id: str, sig: Optional[str]) -> Tuple[bool, bool]:
    if not sig or not isinstance(sig, str):
        return False, False
    clean_sig = sig.trim() if hasattr(sig, 'trim') else sig.strip()
    if len(clean_sig) != 16 or not re.match(r"^[A-Za-z0-9_-]+$", clean_sig):
        return False, True

    expected = sign_cert_id(cert_id, settings.k_cert)
    if hmac.compare_digest(clean_sig, expected):
        return True, True

    if settings.k_cert_prev:
        expected_prev = sign_cert_id(cert_id, settings.k_cert_prev)
        if hmac.compare_digest(clean_sig, expected_prev):
            return True, True

    return False, True


def make_verify_url(cert_id: str) -> str:
    sig = sign_cert_id(cert_id)
    return f"{settings.PUBLIC_BASE_URL}/verify/{cert_id}?s={sig}"
