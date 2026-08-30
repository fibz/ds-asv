import { ComplianceCard } from "@/components/compliance/card";
import { ScanCard } from "@/components/scanners/card";

export default async function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Welcome back! Here&apos;s your compliance status.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <ComplianceCard
          title="SOC 2"
          status="COMPLIANT"
          lastAudit={new Date().toISOString()}
        />
        <ComplianceCard
          title="PCI DSS"
          status="IN_PROGRESS"
          lastAudit={new Date().toISOString()}
        />
        <ComplianceCard
          title="PCI SSS"
          status="NON_COMPLIANT"
          lastAudit={new Date().toISOString()}
        />
        <ScanCard
          title="Last Scan"
          status="COMPLETED"
          scanCount={12}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">PCI DSS scan completed</span>
              <span className="text-sm text-gray-500">2 hours ago</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">WAF rules updated</span>
              <span className="text-sm text-gray-500">5 hours ago</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">SIEM alert resolved</span>
              <span className="text-sm text-gray-500">1 day ago</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <a
              href="/scanners"
              className="block w-full text-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              Start New Scan
            </a>
            <a
              href="/compliance"
              className="block w-full text-center px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              View Compliance Report
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
