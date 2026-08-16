import type { BaseRecord, HttpError } from "@refinedev/core";

export type AdminIdentity = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
};

export type AdminUser = BaseRecord & {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
  effectivePermissions: string[];
  roleId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PermissionRole = BaseRecord & {
  id: string;
  key: string;
  name: string;
  isDefault: boolean;
  permissions: string[];
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PermissionDefinition = {
  key: string;
  module: string;
  action: string;
  label: string;
  implies?: string[];
};

export type ServerStatusPayload = BaseRecord & {
  ok: boolean;
  server: {
    host: string;
    port: number;
    startedAt: string;
    uptimeSeconds: number;
    nodeVersion: string;
  };
  urls: { local: string; lan: string[]; health: string };
};

export type StoragePayload = BaseRecord & {
  ok: boolean;
  storage: {
    runtimeDataDir: string;
    storageRoot: string;
    canvasStorageRoot: string;
    databasePath: string;
    databaseDriver: string;
    databaseExists: boolean;
    databaseReady: boolean;
  };
};

export type LibrarySummaryPayload = BaseRecord & {
  ok: boolean;
  summary: {
    modelProjects: number;
    models: number;
    outfitProjects: number;
    outfits: number;
    actionProjects: number;
    actions: number;
    canvasProjects: number;
    canvases: number;
    assets: number;
  };
};

export type EnvironmentPayload = BaseRecord & {
  ok: boolean;
  environment: {
    nodeEnv: string;
    platform: string;
    arch: string;
    pid: number;
    language: string;
    configuredHost: string;
    configuredPort: number;
  };
};

export class AdminApiError extends Error implements HttpError {
  statusCode: number;
  errors?: Record<string, string[]>;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AdminApiError";
    this.statusCode = statusCode;
  }
}
