import { randomUUID } from 'node:crypto';

/**
 * Contrato de almacenamiento. Dos implementaciones:
 *  - MemoryStore: SOLO para pruebas y desarrollo local. Se borra al reiniciar.
 *  - PostgresStore: producción (DigitalOcean Managed PostgreSQL), requiere DATABASE_URL.
 */
export class MemoryStore {
  constructor() { this.users = new Map(); this.audit = []; }

  async findUserByEmail(email) {
    for (const u of this.users.values()) if (u.email === email) return u;
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
      position: r.position, pharmacy: r.pharmacy_text, province: r.province_text, passwordHash: r.password_hash, status: r.status,
      approvedBy: r.approved_by, createdAt: r.created_at,
    };
  }
  async findUserByEmail(email) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return this.#map(rows[0]);
  }
  async findUserById(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return this.#map(rows[0]);
  }
  async createUser(u) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (full_name, email, phone, role, position, pharmacy_text, province_text, password_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [u.fullName, u.email, u.phone, u.role, u.position, u.pharmacy ?? null, u.province ?? null, u.passwordHash, u.status],
    );
    return this.#map(rows[0]);
  }
  async updateUser(id, patch) {
    const { rows } = await this.pool.query(
      `UPDATE users SET status = COALESCE($2, status), approved_by = COALESCE($3, approved_by),
       updated_at = now() WHERE id = $1 RETURNING *`,
      [id, patch.status ?? null, patch.approvedBy ?? null],
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
      [e.actorId ?? null, e.action, e.entity, e.entityId, e.before ?? null, e.after ?? null],
    );
  }
}
