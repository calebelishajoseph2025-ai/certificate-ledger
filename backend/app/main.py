from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings

app = FastAPI(
    title="Certificate Ledger API",
    description="Tamper-evident certificate issuance and verification engine",
    version="2.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    return {"ok": True, "db": True}

@app.get("/api/branding")
def branding():
    return {
        "issuerName": settings.ISSUER_NAME,
        "signatory1Name": settings.SIGNATORY_1_NAME,
        "signatory1Title": settings.SIGNATORY_1_TITLE,
        "signatory2Name": settings.SIGNATORY_2_NAME,
        "signatory2Title": settings.SIGNATORY_2_TITLE,
        "publicBaseUrl": settings.PUBLIC_BASE_URL,
    }
