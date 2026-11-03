const allowedKeysByAction: Record<string, string[]> = {
  "agent.created": ["initialStatus", "discoverable"],
  "agent.lifecycle.updated": [
    "previousStatus",
    "newStatus",
    "previousDiscoverable",
    "newDiscoverable",
  ],
  "agent.field_policy.updated": [
    "fieldKey",
    "classification",
    "publicVisible",
    "previousVersion",
  ],
  "permission_grant.created": [
    "actionScope",
    "targetScope",
    "dataScope",
    "expiresAt",
    "maxUses",
  ],
  "permission_grant.revoked": ["reason"],
  "organization.member.role_changed": ["previousRole", "newRole"],
  "organization.member.removed": ["previousRole"],
  "organization.member.invitations_revoked": ["invitationCount", "reason"],
  "organization.member.grants_revoked": ["grantCount", "reason"],
  "invitation.created": ["role", "expiresAt"],
  "invitation.redeemed": ["role"],
  "action_approval.requested": ["actionType", "recipient", "payloadDigest", "requestedDataScope", "expiresAt"],
  "action_approval.approved": ["actionType", "recipient", "payloadDigest", "requestedDataScope", "decision"],
  "action_approval.rejected": ["actionType", "recipient", "payloadDigest", "requestedDataScope", "decision"],
  "action_approval.expired": ["actionType", "recipient", "payloadDigest", "reason"],
  "action_approval.cancelled": ["actionType", "recipient", "payloadDigest", "reason"],
};

const arrayKeys = new Set(["actionScope", "targetScope", "dataScope", "requestedDataScope"]);

export function projectSafeAuditMetadata(
  action: string,
  metadata: unknown,
): Record<string, string | number | boolean | string[] | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const source = metadata as Record<string, unknown>;
  const allowedKeys = allowedKeysByAction[action] ?? [];
  const safe: Record<string, string | number | boolean | string[] | null> = {};

  for (const key of allowedKeys) {
    if (!(key in source)) continue;
    const value = source[key];

    if (arrayKeys.has(key)) {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        safe[key] = value;
      }
      continue;
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = value;
    }
  }

  return safe;
}
