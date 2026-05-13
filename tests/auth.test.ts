import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { createDatabase } from '../src/storage/database';
import { signToken, verifyToken, isAuthEnabled } from '../src/auth/jwt';
import { requireRole } from '../src/auth/middleware';

describe('JWT', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JWT_SECRET;
  });

  it('isAuthEnabled returns false without JWT_SECRET', () => {
    expect(isAuthEnabled()).toBe(false);
  });

  it('isAuthEnabled returns true with JWT_SECRET', () => {
    process.env.JWT_SECRET = 'test-secret';
    expect(isAuthEnabled()).toBe(true);
  });

  it('sign and verify token round-trip', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = signToken({ sub: 'user-1', username: 'testuser' });
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user-1');
    expect(payload!.username).toBe('testuser');
  });

  it('verifyToken rejects tampered token', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = signToken({ sub: 'user-1', username: 'test' });
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('verifyToken rejects token with wrong secret', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = signToken({ sub: 'user-1', username: 'test' });
    process.env.JWT_SECRET = 'different-secret';
    expect(verifyToken(token)).toBeNull();
  });
});

describe('AppDatabase - users/members', () => {
  it('creates and retrieves users', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-auth-'));
    const db = createDatabase(dataDir);

    const user = db.createUser('alice', 'hash123', 'Alice');
    expect(user.username).toBe('alice');

    const found = db.getUserByUsername('alice');
    expect(found).not.toBeNull();
    expect(found!.displayName).toBe('Alice');

    expect(db.getUserByUsername('nobody')).toBeNull();
  });

  it('adds and queries project members', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-auth-'));
    const db = createDatabase(dataDir);

    const owner = db.createUser('owner', 'hash', 'Owner');
    const editor = db.createUser('editor', 'hash', 'Editor');
    const project = db.createProject('测试项目', owner.id);

    db.addProjectMember(project.id, editor.id, 'editor');

    const members = db.getProjectMembers(project.id);
    expect(members).toHaveLength(2); // owner + editor
    expect(members.find((m) => m.userId === editor.id)?.role).toBe('editor');

    expect(db.getProjectRole(project.id, owner.id)).toBe('owner');
    expect(db.getProjectRole(project.id, editor.id)).toBe('editor');
  });

  it('removes project members', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-auth-'));
    const db = createDatabase(dataDir);

    const owner = db.createUser('o', 'hash', 'O');
    const editor = db.createUser('e', 'hash', 'E');
    const project = db.createProject('p', owner.id);
    db.addProjectMember(project.id, editor.id, 'editor');

    db.removeProjectMember(project.id, editor.id);
    expect(db.getProjectMembers(project.id)).toHaveLength(1); // only owner
    expect(db.getProjectRole(project.id, editor.id)).toBeNull();
  });

  it('listProjects filters by user', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-auth-'));
    const db = createDatabase(dataDir);

    const u1 = db.createUser('u1', 'h', 'U1');
    const u2 = db.createUser('u2', 'h', 'U2');
    db.createProject('u1s project', u1.id);
    db.createProject('u2s project', u2.id);

    expect(db.listProjects(u1.id)).toHaveLength(1);
    expect(db.listProjects()).toHaveLength(2);
  });
});

describe('requireRole', () => {
  it('returns true when auth is disabled', () => {
    delete process.env.JWT_SECRET;
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-auth-'));
    const db = createDatabase(dataDir);
    expect(requireRole(db, 'any-project', 'any-user', 'owner')).toBe(true);
  });

  it('rejects viewer for editor operations', () => {
    process.env.JWT_SECRET = 'test';
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-auth-'));
    const db = createDatabase(dataDir);
    const owner = db.createUser('o', 'h', 'O');
    const viewer = db.createUser('v', 'h', 'V');
    const project = db.createProject('p', owner.id);
    db.addProjectMember(project.id, viewer.id, 'viewer');

    expect(requireRole(db, project.id, viewer.id, 'editor')).toBe(false);
    expect(requireRole(db, project.id, viewer.id, 'viewer')).toBe(true);
  });
});
