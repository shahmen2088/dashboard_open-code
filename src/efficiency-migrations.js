export const EFFICIENCY_MIGRATIONS = [
  {
    version: 1,
    name: "efficiency-core",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY,
        source_key TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        version TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        coverage REAL,
        last_sync_at TEXT,
        last_error TEXT,
        records_imported INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES sources(id),
        external_id TEXT NOT NULL,
        name TEXT,
        directory TEXT,
        UNIQUE(source_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES sources(id),
        project_id INTEGER REFERENCES projects(id),
        external_id TEXT NOT NULL,
        agent_id TEXT,
        status TEXT,
        started_at TEXT,
        updated_at TEXT,
        ended_at TEXT,
        duration_ms INTEGER,
        data_coverage REAL,
        UNIQUE(source_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id),
        external_id TEXT,
        category TEXT,
        status TEXT,
        verified_success INTEGER,
        created_at TEXT,
        completed_at TEXT,
        UNIQUE(session_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id),
        external_id TEXT,
        attempt INTEGER,
        status TEXT,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(task_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS models (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT,
        UNIQUE(provider, model)
      );
      CREATE TABLE IF NOT EXISTS model_calls (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES sources(id),
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        model_id INTEGER REFERENCES models(id),
        external_id TEXT NOT NULL,
        occurred_at TEXT,
        input_tokens INTEGER,
        uncached_input_tokens INTEGER,
        cached_input_tokens INTEGER,
        cache_write_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        total_tokens INTEGER,
        reported_cost REAL,
        api_equivalent_cost REAL,
        actual_spend REAL,
        duration_ms INTEGER,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        error_events INTEGER NOT NULL DEFAULT 0,
        retry_events INTEGER NOT NULL DEFAULT 0,
        compaction_events INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        raw_accounting_kind TEXT NOT NULL,
        UNIQUE(source_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        agent_key TEXT NOT NULL UNIQUE,
        display_name TEXT
      );
      CREATE TABLE IF NOT EXISTS skills_usage (
        id INTEGER PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id),
        skill TEXT NOT NULL,
        used_at TEXT,
        success INTEGER
      );
      CREATE TABLE IF NOT EXISTS config_versions (
        id INTEGER PRIMARY KEY,
        component TEXT NOT NULL,
        version_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        UNIQUE(component, version_hash)
      );
      CREATE TABLE IF NOT EXISTS task_evidence (
        id INTEGER PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id),
        evidence_type TEXT NOT NULL,
        status TEXT NOT NULL,
        reference TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS benchmarks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        category TEXT,
        verification_kind TEXT,
        UNIQUE(name, version)
      );
      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id INTEGER PRIMARY KEY,
        benchmark_id INTEGER REFERENCES benchmarks(id),
        model_id INTEGER REFERENCES models(id),
        config_version_id INTEGER REFERENCES config_versions(id),
        status TEXT,
        verified_success INTEGER,
        total_tokens INTEGER,
        cost REAL,
        duration_ms INTEGER,
        started_at TEXT
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        baseline_config TEXT,
        optimized_config TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_prices (
        id INTEGER PRIMARY KEY,
        model_id INTEGER NOT NULL REFERENCES models(id),
        currency TEXT NOT NULL DEFAULT 'USD',
        input_per_million REAL,
        cached_input_per_million REAL,
        output_per_million REAL,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        source TEXT,
        UNIQUE(model_id, effective_from)
      );
      CREATE TABLE IF NOT EXISTS billing_records (
        id INTEGER PRIMARY KEY,
        source_id INTEGER REFERENCES sources(id),
        external_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        UNIQUE(source_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        name TEXT NOT NULL,
        period TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS telemetry_checkpoints (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES sources(id),
        checkpoint_key TEXT NOT NULL,
        checkpoint_value TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, checkpoint_key)
      );
      CREATE INDEX IF NOT EXISTS idx_calls_occurred_at ON model_calls(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_calls_session ON model_calls(session_id);
      CREATE INDEX IF NOT EXISTS idx_calls_model ON model_calls(model_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    `,
  },
]
