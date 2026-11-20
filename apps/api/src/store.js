import { randomUUID } from 'node:crypto';

/**
 * Contrato de almacenamiento. Dos implementaciones:
 *  - MemoryStore: SOLO para pruebas y desarrollo local. Se borra al reiniciar.
 *  - PostgresStore: producción (DigitalOcean Managed PostgreSQL), requiere DATABASE_URL.
 */
export class MemoryStore {
  constructor() { this.users = new Map(); this.audit = []; }

  async findUserByEmail(email) {
    for (const u of this.users.values()) if (u.email && u.email === email) return u;
    return null;
  }
  async findUserByUsername(username) {
    const k = String(username ?? '').toLowerCase();
    for (const u of this.users.values()) if (u.username && u.username.toLowerCase() === k) return u;
    return null;
  }
  async findUserById(id) { return this.users.get(id) ?? null; }
  async createUser(user) {
    const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...user };
    this.users.set(row.id, row);
    return row;
  }
  async updateUser(id, patch) {
    const row = { ...this.users.get(id), ...patch, updatedAt: new Date().toISOString() };
    this.users.set(id, row);
    return row;
  }
  async listUsersByStatus(status) {
    return [...this.users.values()].filter((u) => u.status === status);
  }
  async listUsers() { return [...this.users.values()]; }
  async addAudit(entry) { this.audit.push({ at: new Date().toISOString(), ...entry }); }
}

export class PostgresStore {
  constructor(pool) { this.pool = pool; }

  static async connect(url) {
    const { default: pg } = await import('pg');
    // DigitalOcean firma con su propia CA: se pasa en DATABASE_CA (App Platform la expone como ${db.CA_CERT}).
    const ssl = /sslmode=disable/.test(url) ? false
      : process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA, rejectUnauthorized: true } : { rejectUnauthorized: true };
    const pool = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl });
    return new PostgresStore(pool);
  }

  #map(r) {
    return r && {
      id: r.id, fullName: r.full_name, email: r.email, phone: r.phone, role: r.role,
      position: r.position, pharmacy: r.pharmacy_text, province: r.province_text, farmaciaId: r.farmacia_id ?? null, username: r.username ?? null, debeCambiarClave: r.debe_cambiar_clave === true, passwordHash: r.password_hash, status: r.status,
      approvedBy: r.approved_by, createdAt: r.created_at,
    };
  }
  async findUserByEmail(email) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return this.#map(rows[0]);
  }
  async findUserByUsername(username) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [String(username ?? '')]);
    return this.#map(rows[0]);
  }
  async findUserById(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return this.#map(rows[0]);
  }
  async createUser(u) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (full_name, email, phone, role, position, pharmacy_text, province_text, password_hash, status, farmacia_id, username, debe_cambiar_clave)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [u.fullName, u.email ?? null, u.phone ?? null, u.role, u.position ?? null, u.pharmacy ?? null, u.province ?? null, u.passwordHash, u.status, u.farmaciaId ?? null, u.username ?? null, u.debeCambiarClave === true],
    );
    return this.#map(rows[0]);
  }
  async updateUser(id, patch) {
    const { rows } = await this.pool.query(
      `UPDATE users SET status = COALESCE($2, status), approved_by = COALESCE($3, approved_by),
       email = COALESCE($4, email), password_hash = COALESCE($5, password_hash), position = COALESCE($6, position),
       farmacia_id = CASE WHEN $7::boolean THEN $8::uuid ELSE farmacia_id END,
       debe_cambiar_clave = COALESCE($9, debe_cambiar_clave), phone = COALESCE($10, phone), full_name = COALESCE($11, full_name), username = COALESCE($12, username),
       updated_at = now() WHERE id = $1 RETURNING *`,
      [id, patch.status ?? null, patch.approvedBy ?? null, patch.email ?? null, patch.passwordHash ?? null, patch.position ?? null, 'farmaciaId' in patch, patch.farmaciaId ?? null, patch.debeCambiarClave ?? null, patch.phone ?? null, patch.fullName ?? null, patch.username ?? null],
    );
    return this.#map(rows[0]);
  }
  async listUsersByStatus(status) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE status = $1 ORDER BY created_at', [status]);
    return rows.map((r) => this.#map(r));
  }
  async listUsers() {
    const { rows } = await this.pool.query('SELECT * FROM users ORDER BY full_name');
    return rows.map((r) => this.#map(r));
  }
  async addAudit(e) {
    await this.pool.query(
      'INSERT INTO audit_logs (actor_id, action, entity, entity_id, before_value, after_value) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.actorId ?? null, e.action, e.entity, String(e.entityId ?? e.entity), e.before == null ? null : JSON.stringify(e.before), e.after == null ? null : JSON.stringify(e.after)],
    );
  }
}
