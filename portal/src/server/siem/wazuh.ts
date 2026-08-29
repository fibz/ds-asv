export interface SiemAlert {
  id: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  source: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  resolved: boolean;
  createdAt: string;
}

export class WazuhClient {
  private apiUrl: string;
  private username: string;
  private password: string;

  constructor(apiUrl: string, username: string, password: string) {
    this.apiUrl = apiUrl;
    this.username = username;
    this.password = password;
  }

  async getAlerts(options?: { severity?: string; limit?: number }): Promise<SiemAlert[]> {
    // TODO: Implement Wazuh API integration
    // GET to ${this.apiUrl}/alerts
    throw new Error("Not implemented - integrate with Wazuh SIEM");
  }

  async getAlert(alertId: string): Promise<SiemAlert> {
    // TODO: Implement Wazuh API integration
    // GET to ${this.apiUrl}/alerts/${alertId}
    throw new Error("Not implemented - integrate with Wazuh SIEM");
  }

  async resolveAlert(alertId: string): Promise<void> {
    // TODO: Implement Wazuh API integration
    // PUT to ${this.apiUrl}/alerts/${alertId}/resolve
    throw new Error("Not implemented - integrate with Wazuh SIEM");
  }

  async getAgents(): Promise<Array<{ id: string; name: string; status: string }>> {
    // TODO: Implement Wazuh API integration
    // GET to ${this.apiUrl}/agents
    throw new Error("Not implemented - integrate with Wazuh SIEM");
  }
}
