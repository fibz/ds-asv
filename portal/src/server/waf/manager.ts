export interface WafRule {
  id: string;
  name: string;
  description: string;
  action: "ALLOW" | "BLOCK" | "LOG";
  conditions: RuleCondition[];
  priority: number;
  enabled: boolean;
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

export class WafManager {
  private rules: WafRule[] = [];

  async getRules(): Promise<WafRule[]> {
    return this.rules;
  }

  async addRule(rule: Omit<WafRule, "id">): Promise<WafRule> {
    const newRule: WafRule = {
      ...rule,
      id: `rule-${Date.now()}`,
    };
    this.rules.push(newRule);
    return newRule;
  }

  async updateRule(id: string, updates: Partial<WafRule>): Promise<WafRule | null> {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) return null;

    this.rules[index] = { ...this.rules[index], ...updates };
    return this.rules[index];
  }

  async deleteRule(id: string): Promise<boolean> {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.rules.splice(index, 1);
    return true;
  }

  async getTrafficStats(): Promise<{
    totalRequests: number;
    blockedRequests: number;
    allowedRequests: number;
  }> {
    // TODO: Implement traffic stats from WAF provider
    return {
      totalRequests: 0,
      blockedRequests: 0,
      allowedRequests: 0,
    };
  }
}
