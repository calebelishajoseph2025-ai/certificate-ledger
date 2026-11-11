import hmac
import hashlib
import os
from typing import Optional
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    DATABASE_URL: str = Field(default="postgresql://postgres:postgres@localhost:5432/postgres")
    DIRECT_URL: Optional[str] = None
    TEST_DATABASE_URL: Optional[str] = None

    ORGANIZER_PASSCODE: str = Field(default="demo2026")
    SYSTEM_RESET_KEY: str = Field(default="system_reset_csi_2026")
    SESSION_SECRET: str = Field(default="a8f9c2e4b6d0123456789abcdef0123456789abcdef0123456789abcdef01234")
    LEDGER_SIGNING_KEY: str = Field(default="d7e5f3a1c9b80123456789abcdef0123456789abcdef0123456789abcdef01234")
    LEDGER_SIGNING_KEY_PREVIOUS: Optional[str] = None

    RATE_LIMIT_VERIFY_PER_MIN: int = 30
    RATE_LIMIT_NOTFOUND_PER_10MIN: int = 10
    RATE_LIMIT_LOGIN_FAILS_PER_15MIN: int = 5
    RATE_LIMIT_SOCIAL_PER_MIN: int = 120

    ISSUER_NAME: str = "Northwind Learning Collective"
    SIGNATORY_1_NAME: str = "Dr. Amara Okonkwo"
    SIGNATORY_1_TITLE: str = "Program Director"
    SIGNATORY_2_NAME: str = "Lucas Brandt"
    SIGNATORY_2_TITLE: str = "Head of Faculty"

    PUBLIC_BASE_URL: str = "http://localhost:3000"

    @model_validator(mode="after")
    def validate_secrets(self) -> "Settings":
        if len(self.SESSION_SECRET) < 32:
            raise ValueError("SESSION_SECRET must be at least 32 characters long")
        if len(self.LEDGER_SIGNING_KEY) < 32:
            raise ValueError("LEDGER_SIGNING_KEY must be at least 32 characters long")
        if self.SESSION_SECRET == self.LEDGER_SIGNING_KEY:
            raise ValueError("SESSION_SECRET and LEDGER_SIGNING_KEY must not be equal")

        if os.environ.get("VERCEL_URL") and self.PUBLIC_BASE_URL == "http://localhost:3000":
            self.PUBLIC_BASE_URL = f"https://{os.environ['VERCEL_URL']}"
        return self

    @property
    def k_cert(self) -> bytes:
        return hmac.new(self.LEDGER_SIGNING_KEY.encode(), b"certificate-link-v1", hashlib.sha256).digest()

    @property
    def k_audit(self) -> bytes:
        return hmac.new(self.LEDGER_SIGNING_KEY.encode(), b"audit-checkpoint-v1", hashlib.sha256).digest()

    @property
    def k_cert_prev(self) -> Optional[bytes]:
        if self.LEDGER_SIGNING_KEY_PREVIOUS and len(self.LEDGER_SIGNING_KEY_PREVIOUS) >= 32:
            return hmac.new(self.LEDGER_SIGNING_KEY_PREVIOUS.encode(), b"certificate-link-v1", hashlib.sha256).digest()
        return None

    @property
    def k_audit_prev(self) -> Optional[bytes]:
        if self.LEDGER_SIGNING_KEY_PREVIOUS and len(self.LEDGER_SIGNING_KEY_PREVIOUS) >= 32:
            return hmac.new(self.LEDGER_SIGNING_KEY_PREVIOUS.encode(), b"audit-checkpoint-v1", hashlib.sha256).digest()
        return None


settings = Settings()
