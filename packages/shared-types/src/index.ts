export interface ActionItem {
  assignee: string;
  task: string;
  deadline?: string;
}

export interface CopilotSummaryResponse {
  summary: string;
  actionItems: ActionItem[];
}
