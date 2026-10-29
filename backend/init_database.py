"""Create and verify the isolated SkillGapper database."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import UniqueConstraint, inspect


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REBUILD_PATH = (PROJECT_ROOT / "database-rebuild-20261023" / "skillgapper.db").resolve()


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def sqlite_rows(connection, statement):
    return connection.exec_driver_sql(statement).fetchall()


def actual_table_info(connection, table_name):
    rows = sqlite_rows(
        connection,
        f"PRAGMA table_info({quote_identifier(table_name)})"
    )
    return {
        row[1]: {
            "nullable": not bool(row[3]) and not bool(row[5]),
            "primary_key": row[5]
        }
        for row in rows
    }, tuple(
        row[1]
        for row in sorted(rows, key=lambda row: row[5])
        if row[5]
    )


def actual_indexes(connection, table_name):
    indexes = {}
    for row in sqlite_rows(
        connection,
        f"PRAGMA index_list({quote_identifier(table_name)})"
    ):
        index_name = row[1]
        indexes[index_name] = {
            "unique": bool(row[2]),
            "columns": tuple(
                info[2]
                for info in sorted(
                    sqlite_rows(
                        connection,
                        f"PRAGMA index_info({quote_identifier(index_name)})"
                    ),
                    key=lambda info: info[0]
                )
            )
        }
    return indexes


def actual_foreign_keys(connection, table_name):
    return {
        (row[3], row[2], row[4])
        for row in sqlite_rows(
            connection,
            f"PRAGMA foreign_key_list({quote_identifier(table_name)})"
        )
    }


def expected_unique_sets(table):
    unique_sets = {
        tuple(constraint.columns.keys())
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    unique_sets.update(
        (column.name,)
        for column in table.columns
        if column.unique
    )
    return unique_sets


def verify_schema(db):
    inspector = inspect(db.engine)
    expected_tables = set(db.metadata.tables)
    actual_tables = set(inspector.get_table_names())
    errors = []

    if expected_tables != actual_tables:
        errors.append(
            f"table mismatch: expected {sorted(expected_tables)}, "
            f"found {sorted(actual_tables)}"
        )

    with db.engine.connect() as connection:
        integrity = connection.exec_driver_sql(
            "PRAGMA integrity_check"
        ).scalar_one()
        quick = connection.exec_driver_sql(
            "PRAGMA quick_check"
        ).scalar_one()
        foreign_key_errors = connection.exec_driver_sql(
            "PRAGMA foreign_key_check"
        ).fetchall()

        if integrity != "ok":
            errors.append(f"integrity_check returned {integrity!r}")
        if quick != "ok":
            errors.append(f"quick_check returned {quick!r}")
        foreign_keys = connection.exec_driver_sql(
            "PRAGMA foreign_keys"
        ).scalar_one()
        if foreign_keys != 1:
            errors.append(
                f"foreign_keys pragma returned {foreign_keys!r}, expected 1"
            )
        if foreign_key_errors:
            errors.append(
                f"foreign_key_check returned {len(foreign_key_errors)} rows"
            )

        for table_name, table in db.metadata.tables.items():
            actual_columns, actual_primary_key = actual_table_info(
                connection,
                table_name
            )
            expected_columns = set(table.columns.keys())

            if set(actual_columns) != expected_columns:
                errors.append(
                    f"{table_name}: column mismatch: expected "
                    f"{sorted(expected_columns)}, found {sorted(actual_columns)}"
                )

            expected_primary_key = tuple(table.primary_key.columns.keys())
            if actual_primary_key != expected_primary_key:
                errors.append(
                    f"{table_name}: primary key mismatch: expected "
                    f"{expected_primary_key}, found {actual_primary_key}"
                )

            for column in table.columns:
                actual = actual_columns.get(column.name)
                if actual is None:
                    continue
                expected_nullable = False if column.primary_key else column.nullable
                if actual["nullable"] != expected_nullable:
                    errors.append(
                        f"{table_name}.{column.name}: nullable mismatch: "
                        f"expected {expected_nullable}, found {actual['nullable']}"
                    )

            expected_indexes = {
                index.name: {
                    "unique": bool(index.unique),
                    "columns": tuple(column.name for column in index.columns)
                }
                for index in table.indexes
            }
            actual_index_map = actual_indexes(connection, table_name)
            for index_name, expected in expected_indexes.items():
                actual = actual_index_map.get(index_name)
                if actual != expected:
                    errors.append(
                        f"{table_name}: index {index_name} mismatch: "
                        f"expected {expected}, found {actual}"
                    )

            actual_unique_sets = {
                value["columns"]
                for value in actual_index_map.values()
                if value["unique"]
            }
            missing_unique_sets = expected_unique_sets(table) - actual_unique_sets
            for columns in sorted(missing_unique_sets):
                errors.append(
                    f"{table_name}: missing unique constraint on {columns}"
                )

            expected_foreign_keys = {
                (
                    foreign_key.parent.name,
                    foreign_key.column.table.name,
                    foreign_key.column.name
                )
                for foreign_key in table.foreign_keys
            }
            actual_foreign_key_set = actual_foreign_keys(connection, table_name)
            if actual_foreign_key_set != expected_foreign_keys:
                errors.append(
                    f"{table_name}: foreign-key mismatch: expected "
                    f"{sorted(expected_foreign_keys)}, found "
                    f"{sorted(actual_foreign_key_set)}"
                )

    if errors:
        raise RuntimeError("\n".join(errors))

    print(f"Verified tables: {', '.join(sorted(expected_tables))}")
    print("Verified columns, primary keys, nullability, indexes, unique constraints, and foreign keys.")
    print("SQLite integrity_check: ok")
    print("SQLite quick_check: ok")
    print("SQLite foreign_keys pragma: 1")
    print("SQLite foreign_key_check: ok")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create and verify the isolated SkillGapper database."
    )
    parser.add_argument(
        "--database-url",
        required=True,
        help="Explicit sqlite URL for the approved rebuild database."
    )
    parser.add_argument(
        "--verify-existing",
        action="store_true",
        help="Verify an already-created rebuild database without overwriting it."
    )
    return parser.parse_args()


def main():
    args = parse_args()
    prefix = "sqlite:///"

    if not args.database_url.startswith(prefix):
        raise SystemExit("Only an explicit sqlite:/// database URL is allowed.")

    target_path = Path(args.database_url[len(prefix):]).resolve()
    protected_paths = {
        (PROJECT_ROOT / "backend" / "database.db").resolve(),
        (PROJECT_ROOT / "database-recovery-20261023" / "database.db").resolve()
    }

    if target_path != REBUILD_PATH:
        raise SystemExit(f"Refusing database target outside {REBUILD_PATH}")
    if target_path in protected_paths:
        raise SystemExit("Refusing to target a protected database file.")
    if target_path.exists() and not args.verify_existing:
        raise SystemExit(f"Refusing to overwrite existing database: {target_path}")
    if not target_path.parent.exists():
        raise SystemExit(f"Rebuild directory does not exist: {target_path.parent}")

    os.environ["DATABASE_URL"] = args.database_url
    os.environ["SKILLGAPPER_DB_INITIALIZE"] = "1"

    # Import after DATABASE_URL is set, then apply additive missing-table changes
    # only to the explicitly approved rebuild database before schema verification.
    from app import app, db

    with app.app_context():
        db.create_all()
        verify_schema(db)

    print(f"Database created and verified: {target_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Database initialization failed: {error}", file=sys.stderr)
        raise SystemExit(1)
