import Database from 'better-sqlite3'
import { dataPath, ensureExternalDataLayout } from './dataPaths.ts'

const dataDir = ensureExternalDataLayout()

const dbPath = process.env.CCS_DB_PATH || dataPath('ccs.db')
export const ccsDb = new Database(dbPath)
ccsDb.pragma('busy_timeout = 30000')
ccsDb.pragma('journal_mode = WAL')
ccsDb.pragma('foreign_keys = ON')

ccsDb.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`)

const migrations: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_node_id TEXT NOT NULL UNIQUE,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE thread_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_id TEXT,
        lease_until INTEGER,
        heartbeat_at INTEGER,
        current_step_id TEXT,
        result TEXT,
        error_code TEXT,
        error_message TEXT,
        resume_safe INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE TABLE task_plans (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        goal TEXT NOT NULL,
        assumptions TEXT NOT NULL DEFAULT '[]',
        acceptance TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE task_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        title TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        output_json TEXT,
        operation_id TEXT NOT NULL UNIQUE,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(task_id, ordinal)
      );
      CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE task_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_id TEXT REFERENCES task_steps(id) ON DELETE SET NULL,
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE deliverables (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(task_id, node_id)
      );
      CREATE TABLE tool_operations (
        operation_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX idx_tasks_queue ON tasks(status, lease_until, created_at);
      CREATE INDEX idx_tasks_project ON tasks(project_id, created_at DESC);
      CREATE INDEX idx_events_task ON task_events(task_id, id);
      CREATE INDEX idx_steps_task ON task_steps(task_id, ordinal);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE project_members (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','member')),
        can_create_tasks INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );
      ALTER TABLE tasks ADD COLUMN created_by TEXT;
      CREATE INDEX idx_project_members_user ON project_members(user_id, project_id);
      CREATE INDEX idx_tasks_creator ON tasks(created_by, created_at DESC);
    `,
  },
  {
    version: 3,
    sql: `
      INSERT OR IGNORE INTO project_members(project_id,user_id,role,can_create_tasks,created_at)
        SELECT id,created_by,'owner',1,created_at FROM projects WHERE created_by IS NOT NULL;
      UPDATE tasks
        SET created_by=(SELECT created_by FROM projects WHERE projects.id=tasks.project_id)
        WHERE created_by IS NULL;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE thread_messages ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
      ALTER TABLE task_plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE task_steps ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE task_steps ADD COLUMN expected_output TEXT;
      ALTER TABLE task_steps ADD COLUMN result_summary TEXT;
      ALTER TABLE task_events ADD COLUMN sequence INTEGER;
      UPDATE task_events AS current
        SET sequence=(SELECT COUNT(*) FROM task_events AS prior
          WHERE prior.task_id=current.task_id AND prior.id<=current.id);
      CREATE UNIQUE INDEX idx_events_task_sequence ON task_events(task_id, sequence);
      ALTER TABLE task_checkpoints ADD COLUMN iteration INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE task_checkpoints ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE task_checkpoints ADD COLUMN context_summary TEXT;
      ALTER TABLE deliverables ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE deliverables ADD COLUMN updated_at INTEGER;
      UPDATE deliverables SET updated_at=created_at WHERE updated_at IS NULL;
      ALTER TABLE tool_operations ADD COLUMN step_id TEXT REFERENCES task_steps(id) ON DELETE SET NULL;
      ALTER TABLE tool_operations ADD COLUMN input_hash TEXT;
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE tasks ADD COLUMN legacy_source_id TEXT;
      CREATE UNIQUE INDEX idx_tasks_legacy_source ON tasks(created_by, legacy_source_id)
        WHERE legacy_source_id IS NOT NULL;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE task_observations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        data_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_observations_task ON task_observations(task_id, created_at);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE worker_instances (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        stopped_at INTEGER
      );
      CREATE INDEX idx_workers_heartbeat ON worker_instances(heartbeat_at DESC);
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'actions';
      ALTER TABLE tasks ADD COLUMN model_calls INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN waiting_question TEXT;
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE project_memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'user',
        source_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        replaces_id TEXT REFERENCES project_memories(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_memories_project ON project_memories(project_id, status, updated_at DESC);
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE threads ADD COLUMN created_by TEXT;
      UPDATE threads SET created_by=(SELECT created_by FROM projects WHERE projects.id=threads.project_id)
        WHERE created_by IS NULL;
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        action_json TEXT NOT NULL,
        schedule_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER,
        last_run_at INTEGER,
        last_status TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        scheduled_for INTEGER NOT NULL,
        status TEXT NOT NULL,
        client_id TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX idx_automations_due ON automations(created_by, enabled, next_run_at);
      CREATE INDEX idx_automation_runs_task ON automation_runs(automation_id, created_at DESC);
      CREATE UNIQUE INDEX idx_automation_runs_scheduled ON automation_runs(automation_id, scheduled_for);
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        document_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_canvases_owner ON canvases(owner_id, updated_at DESC);
      CREATE INDEX idx_canvases_project ON canvases(project_id, updated_at DESC);
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE canvases ADD COLUMN visibility TEXT NOT NULL DEFAULT 'restricted';
      CREATE TABLE canvas_members (
        canvas_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (canvas_id, user_id)
      );
      CREATE INDEX idx_canvas_members_user ON canvas_members(user_id);
    `,
  },
  {
    version: 14,
    sql: `
      ALTER TABLE canvases ADD COLUMN deleted_at INTEGER;
      CREATE INDEX idx_canvases_deleted ON canvases(owner_id, deleted_at, updated_at DESC);
    `,
  },
  {
    version: 15,
    sql: `
      UPDATE canvases
        SET visibility='private'
        WHERE visibility='restricted'
          AND NOT EXISTS (SELECT 1 FROM canvas_members WHERE canvas_members.canvas_id=canvases.id);
      CREATE TABLE canvas_invites (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        code_hint TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('read','edit')),
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX idx_canvas_invites_canvas ON canvas_invites(canvas_id, revoked_at, created_at DESC);
      CREATE TABLE canvas_invite_members (
        invite_id TEXT NOT NULL REFERENCES canvas_invites(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (invite_id, user_id)
      );
      CREATE INDEX idx_canvas_invite_members_user ON canvas_invite_members(user_id, invite_id);
    `,
  },
  {
    version: 16,
    sql: `
      ALTER TABLE tasks ADD COLUMN execution_profile TEXT NOT NULL DEFAULT 'expert';
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE tasks ADD COLUMN preferred_provider_id TEXT;
      ALTER TABLE tasks ADD COLUMN preferred_llm_model TEXT;
      ALTER TABLE tasks ADD COLUMN preferred_image_provider_id TEXT;
      ALTER TABLE tasks ADD COLUMN preferred_image_model TEXT;
    `,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE user_preferences (
        user_id TEXT PRIMARY KEY,
        active_wallpaper_id TEXT NOT NULL DEFAULT 'system-default',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE user_wallpapers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_user_wallpapers_user ON user_wallpapers(user_id, created_at);
    `,
  },
  {
    version: 19,
    sql: `
      CREATE TABLE user_installed_apps (
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, app_id)
      );
      CREATE TABLE user_app_install_state (
        user_id TEXT PRIMARY KEY,
        migrated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_user_installed_apps_user ON user_installed_apps(user_id, installed_at);
    `,
  },
  {
    version: 20,
    sql: `
      ALTER TABLE user_installed_apps ADD COLUMN installed_version TEXT NOT NULL DEFAULT '0.0.0';
      ALTER TABLE user_installed_apps ADD COLUMN installed_build INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE user_installed_apps ADD COLUMN release_channel TEXT NOT NULL DEFAULT 'stable';
      ALTER TABLE user_installed_apps ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 21,
    sql: `
      CREATE TABLE app_market_releases (
        app_id TEXT NOT NULL,
        version TEXT NOT NULL,
        build INTEGER NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('stable','beta','dev')),
        delivery TEXT NOT NULL DEFAULT 'dx-app' CHECK (delivery IN ('dx-app','system-bundle')),
        package_path TEXT NOT NULL,
        package_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        signature TEXT NOT NULL,
        signing_key_id TEXT NOT NULL,
        min_system_version TEXT NOT NULL,
        max_system_version TEXT,
        data_version INTEGER NOT NULL,
        mandatory INTEGER NOT NULL DEFAULT 0,
        rollout_percent INTEGER NOT NULL DEFAULT 100,
        release_notes TEXT NOT NULL DEFAULT '',
        publisher_user_id TEXT NOT NULL,
        published_at INTEGER NOT NULL,
        revoked_at INTEGER,
        PRIMARY KEY(app_id, version, build, channel)
      );
      CREATE INDEX idx_app_market_catalog
        ON app_market_releases(channel, revoked_at, published_at DESC);
      CREATE INDEX idx_app_market_app
        ON app_market_releases(app_id, channel, revoked_at, published_at DESC);
    `,
  },
  {
    version: 22,
    sql: `
      ALTER TABLE user_app_install_state ADD COLUMN catalog_migrated_at INTEGER;
    `,
  },
  {
    version: 23,
    sql: `
      CREATE TABLE app_credential_bindings (
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        binding_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'bearer',
        header_name TEXT,
        bound_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, app_id, binding_id)
      );
      CREATE INDEX idx_app_credential_bindings_user_app ON app_credential_bindings(user_id, app_id);
    `,
  },
  {
    version: 24,
    sql: `
      CREATE TABLE app_oauth_tokens (
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        oauth_id TEXT NOT NULL,
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT,
        token_type TEXT NOT NULL DEFAULT 'Bearer',
        scope TEXT,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, app_id, oauth_id)
      );
      CREATE INDEX idx_app_oauth_tokens_user_app ON app_oauth_tokens(user_id, app_id);
    `,
  },
  {
    version: 25,
    sql: `
      CREATE TABLE app_runtime_events (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        version TEXT NOT NULL,
        build INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_app_runtime_events_app_time ON app_runtime_events(app_id, created_at DESC);
    `,
  },
  {
    version: 26,
    sql: `
      ALTER TABLE app_market_releases ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved';
      ALTER TABLE app_market_releases ADD COLUMN reviewed_by TEXT;
      ALTER TABLE app_market_releases ADD COLUMN reviewed_at INTEGER;
    `,
  },
  {
    version: 27,
    sql: `
      CREATE TABLE app_network_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        method TEXT NOT NULL,
        origin TEXT NOT NULL,
        pathname TEXT NOT NULL,
        status INTEGER NOT NULL,
        response_bytes INTEGER NOT NULL,
        credential_ref INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_app_network_audit_app_time ON app_network_audit(app_id, created_at DESC);
    `,
  },
  {
    version: 28,
    sql: `
      CREATE TABLE cloud_account_sessions (
        local_user_id TEXT PRIMARY KEY,
        cloud_user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT,
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT NOT NULL,
        access_expires_at INTEGER NOT NULL,
        refresh_expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_cloud_account_sessions_cloud_user
        ON cloud_account_sessions(cloud_user_id);
    `,
  },
  {
    version: 29,
    sql: `
      CREATE TABLE installation_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        installation_id TEXT NOT NULL UNIQUE,
        device_public_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE cloud_installation_binding (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL UNIQUE REFERENCES installation_identity(installation_id) ON DELETE CASCADE,
        cloud_user_id TEXT NOT NULL,
        organization_id TEXT,
        device_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('active','revoked','unbound')),
        bound_by_local_user_id TEXT NOT NULL,
        bound_at INTEGER NOT NULL,
        last_verified_at INTEGER,
        unbound_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_cloud_installation_binding_active
        ON cloud_installation_binding(installation_id) WHERE status = 'active';
      CREATE INDEX idx_cloud_installation_binding_cloud_user
        ON cloud_installation_binding(cloud_user_id, status);
      CREATE TABLE cloud_installation_sessions (
        installation_id TEXT PRIMARY KEY REFERENCES installation_identity(installation_id) ON DELETE CASCADE,
        cloud_user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT,
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT NOT NULL,
        access_expires_at INTEGER NOT NULL,
        refresh_expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_cloud_installation_sessions_cloud_user
        ON cloud_installation_sessions(cloud_user_id);
    `,
  },
  {
    version: 30,
    sql: `
      CREATE TABLE cloud_entitlement_cache (
        installation_id TEXT PRIMARY KEY REFERENCES installation_identity(installation_id) ON DELETE CASCADE,
        key_id TEXT NOT NULL,
        algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
        token TEXT NOT NULL,
        signature TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        grace_until INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_cloud_entitlement_expiry
        ON cloud_entitlement_cache(expires_at, grace_until);
    `,
  },
  {
    version: 31,
    sql: `
      CREATE TABLE system_preferences (
        preference_key TEXT PRIMARY KEY,
        preference_value TEXT NOT NULL,
        updated_by TEXT,
        updated_at INTEGER NOT NULL
      );
    `,
  },
]

for (const migration of migrations) {
  const applyMigration = ccsDb.transaction(() => {
    const applied = ccsDb.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version)
    if (!applied) {
      ccsDb.exec(migration.sql)
      ccsDb.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, Date.now())
    }
  })
  applyMigration.immediate()
}

export function closeCcsDb() {
  ccsDb.close()
}
