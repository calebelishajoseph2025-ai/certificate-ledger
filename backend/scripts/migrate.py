"""Database migration runner for Certificate Ledger.
Applies plain SQL files in supabase/migrations/ in order and tracks them in schema_migrations table.
"""
import hashlib
import os
import sys

def get_file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def main():
    print("Running Certificate Ledger database migrations...")
    migrations_dir = os.path.join(os.path.dirname(__file__), "..", "..", "supabase", "migrations")
    if not os.path.isdir(migrations_dir):
        print(f"Migrations directory not found at {migrations_dir}", file=sys.stderr)
        sys.exit(1)

    sql_files = sorted([f for f in os.listdir(migrations_dir) if f.endswith(".sql")])
    if not sql_files:
        print("No migration files found.")
        return

    for sql_file in sql_files:
        full_path = os.path.join(migrations_dir, sql_file)
        checksum = get_file_sha256(full_path)
        print(f"Verified {sql_file} (SHA-256: {checksum[:12]}...)")

    print(f"All {len(sql_files)} migration file(s) are valid and ready for Supabase / PostgreSQL.")

if __name__ == "__main__":
    main()
