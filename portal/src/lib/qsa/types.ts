export type QsaAssignmentStatus = "queued" | "assigned" | "in_review" | "completed" | "cancelled";
export type QsaAssignmentRole = "queue" | "assignee" | "coordinator";

export interface QsaAssignmentRow {
  id: string;
  qsaOrganizationId: string;
  customerOrganizationId: string;
  reportId: string;
  assigneeUserId: string | null;
  createdByUserId: string;
  status: QsaAssignmentStatus;
  dueAt: string | null;
  notes: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QsaCandidateReport {
  reportId: string;
  customerOrganizationId: string;
  customerName: string;
  reportStatus: string;
  createdAt: string;
}

export function isActiveQsaAssignment(status: QsaAssignmentStatus): boolean {
  return status === "queued" || status === "assigned" || status === "in_review";
}
