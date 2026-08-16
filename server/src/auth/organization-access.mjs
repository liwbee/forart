import { createAccessControl } from "better-auth/plugins";
import { PERMISSION_STATEMENTS } from "./permission-catalog.mjs";

const ORGANIZATION_CONTROL_STATEMENTS = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
};

export const forartOrganizationAccessControl = createAccessControl({
  ...ORGANIZATION_CONTROL_STATEMENTS,
  ...PERMISSION_STATEMENTS,
});

export const forartOrganizationOwnerRole = forartOrganizationAccessControl.newRole({
  ...ORGANIZATION_CONTROL_STATEMENTS,
  ...PERMISSION_STATEMENTS,
});
