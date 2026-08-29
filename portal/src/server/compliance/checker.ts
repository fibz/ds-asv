export interface ComplianceFramework {
  name: string;
  version: string;
  controls: Control[];
}

export interface Control {
  id: string;
  name: string;
  description: string;
  status: "COMPLIANT" | "NON_COMPLIANT" | "IN_PROGRESS" | "NOT_ASSESSED";
  evidence?: string;
  lastChecked?: string;
}

export class ComplianceChecker {
  private frameworks: ComplianceFramework[] = [
    {
      name: "SOC 2",
      version: "2017",
      controls: [
        { id: "CC1.1", name: "Control Environment", description: "The entity demonstrates a commitment to integrity and ethical values.", status: "NOT_ASSESSED" },
        { id: "CC2.1", name: "Communication", description: "The entity internally communicates information.", status: "NOT_ASSESSED" },
        { id: "CC3.1", name: "Risk Assessment", description: "The entity specifies objectives with sufficient clarity.", status: "NOT_ASSESSED" },
      ],
    },
    {
      name: "PCI DSS",
      version: "4.0",
      controls: [
        { id: "1.1", name: "Network Security Controls", description: "Install and maintain network security controls.", status: "NOT_ASSESSED" },
        { id: "2.1", name: "Secure Configurations", description: "Apply secure configurations to all system components.", status: "NOT_ASSESSED" },
        { id: "3.1", name: "Protect Stored Data", description: "Protect stored account data.", status: "NOT_ASSESSED" },
      ],
    },
    {
      name: "PCI SSS",
      version: "1.0",
      controls: [
        { id: "SSS-1", name: "Secure Software Design", description: "Software is designed securely.", status: "NOT_ASSESSED" },
        { id: "SSS-2", name: "Security Testing", description: "Software is tested for security vulnerabilities.", status: "NOT_ASSESSED" },
      ],
    },
  ];

  async assessCompliance(frameworkName: string): Promise<ComplianceFramework | null> {
    return this.frameworks.find(f => f.name === frameworkName) || null;
  }

  async getAllFrameworks(): Promise<ComplianceFramework[]> {
    return this.frameworks;
  }

  async updateControlStatus(frameworkName: string, controlId: string, status: Control["status"], evidence?: string): Promise<void> {
    const framework = this.frameworks.find(f => f.name === frameworkName);
    if (framework) {
      const control = framework.controls.find(c => c.id === controlId);
      if (control) {
        control.status = status;
        control.evidence = evidence;
        control.lastChecked = new Date().toISOString();
      }
    }
  }

  async calculateComplianceScore(frameworkName: string): Promise<number> {
    const framework = this.frameworks.find(f => f.name === frameworkName);
    if (!framework || framework.controls.length === 0) return 0;

    const compliant = framework.controls.filter(c => c.status === "COMPLIANT").length;
    return (compliant / framework.controls.length) * 100;
  }
}
