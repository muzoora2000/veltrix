"""
db_compat.py — Database connection helper for the HydroSense AI service.

On Render (production): connects to PostgreSQL via DATABASE_URL.
Locally:                 connects to SQLite at DB_PATH.

Usage:
    from db_compat import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM water_points LIMIT 10")
    rows = cursor.fetchall()
    conn.close()

The returned connection object is compatible with both psycopg2 and
sqlite3 for simple SELECT queries. For production code prefer
parameterised queries using %s (psycopg2 style) — these also work in
sqlite3 via the adapter below.
"""

import os
import sqlite3
import logging

logger = logging.getLogger("hydrosense.db_compat")

_DB_URL  = os.getenv("DATABASE_URL")
_DB_PATH = os.getenv("DB_PATH", "../server/watermonitor.db")


class _Sqlite3PsycopgAdapter:
    """Thin wrapper that makes sqlite3 accept %s-style placeholders."""

    def __init__(self, path: str):
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row

    def cursor(self):
        return _CursorAdapter(self._conn.cursor())

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class _CursorAdapter:
    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        if params is not None:
            sql = sql.replace("%s", "?")
        self._cur.execute(sql, params or ())
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        return dict(row) if row else None

    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]

    @property
    def description(self):
        return self._cur.description

    @property
    def rowcount(self):
        return self._cur.rowcount

    def close(self):
        self._cur.close()


def get_connection():
    """Return a database connection. Caller is responsible for closing it."""
    if _DB_URL:
        try:
            import psycopg2
            import psycopg2.extras
            conn = psycopg2.connect(_DB_URL, connect_timeout=10,
                                    cursor_factory=psycopg2.extras.RealDictCursor)
            return conn
        except Exception as e:
            logger.warning(f"[db_compat] PostgreSQL connection failed: {e}. Falling back to SQLite.")

    return _Sqlite3PsycopgAdapter(_DB_PATH)


def is_postgres() -> bool:
    """True when running against PostgreSQL (Render production)."""
    return bool(_DB_URL)
