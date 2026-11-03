export type OrganizationAgentRole =
  | "OWNER"
  | "ADMIN"
  | "AGENT_MANAGER"
  | "OPERATOR"
  | "AUDITOR"
  | "VIEWER";

export function organizationAgentPermissions(role: OrganizationAgentRole) {
  return {
    canView: true,
    canViewPrivate: role !== "VIEWER",
    canViewGrants: role === "OWNER" || role === "ADMIN" || role === "AUDITOR",
    canViewFieldPolicies:
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "AGENT_MANAGER" ||
      role === "AUDITOR",
    canManage:
      role === "OWNER" || role === "ADMIN" || role === "AGENT_MANAGER",
    canManagePermissions: role === "OWNER" || role === "ADMIN",
  };
}
