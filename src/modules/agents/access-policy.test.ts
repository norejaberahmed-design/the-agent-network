import { describe, expect, it } from "vitest";
import { organizationAgentPermissions } from "./access-policy";

describe("organization agent access policy", () => {
  it("limits VIEWER to basic agent visibility", () => {
    expect(organizationAgentPermissions("VIEWER")).toEqual({
      canView: true,
      canViewPrivate: false,
      canViewGrants: false,
      canViewFieldPolicies: false,
      canManage: false,
      canManageFieldPolicies: false,
      canManagePermissions: false,
    });
  });

  it("allows agent managers to manage agents but not permission grants", () => {
    const permissions = organizationAgentPermissions("AGENT_MANAGER");
    expect(permissions.canManage).toBe(true);
    expect(permissions.canViewFieldPolicies).toBe(true);
    expect(permissions.canManageFieldPolicies).toBe(false);
    expect(permissions.canViewGrants).toBe(false);
    expect(permissions.canManagePermissions).toBe(false);
  });

  it("limits grant administration to owners and admins", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const permissions = organizationAgentPermissions(role);
      expect(permissions.canViewGrants).toBe(true);
      expect(permissions.canManagePermissions).toBe(true);
      expect(permissions.canManageFieldPolicies).toBe(true);
    }
    expect(organizationAgentPermissions("AUDITOR").canViewGrants).toBe(true);
    expect(organizationAgentPermissions("AUDITOR").canManagePermissions).toBe(false);
  });

  it("does not let operators manage agent policy", () => {
    const permissions = organizationAgentPermissions("OPERATOR");
    expect(permissions.canViewPrivate).toBe(true);
    expect(permissions.canManage).toBe(false);
    expect(permissions.canViewGrants).toBe(false);
  });
});
