import { randomUUID } from "node:crypto";
import {
  ALL_PERMISSION_KEYS,
  expandPermissionKeys,
  permissionKeysToStatement,
  permissionStatementToKeys,
} from "./permission-catalog.mjs";

export const FORART_ORGANIZATION_SLUG = "forart";
export const GUEST_ROLE_KEY = "guest";
export const GUEST_ROLE_NAME = "访客";

function parsePermission(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDisplayName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("角色名称不能为空");
  if (name.length > 96) throw new Error("角色名称不能超过 96 个字符");
  return name;
}

function isAdmin(user) {
  const roles = Array.isArray(user?.role) ? user.role : String(user?.role || "").split(",");
  return roles.map((role) => role.trim()).includes("admin");
}

export function createOrganizationRoleService({ auth, context }) {
  let organizationId = null;

  async function findOrganization() {
    return context.adapter.findOne({
      model: "organization",
      where: [{ field: "slug", value: FORART_ORGANIZATION_SLUG }],
    });
  }

  async function requireOrganization() {
    const organization = organizationId
      ? await context.adapter.findOne({ model: "organization", where: [{ field: "id", value: organizationId }] })
      : await findOrganization();
    if (!organization) throw new Error("Forart 用户组织尚未初始化");
    organizationId = organization.id;
    return organization;
  }

  async function findMemberByUserId(userId) {
    const organization = await requireOrganization();
    return context.adapter.findOne({
      model: "member",
      where: [
        { field: "organizationId", value: organization.id },
        { field: "userId", value: userId },
      ],
    });
  }

  async function findRoleById(roleId) {
    const organization = await requireOrganization();
    return context.adapter.findOne({
      model: "organizationRole",
      where: [
        { field: "organizationId", value: organization.id },
        { field: "id", value: roleId },
      ],
    });
  }

  async function findRoleByKey(roleKey) {
    const organization = await requireOrganization();
    return context.adapter.findOne({
      model: "organizationRole",
      where: [
        { field: "organizationId", value: organization.id },
        { field: "role", value: roleKey },
      ],
    });
  }

  async function assertUniqueDisplayName(name, ignoredRoleId = "") {
    const organization = await requireOrganization();
    const roles = await context.adapter.findMany({
      model: "organizationRole",
      where: [{ field: "organizationId", value: organization.id }],
    });
    if (roles.some((role) => role.id !== ignoredRoleId && String(role.displayName || role.role).trim() === name)) {
      throw new Error("角色名称已存在");
    }
  }

  async function ensureGuestRole() {
    const organization = await requireOrganization();
    const permission = permissionKeysToStatement([]);
    const existing = await findRoleByKey(GUEST_ROLE_KEY);
    if (existing) {
      const existingPermission = parsePermission(existing.permission);
      if (existing.displayName !== GUEST_ROLE_NAME
        || JSON.stringify(existingPermission) !== JSON.stringify(permission)) {
        await context.adapter.update({
          model: "organizationRole",
          where: [{ field: "id", value: existing.id }],
          update: {
            displayName: GUEST_ROLE_NAME,
            permission: JSON.stringify(permission),
            updatedAt: new Date(),
          },
        });
      }
      return existing.id;
    }
    const role = await context.adapter.create({
      model: "organizationRole",
      data: {
        organizationId: organization.id,
        role: GUEST_ROLE_KEY,
        permission: JSON.stringify(permission),
        displayName: GUEST_ROLE_NAME,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return role.id;
  }

  async function ensureMembership(userId, role, { preserveExisting = false } = {}) {
    const organization = await requireOrganization();
    const member = await findMemberByUserId(userId);
    if (!member) {
      return auth.api.addMember({ body: { userId, organizationId: organization.id, role } });
    }
    if (!preserveExisting && member.role !== role) {
      return context.adapter.update({
        model: "member",
        where: [{ field: "id", value: member.id }],
        update: { role },
      });
    }
    return member;
  }

  async function ensureSystemOrganization(adminUserId) {
    let organization = await findOrganization();
    if (!organization) {
      organization = await auth.api.createOrganization({
        body: {
          name: "Forart",
          slug: FORART_ORGANIZATION_SLUG,
          userId: adminUserId,
          keepCurrentActiveOrganization: true,
        },
      });
    }
    organizationId = organization.id;
    await ensureGuestRole();
    await ensureMembership(adminUserId, "owner");
    return organization;
  }

  async function addUserToGuest(userId) {
    await ensureGuestRole();
    return ensureMembership(userId, GUEST_ROLE_KEY);
  }

  async function ensureExistingUsers(users) {
    const admin = users.find(isAdmin);
    if (!admin) return;
    await ensureSystemOrganization(admin.id);
    for (const user of users) {
      if (!isAdmin(user)) await ensureMembership(user.id, GUEST_ROLE_KEY, { preserveExisting: true });
    }
  }

  async function listRoles() {
    const organization = await requireOrganization();
    const [roles, members] = await Promise.all([
      context.adapter.findMany({
        model: "organizationRole",
        where: [{ field: "organizationId", value: organization.id }],
      }),
      context.adapter.findMany({
        model: "member",
        where: [{ field: "organizationId", value: organization.id }],
      }),
    ]);
    return roles.map((role) => ({
      id: role.id,
      key: role.role,
      name: role.displayName || role.role,
      isDefault: role.role === GUEST_ROLE_KEY,
      permissions: expandPermissionKeys(permissionStatementToKeys(parsePermission(role.permission))),
      memberIds: members.filter((member) => member.role === role.role).map((member) => member.userId),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt || role.createdAt,
    })).sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  }

  async function createRole({ name, permissions = [], memberIds = [] }, headers) {
    if (!headers) throw new Error("创建角色需要管理员会话");
    const organization = await requireOrganization();
    const displayName = normalizeDisplayName(name);
    await assertUniqueDisplayName(displayName);
    const result = await auth.api.createOrgRole({
      headers,
      body: {
        organizationId: organization.id,
        role: `role_${randomUUID().replaceAll("-", "")}`,
        permission: permissionKeysToStatement(permissions),
        additionalFields: { displayName },
      },
    });
    await replaceRoleMembers(result.roleData.id, memberIds, headers);
    return (await listRoles()).find((item) => item.id === result.roleData.id);
  }

  async function updateRole(roleId, { name, permissions }, headers) {
    if (!headers) throw new Error("修改角色需要管理员会话");
    const role = await findRoleById(roleId);
    if (!role) throw new Error("角色不存在");
    const data = {};
    if (name !== undefined) {
      if (role.role === GUEST_ROLE_KEY) throw new Error("访客角色不能重命名");
      data.displayName = normalizeDisplayName(name);
      await assertUniqueDisplayName(data.displayName, role.id);
    }
    if (permissions !== undefined) data.permission = permissionKeysToStatement(permissions);
    await auth.api.updateOrgRole({
      headers,
      body: { organizationId: (await requireOrganization()).id, roleId: role.id, data },
    });
    return (await listRoles()).find((item) => item.id === role.id);
  }

  async function setUserRole(userId, roleId, headers) {
    if (!headers) throw new Error("修改用户角色需要管理员会话");
    const user = await context.internalAdapter.findUserById(userId);
    if (!user) throw new Error("用户不存在");
    if (isAdmin(user)) throw new Error("管理员角色不能修改");
    const role = roleId ? await findRoleById(roleId) : await findRoleByKey(GUEST_ROLE_KEY);
    if (!role) throw new Error("角色不存在");
    const existingMember = await findMemberByUserId(userId);
    const memberResult = !existingMember
      ? await auth.api.addMember({
          headers,
          body: { userId, organizationId: (await requireOrganization()).id, role: role.role },
        })
      : await auth.api.updateMemberRole({
          headers,
          body: { organizationId: (await requireOrganization()).id, memberId: existingMember.id, role: role.role },
        });
    const member = memberResult?.member || memberResult;
    if (!member?.id) throw new Error("更新用户角色失败");
    return {
      memberId: member.id,
      roleId: role.id,
      roleKey: role.role,
      name: role.displayName || role.role,
    };
  }

  async function replaceRoleMembers(roleId, userIds, headers) {
    if (!headers) throw new Error("修改角色成员需要管理员会话");
    const role = await findRoleById(roleId);
    if (!role) throw new Error("角色不存在");
    if (role.role === GUEST_ROLE_KEY) throw new Error("请通过用户管理调整访客归属");
    const organization = await requireOrganization();
    const requested = new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean));
    const members = await context.adapter.findMany({
      model: "member",
      where: [{ field: "organizationId", value: organization.id }],
    });
    for (const member of members) {
      const user = await context.internalAdapter.findUserById(member.userId);
      if (!user || isAdmin(user)) continue;
      if (requested.has(member.userId) && member.role !== role.role) {
        await auth.api.updateMemberRole({ headers, body: { organizationId: organization.id, memberId: member.id, role: role.role } });
      } else if (!requested.has(member.userId) && member.role === role.role) {
        await auth.api.updateMemberRole({ headers, body: { organizationId: organization.id, memberId: member.id, role: GUEST_ROLE_KEY } });
      }
    }
    return [...requested];
  }

  async function deleteRole(roleId, headers) {
    if (!headers) throw new Error("删除角色需要管理员会话");
    const role = await findRoleById(roleId);
    if (!role) throw new Error("角色不存在");
    if (role.role === GUEST_ROLE_KEY) throw new Error("访客角色不能删除");
    const organization = await requireOrganization();
    const members = await context.adapter.findMany({
      model: "member",
      where: [
        { field: "organizationId", value: organization.id },
        { field: "role", value: role.role },
      ],
    });
    for (const member of members) {
      await auth.api.updateMemberRole({ headers, body: { organizationId: organization.id, memberId: member.id, role: GUEST_ROLE_KEY } });
    }
    await auth.api.deleteOrgRole({ headers, body: { organizationId: organization.id, roleId: role.id } });
  }

  async function roleForUser(userId) {
    const member = await findMemberByUserId(userId).catch(() => null);
    if (!member) return null;
    if (member.role === "owner") return { memberId: member.id, roleId: null, roleKey: "owner", name: "管理员" };
    const role = await findRoleByKey(member.role);
    if (!role) return null;
    return { memberId: member.id, roleId: role.id, roleKey: role.role, name: role.displayName || role.role };
  }

  async function listPermissions(userId) {
    const user = await context.internalAdapter.findUserById(userId);
    if (!user) return [];
    if (isAdmin(user)) return [...ALL_PERMISSION_KEYS];
    const member = await findMemberByUserId(userId).catch(() => null);
    if (!member) return [];
    const role = await findRoleByKey(member.role);
    if (!role) return [];
    return expandPermissionKeys(permissionStatementToKeys(parsePermission(role.permission)));
  }

  return {
    addUserToGuest,
    createRole,
    deleteRole,
    ensureExistingUsers,
    ensureSystemOrganization,
    listPermissions,
    listRoles,
    replaceRoleMembers,
    roleForUser,
    setUserRole,
    updateRole,
  };
}
